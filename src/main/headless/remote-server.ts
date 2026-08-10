import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import type { KeyboardInputEvent, MouseInputEvent, MouseWheelInputEvent } from 'electron';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { Duplex } from 'stream';
import WebSocket, { WebSocketServer } from 'ws';

import {
  HEADLESS_REMOTE_COOKIE_NAME,
  HEADLESS_WS_PATH,
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
      };
    case 'mouseup':
      return {
        type: 'mouseUp',
        x: clampHeadlessCoordinate(input.x, viewportWidth),
        y: clampHeadlessCoordinate(input.y, viewportHeight),
        button: input.button,
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

function parseCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Constant-time token comparison (defeats length/timing probes on the shared gate token). */
function tokenMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface HeadlessRemoteServerStartOpts {
  /** Override the captured-frames period (tests use fast ticks; default = 1000/fps ms). */
  captureIntervalMs?: number;
}

export class HeadlessRemoteServer {
  private win: HeadlessTargetWindow | null = null;
  private config: HeadlessRemoteConfig | null = null;
  private httpServer: Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly sockets = new Set<WebSocket>();
  private captureTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private captureInFlight = false;
  private lastSignature: string | null = null;
  private sessionId = '';
  private running = false;
  private readonly encoder: FrameEncoder;

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

  /** Bind the HTTP server (empty `config.port` = ephemeral). Resolves false on bind failure. */
  start(
    win: HeadlessTargetWindow,
    config: HeadlessRemoteConfig,
    opts: HeadlessRemoteServerStartOpts = {},
  ): Promise<boolean> {
    if (this.running) {
      console.debug('[headless] remote server already running; start ignored');
      return Promise.resolve(false);
    }
    this.win = win;
    this.config = config;
    this.sessionId = randomUUID();
    this.captureTimer = null;
    const captureIntervalMs = opts.captureIntervalMs ?? Math.max(1, Math.round(1000 / config.fps));

    return new Promise<boolean>((resolve) => {
      const httpServer = createServer((req, res) => {
        this.handleHttpRequest(req, res);
      });
      httpServer.on('error', (err) => {
        this.running = false;
        console.error(
          '[headless] remote server failed to bind',
          sanitizeLogMessage(`${config.host}:${config.port}`),
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
        try {
          httpServer.close();
        } catch {
          // catch-no-log-ok server never started listening
        }
        resolve(false);
      });

      const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
      wss.on('connection', (socket, req) => {
        this.handleSocket(socket, req);
      });
      httpServer.on('upgrade', (req, socket, head) => {
        this.handleUpgrade(wss, req, socket, head);
      });

      httpServer.listen(config.port, config.host, () => {
        const address = httpServer.address();
        const actualPort = typeof address === 'object' && address ? address.port : config.port;
        this.httpServer = httpServer;
        this.wss = wss;
        this.running = true;
        const safeDescription = config.token
          ? '[headless] remote server listening (token gate enabled)'
          : '[headless] remote server listening (no token gate)';
        console.debug(
          `[headless] remote server on http://${sanitizeLogMessage(config.host)}:${actualPort} ${safeDescription}`,
        );
        this.startCaptureLoop(captureIntervalMs);
        this.startHeartbeat(config.wsHeartbeatSec);
        console.debug('[headless] capture interval ms =', captureIntervalMs);
        resolve(true);
      });
    });
  }

  /** Close HTTP/WS servers and clear timers. Idempotent; safe to call on a never-started instance. */
  async stop(): Promise<void> {
    if (!this.httpServer && !this.wss && this.sockets.size === 0) {
      this.running = false;
      return;
    }
    this.running = false;
    this.stopCaptureLoop();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const socket of this.sockets) {
      try {
        socket.close(1001, 'server stopping');
      } catch {
        // catch-no-log-ok socket already closing
      }
    }
    this.sockets.clear();
    try {
      this.wss?.close();
    } catch {
      // catch-no-log-ok wss already closed
    }
    const httpServer = this.httpServer;
    this.httpServer = null;
    if (httpServer) {
      await new Promise<void>((resolveClose) => {
        httpServer.close(() => {
          resolveClose();
        });
      });
    }
    this.wss = null;
    this.win = null;
    this.lastSignature = null;
    console.debug('[headless] remote server stopped');
  }

  /** Capture + broadcast one frame now (used by the loop and tests). */
  async captureOnce(): Promise<void> {
    if (!this.running || this.captureInFlight || this.sockets.size === 0) return;
    const win = this.win;
    if (!win || win.webContents.isDestroyed()) return;
    this.captureInFlight = true;
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
    }
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
      for (const socket of this.sockets) {
        const aliveCheck = socket as WebSocket & { isAlive?: boolean };
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

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      const ready = this.running;
      const rendererLoaded = ready ? !this.win?.webContents.isLoading() : false;
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
  }

  private serveControlPage(req: IncomingMessage, res: ServerResponse, url: URL): void {
    const token = this.config?.token ?? '';
    if (token) {
      const queryToken = url.searchParams.get('token') ?? '';
      const cookieToken = parseCookie(req.headers.cookie ?? '')[HEADLESS_REMOTE_COOKIE_NAME] ?? '';
      if (!tokenMatches(queryToken, token) && !tokenMatches(cookieToken, token)) {
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
        res.end(buildMissingTokenPageHtml());
        return;
      }
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

  private readonly failedUpgradePeers = new Map<string, { count: number; resetAt: number }>();

  private handleUpgrade(
    wss: WebSocketServer,
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== HEADLESS_WS_PATH) {
      socket.destroy();
      return;
    }
    const token = this.config?.token ?? '';
    if (token) {
      const queryToken = url.searchParams.get('token') ?? '';
      const cookieToken = parseCookie(req.headers.cookie ?? '')[HEADLESS_REMOTE_COOKIE_NAME] ?? '';
      if (!tokenMatches(queryToken, token) && !tokenMatches(cookieToken, token)) {
        console.debug(
          '[headless] rejected unauthorized WebSocket upgrade from',
          sanitizeLogMessage(req.socket.remoteAddress ?? 'unknown'),
        );
        const peerKey = req.socket.remoteAddress ?? 'unknown';
        const now = Date.now();
        const prior = this.failedUpgradePeers.get(peerKey);
        if (!prior || now >= prior.resetAt) {
          this.failedUpgradePeers.set(peerKey, { count: 1, resetAt: now + 60_000 });
        } else if (prior.count >= 5) {
          socket.destroy();
          return;
        } else {
          prior.count += 1;
        }
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  }

  private handleSocket(socket: WebSocket, req: IncomingMessage): void {
    const alive = socket as WebSocket & { isAlive?: boolean };
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
    const hello: {
      type: 'hello';
      sessionId: string;
      width: number;
      height: number;
      fps: number;
      jpegQuality: number;
    } = {
      type: 'hello',
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
      this.handleClientControl(Buffer.from(data as unknown as ArrayBuffer).toString('utf8'));
    });
    socket.on('close', () => {
      this.sockets.delete(socket);
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
      try {
        void win.webContents.insertText(input.char);
      } catch (err) {
        console.debug(
          '[headless] char insert failed:',
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
      }
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
