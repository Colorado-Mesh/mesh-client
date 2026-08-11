import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import type { KeyboardInputEvent, MouseInputEvent, MouseWheelInputEvent } from 'electron';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';

import {
  HEADLESS_AUTH_FAIL_MAX,
  HEADLESS_AUTH_FAIL_WINDOW_MS,
  HEADLESS_INPUT_RATE_MAX,
  HEADLESS_INPUT_RATE_WINDOW_MS,
  HEADLESS_MAX_WS_CLIENTS,
  HEADLESS_REMOTE_COOKIE_NAME,
  HEADLESS_STOP_TIMEOUT_MS,
  HEADLESS_WS_MAX_PAYLOAD_BYTES,
  HEADLESS_WS_PATH,
  headlessBindRequiresToken,
  type HeadlessRemoteConfig,
} from '../../shared/headless';
import {
  clampHeadlessCoordinate,
  type ClientInputMessage,
  isClientInputMessage,
  normalizeModifiers,
} from '../../shared/remoteProtocol';
import { sanitizeLogMessage } from '../sanitize-log-message';
import {
  buildMissingTokenPageHtml,
  buildRemoteControlPageHtml,
  remoteHealthJson,
} from './remote-control-page';

type SendInputEvent = MouseInputEvent | MouseWheelInputEvent | KeyboardInputEvent;

/** Structural view of the Electron BrowserWindow the server drives (fakeable in node tests). */
export interface HeadlessTargetWindow {
  webContents: {
    capturePage(): Promise<{
      isEmpty(): boolean;
      toJPEG(quality: number): Buffer;
      toBitmap(): Buffer;
    }>;
    sendInputEvent(event: SendInputEvent): void;
    insertText(text: string): Promise<void> | void;
    isLoading(): boolean;
    isDestroyed(): boolean;
  };
  isFocused(): boolean;
  focus(): void;
}

/** Bytes → JPEG + change signature behind one seam so a faster encoder can swap in later. */
export interface FrameEncoder {
  signature(image: { toBitmap(): Buffer }): string;
  encode(image: { toJPEG(quality: number): Buffer }, quality: number): Buffer;
}

/** Default encoder: sha1 of the raw bitmap for identity, `NativeImage.toJPEG` for output. */
export const jpegBitmapFrameEncoder: FrameEncoder = {
  signature: (image) => createHash('sha1').update(image.toBitmap()).digest('hex'),
  encode: (image, quality) => image.toJPEG(quality),
};

/** DOM `event.key` → Electron accelerator `keyCode` (single chars pass through unchanged). */
export function mapKeyCodeToSendInput(key: string): string {
  const named: Record<string, string> = {
    ' ': 'Space',
    Enter: 'Enter',
    Escape: 'Escape',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Pause: 'Pause',
    PrintScreen: 'PrintScreen',
    ScrollLock: 'ScrollLock',
    CapsLock: 'Capslock',
    NumLock: 'Numlock',
    Shift: 'Shift',
    Control: 'Control',
    Alt: 'Alt',
    Meta: 'Meta',
    ContextMenu: 'AppMenu',
  };
  if (Object.prototype.hasOwnProperty.call(named, key)) return named[key];
  if (key.length === 1) return key;
  return key.toUpperCase();
}

type ElectronModifier = 'control' | 'alt' | 'shift' | 'meta';

const ELECTRON_MODIFIERS: Record<string, ElectronModifier> = {
  ctrl: 'control',
  meta: 'meta',
  alt: 'alt',
  shift: 'shift',
};

function toElectronModifiers(modifiers: unknown): ElectronModifier[] {
  return normalizeModifiers(modifiers).map((m) => ELECTRON_MODIFIERS[m] ?? 'shift');
}

/**
 * Pure mapping from a validated wire input to Electron `sendInputEvent` arguments.
 * Coordinates are clamped to the fixed viewport. Returns `null` for messages that
 * are handled outside `sendInputEvent` (`char` → `insertText`, `resize` → ignored).
 */
export function toSendInputEvent(
  input: ClientInputMessage,
  viewportWidth: number,
  viewportHeight: number,
): SendInputEvent | null {
  switch (input.type) {
    case 'mousemove':
      return {
        type: 'mouseMove',
        x: clampHeadlessCoordinate(input.x, viewportWidth),
        y: clampHeadlessCoordinate(input.y, viewportHeight),
      };
    case 'mousedown':
      return {
        type: 'mouseDown',
        x: clampHeadlessCoordinate(input.x, viewportWidth),
        y: clampHeadlessCoordinate(input.y, viewportHeight),
        button: input.button,
        // Chromium only synthesizes a DOM `click` when clickCount >= 1; sendInputEvent
        // defaults it to 0, so without this the renderer never fires click handlers.
        clickCount: 1,
      };
    case 'mouseup':
      return {
        type: 'mouseUp',
        x: clampHeadlessCoordinate(input.x, viewportWidth),
        y: clampHeadlessCoordinate(input.y, viewportHeight),
        button: input.button,
        clickCount: 1,
      };
    case 'wheel':
      return {
        type: 'mouseWheel',
        x: clampHeadlessCoordinate(input.x, viewportWidth),
        y: clampHeadlessCoordinate(input.y, viewportHeight),
        deltaX: input.deltaX,
        deltaY: input.deltaY,
      };
    case 'keydown':
      return {
        type: 'keyDown',
        keyCode: mapKeyCodeToSendInput(input.key),
        modifiers: toElectronModifiers(input.modifiers),
      };
    case 'keyup':
      return {
        type: 'keyUp',
        keyCode: mapKeyCodeToSendInput(input.key),
        modifiers: toElectronModifiers(input.modifiers),
      };
    case 'char':
    case 'resize':
      return null;
    default: {
      const never: never = input;
      return never;
    }
  }
}

/** Parse Cookie header; values are URI-decoded to match `encodeURIComponent` on Set-Cookie. */
export function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const raw = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      // catch-no-log-ok malformed percent-encoding; keep raw so wrong cookies fail closed
      out[key] = raw;
    }
  }
  return out;
}

/** Constant-time token comparison via SHA-256 digests (hides length). */
export function tokenMatches(candidate: string, expected: string): boolean {
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function extractRequestTokens(
  req: IncomingMessage,
  url: URL,
): { queryToken: string; cookieToken: string } {
  const queryToken = url.searchParams.get('token') ?? '';
  const cookieToken = parseCookie(req.headers.cookie ?? '')[HEADLESS_REMOTE_COOKIE_NAME] ?? '';
  return { queryToken, cookieToken };
}

/** True when the request carries a matching query or cookie token (or gate is disabled). */
export function authorizeRemoteRequest(
  req: IncomingMessage,
  url: URL,
  expectedToken: string,
): boolean {
  if (!expectedToken) return true;
  const { queryToken, cookieToken } = extractRequestTokens(req, url);
  return tokenMatches(queryToken, expectedToken) || tokenMatches(cookieToken, expectedToken);
}

function safeParseUrl(reqUrl: string | undefined): URL | null {
  try {
    return new URL(reqUrl ?? '/', 'http://localhost');
  } catch {
    // catch-no-log-ok malformed request target
    return null;
  }
}

interface HeadlessRemoteServerStartOpts {
  /** Override the captured-frames period (tests use fast ticks; default = 1000/fps ms). */
  captureIntervalMs?: number;
}

type AliveSocket = WebSocket & { isAlive?: boolean };

export class HeadlessRemoteServer {
  private win: HeadlessTargetWindow | null = null;
  private config: HeadlessRemoteConfig | null = null;
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly sockets = new Set<WebSocket>();
  /** First connected socket may inject input; others are view-only until it leaves. */
  private controllerSocket: WebSocket | null = null;
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private captureInFlight = false;
  private captureInFlightPromise: Promise<void> | null = null;
  private lastSignature: string | null = null;
  private sessionId = '';
  private running = false;
  private starting = false;
  private startGeneration = 0;
  private readonly encoder: FrameEncoder;
  private readonly failedAuthPeers = new Map<string, { count: number; resetAt: number }>();
  private readonly inputTimestamps = new WeakMap<WebSocket, number[]>();

  constructor(encoder: FrameEncoder = jpegBitmapFrameEncoder) {
    this.encoder = encoder;
  }

  get isRunning(): boolean {
    return this.running;
  }

  connectedSocketCount(): number {
    return this.sockets.size;
  }

  /** Actually bound port (null before successful start / after stop). */
  getPort(): number | null {
    if (!this.httpServer) return null;
    const address = this.httpServer.address();
    if (typeof address === 'object' && address) return address.port;
    return null;
  }

  /** Rebind the capture/input target after a window recreate (same HTTP/WS listeners). */
  setTargetWindow(win: HeadlessTargetWindow): void {
    this.win = win;
  }

  /** Bind the HTTP server (empty `config.port` = ephemeral). Resolves false on bind failure. */
  start(
    win: HeadlessTargetWindow,
    config: HeadlessRemoteConfig,
    opts: HeadlessRemoteServerStartOpts = {},
  ): Promise<boolean> {
    if (this.running || this.starting) {
      console.debug('[headless] remote server already running or starting; start ignored');
      return Promise.resolve(false);
    }
    if (headlessBindRequiresToken(config.host) && !config.token) {
      console.error(
        '[headless] remote access secret env is required when binding to a non-loopback host',
        sanitizeLogMessage(config.host),
      );
      return Promise.resolve(false);
    }

    this.starting = true;
    this.win = win;
    this.config = config;
    this.sessionId = randomUUID();
    this.captureTimer = null;
    this.lastSignature = null;
    const captureIntervalMs = opts.captureIntervalMs ?? Math.max(1, Math.round(1000 / config.fps));
    const generation = ++this.startGeneration;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        this.starting = false;
        resolve(ok);
      };

      const httpServer = createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });
      this.httpServer = httpServer;

      const onListenError = (err: Error): void => {
        if (settled || generation !== this.startGeneration) return;
        this.running = false;
        this.starting = false;
        console.error(
          '[headless] remote server failed to bind',
          sanitizeLogMessage(`${config.host}:${config.port}`),
          sanitizeLogMessage(err.message),
        );
        try {
          wss.close();
        } catch {
          // catch-no-log-ok wss never accepted connections
        }
        try {
          httpServer.close();
        } catch {
          // catch-no-log-ok server never started listening
        }
        if (this.httpServer === httpServer) {
          this.httpServer = null;
          this.wss = null;
          this.win = null;
          this.config = null;
        }
        settle(false);
      };

      httpServer.once('error', onListenError);

      const wss = new WebSocketServer({
        noServer: true,
        perMessageDeflate: false,
        maxPayload: HEADLESS_WS_MAX_PAYLOAD_BYTES,
      });
      this.wss = wss;
      wss.on('connection', (socket, req) => {
        this.handleSocket(socket, req);
      });
      httpServer.on('upgrade', (req, socket, head) => {
        this.handleUpgrade(wss, req, socket, head);
      });

      httpServer.listen(config.port, config.host, () => {
        if (generation !== this.startGeneration) {
          try {
            httpServer.close();
          } catch {
            // catch-no-log-ok superseded start
          }
          settle(false);
          return;
        }
        httpServer.off('error', onListenError);
        const address = httpServer.address();
        const actualPort = typeof address === 'object' && address ? address.port : config.port;
        this.running = true;
        this.starting = false;
        const safeDescription = config.token
          ? '[headless] remote server listening (token gate enabled)'
          : '[headless] remote server listening (no token gate)';
        console.debug(
          `[headless] remote server on http://${sanitizeLogMessage(config.host)}:${actualPort} ${safeDescription}`,
        );
        this.startCaptureLoop(captureIntervalMs);
        this.startHeartbeat(config.wsHeartbeatSec);
        console.debug('[headless] capture interval ms =', captureIntervalMs);
        settle(true);
      });
    });
  }

  /** Close HTTP/WS servers and clear timers. Idempotent; safe to call on a never-started instance. */
  async stop(): Promise<void> {
    this.startGeneration += 1;
    this.starting = false;
    this.running = false;
    this.stopCaptureLoop();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.captureInFlightPromise) {
      await Promise.race([
        this.captureInFlightPromise,
        new Promise<void>((resolve) => {
          setTimeout(resolve, HEADLESS_STOP_TIMEOUT_MS).unref?.();
        }),
      ]);
    }
    for (const socket of this.sockets) {
      try {
        socket.terminate();
      } catch {
        // catch-no-log-ok socket already closing
      }
    }
    this.sockets.clear();
    this.controllerSocket = null;
    const wss = this.wss;
    this.wss = null;
    if (wss) {
      await Promise.race([
        new Promise<void>((resolveClose) => {
          wss.close(() => {
            resolveClose();
          });
        }),
        new Promise<void>((resolve) => {
          setTimeout(resolve, HEADLESS_STOP_TIMEOUT_MS).unref?.();
        }),
      ]);
    }
    const httpServer = this.httpServer;
    this.httpServer = null;
    if (httpServer) {
      try {
        httpServer.closeAllConnections?.();
      } catch {
        // catch-no-log-ok older Node without closeAllConnections
      }
      await Promise.race([
        new Promise<void>((resolveClose) => {
          httpServer.close(() => {
            resolveClose();
          });
        }),
        new Promise<void>((resolve) => {
          setTimeout(resolve, HEADLESS_STOP_TIMEOUT_MS).unref?.();
        }),
      ]);
    }
    this.win = null;
    this.config = null;
    this.lastSignature = null;
    this.failedAuthPeers.clear();
    console.debug('[headless] remote server stopped');
  }

  /** Capture + broadcast one frame now (used by the loop and tests). */
  async captureOnce(): Promise<void> {
    if (!this.running || this.captureInFlight || this.sockets.size === 0) return;
    const win = this.win;
    if (!win || win.webContents.isDestroyed()) return;
    this.captureInFlight = true;
    const work = (async (): Promise<void> => {
      try {
        const image = await win.webContents.capturePage();
        if (image.isEmpty()) return;
        const signature = this.encoder.signature(image);
        if (signature === this.lastSignature) return;
        const jpeg = this.encoder.encode(image, this.config?.jpegQuality ?? 70);
        this.lastSignature = signature;
        this.broadcastBinary(jpeg);
      } catch (err) {
        console.debug(
          '[headless] frame capture failed:',
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
      } finally {
        this.captureInFlight = false;
        this.captureInFlightPromise = null;
      }
    })();
    this.captureInFlightPromise = work;
    await work;
  }

  private startCaptureLoop(intervalMs: number): void {
    this.stopCaptureLoop();
    // Frames are only produced while at least one browser is connected (captureOnce checks).
    this.captureTimer = setInterval(() => {
      void this.captureOnce();
    }, intervalMs);
  }

  private stopCaptureLoop(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
    }
  }

  private startHeartbeat(intervalSec: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      for (const socket of [...this.sockets]) {
        const aliveCheck = socket as AliveSocket;
        if (aliveCheck.isAlive === false) {
          try {
            socket.terminate();
          } catch {
            // catch-no-log-ok already closing
          }
          this.sockets.delete(socket);
          if (this.controllerSocket === socket) {
            this.controllerSocket = this.sockets.values().next().value ?? null;
          }
          continue;
        }
        aliveCheck.isAlive = false;
        try {
          socket.ping();
        } catch {
          // catch-no-log-ok socket closing
        }
      }
    }, intervalSec * 1000);
    if (this.heartbeatTimer) this.heartbeatTimer.unref?.();
  }

  private broadcastBinary(jpeg: Buffer): void {
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(jpeg);
        } catch (err) {
          console.debug(
            '[headless] frame send failed:',
            sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
          );
        }
      }
    }
  }

  private peerKey(req: IncomingMessage): string {
    return req.socket.remoteAddress ?? 'unknown';
  }

  /** Returns true when this peer should be silently dropped (rate limited). */
  private noteAuthFailure(peerKey: string): boolean {
    const now = Date.now();
    for (const [key, entry] of this.failedAuthPeers) {
      if (now >= entry.resetAt) this.failedAuthPeers.delete(key);
    }
    const prior = this.failedAuthPeers.get(peerKey);
    if (!prior || now >= prior.resetAt) {
      this.failedAuthPeers.set(peerKey, {
        count: 1,
        resetAt: now + HEADLESS_AUTH_FAIL_WINDOW_MS,
      });
      return false;
    }
    prior.count += 1;
    return prior.count > HEADLESS_AUTH_FAIL_MAX;
  }

  private allowInput(socket: WebSocket): boolean {
    const now = Date.now();
    let stamps = this.inputTimestamps.get(socket);
    if (!stamps) {
      stamps = [];
      this.inputTimestamps.set(socket, stamps);
    }
    const cutoff = now - HEADLESS_INPUT_RATE_WINDOW_MS;
    while (stamps.length > 0) {
      const oldest = stamps[0];
      if (oldest === undefined || oldest >= cutoff) break;
      stamps.shift();
    }
    if (stamps.length >= HEADLESS_INPUT_RATE_MAX) return false;
    stamps.push(now);
    return true;
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    try {
      const url = safeParseUrl(req.url);
      if (!url) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
      }
      if (url.pathname === '/health') {
        const ready = this.running;
        const win = this.win;
        const rendererLoaded =
          ready && win && !win.webContents.isDestroyed() ? !win.webContents.isLoading() : false;
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(remoteHealthJson(ready, rendererLoaded, Math.floor(process.uptime())));
        return;
      }
      if (url.pathname === '/') {
        this.serveControlPage(req, res, url);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (err) {
      console.debug(
        '[headless] HTTP handler error:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      try {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Internal error');
      } catch {
        // catch-no-log-ok response already started
      }
    }
  }

  private serveControlPage(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const token = this.config?.token ?? '';
    if (token) {
      if (!authorizeRemoteRequest(req, url, token)) {
        const peer = this.peerKey(req);
        if (this.noteAuthFailure(peer)) {
          res.writeHead(429, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('Too many requests');
          return;
        }
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        res.end(buildMissingTokenPageHtml());
        return;
      }
      const { queryToken } = extractRequestTokens(req, url);
      if (tokenMatches(queryToken, token)) {
        res.setHeader(
          'Set-Cookie',
          `${HEADLESS_REMOTE_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Lax; HttpOnly`,
        );
      }
    }
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(buildRemoteControlPageHtml());
  }

  private handleUpgrade(
    wss: WebSocketServer,
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    try {
      const url = safeParseUrl(req.url);
      if (url?.pathname !== HEADLESS_WS_PATH) {
        socket.destroy();
        return;
      }
      const token = this.config?.token ?? '';
      if (token && !authorizeRemoteRequest(req, url, token)) {
        console.debug(
          '[headless] rejected unauthorized WebSocket upgrade from',
          sanitizeLogMessage(req.socket.remoteAddress ?? 'unknown'),
        );
        const peer = this.peerKey(req);
        if (this.noteAuthFailure(peer)) {
          socket.destroy();
          return;
        }
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      if (this.sockets.size >= HEADLESS_MAX_WS_CLIENTS) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch (err) {
      console.debug(
        '[headless] upgrade handler error:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      try {
        socket.destroy();
      } catch {
        // catch-no-log-ok already destroyed
      }
    }
  }

  private handleSocket(socket: WebSocket, req: IncomingMessage): void {
    const alive = socket as AliveSocket;
    alive.isAlive = true;
    socket.on('pong', () => {
      alive.isAlive = true;
    });
    socket.on('error', (err) => {
      console.debug(
        '[headless] client socket error:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
    });
    this.sockets.add(socket);
    this.controllerSocket ??= socket;
    const hello = {
      type: 'hello' as const,
      sessionId: this.sessionId,
      width: this.config?.viewportWidth ?? 1280,
      height: this.config?.viewportHeight ?? 800,
      fps: this.config?.fps ?? 5,
      jpegQuality: this.config?.jpegQuality ?? 70,
    };
    try {
      socket.send(JSON.stringify(hello));
    } catch (err) {
      console.debug(
        '[headless] hello send failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
    }
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      if (socket !== this.controllerSocket) return;
      if (!this.allowInput(socket)) return;
      this.handleClientControl(Buffer.from(data as unknown as ArrayBuffer).toString('utf8'));
    });
    socket.on('close', () => {
      this.sockets.delete(socket);
      if (this.controllerSocket === socket) {
        this.controllerSocket = this.sockets.values().next().value ?? null;
      }
    });
    const peerRef = req.socket.remoteAddress
      ? ` (${sanitizeLogMessage(req.socket.remoteAddress)})`
      : '';
    console.debug(`[headless] client connected${peerRef}`);
  }

  private handleClientControl(raw: string): void {
    if (!this.win) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      console.debug('[headless] dropped non-JSON input frame');
      return;
    }
    if (!isClientInputMessage(parsed)) {
      console.debug('[headless] dropped unknown input frame');
      return;
    }
    this.injectInput(parsed);
  }

  private injectInput(input: ClientInputMessage): void {
    const win = this.win;
    if (!win || win.webContents.isDestroyed()) return;
    if (input.type === 'char') {
      void Promise.resolve(win.webContents.insertText(input.char)).catch((err: unknown) => {
        console.debug(
          '[headless] char insert failed:',
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
      });
      return;
    }
    const event = toSendInputEvent(
      input,
      this.config?.viewportWidth ?? 1280,
      this.config?.viewportHeight ?? 800,
    );
    if (!event) return;
    try {
      if (!win.isFocused()) win.focus();
      win.webContents.sendInputEvent(event);
    } catch (err) {
      console.debug(
        '[headless] input injection failed:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
    }
  }
}
