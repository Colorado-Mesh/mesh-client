/**
 * `net` / `tls` shim for the mobile host worker over the native `MeshNet` socket plugin
 * (Android: java.net / SSLSocket; iOS: Network.framework). In the browser test harness the
 * `MeshNet` plugin is the WebSocket-tunnel implementation in `src/mobile/bridge/webMeshNet.ts`.
 *
 * Implements the client `Socket` surface the main process uses (Meshtastic / MeshCore / MeshCom
 * TCP bridges, MQTT over TCP/TLS, host-link RTT probe, TAK relay) plus a minimal `Server`
 * (`listen` / `address` / `close` and accepted sockets) used for port probing and local servers.
 */

import { Buffer } from 'buffer';
import { EventEmitter } from 'events';
import { Duplex } from 'readable-stream';

import { isValidIpv4Literal, isValidIpv6Literal } from '../../../../shared/ipLiteral';
import { callNative, onNativeEvent } from '../../hostChannel';
import { linkClosed, linkOpened } from '../../linkTracker';

export interface ConnectResult {
  localAddress?: string;
  localPort?: number;
  remoteAddress?: string;
  remotePort?: number;
  remoteFamily?: string;
  authorized?: boolean;
  authorizationError?: string;
  alpnProtocol?: string;
}

const sockets = new Map<string, Socket>();
const servers = new Map<string, Server>();
let nextSocketId = 1;
let listenersInstalled = false;

function installListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  onNativeEvent('MeshNet', 'tcpData', (d) => {
    const { id, dataB64 } = d as { id: string; dataB64: string };
    sockets.get(id)?._onData(Buffer.from(dataB64, 'base64'));
  });
  onNativeEvent('MeshNet', 'tcpEnd', (d) => {
    sockets.get((d as { id: string }).id)?._onEnd();
  });
  onNativeEvent('MeshNet', 'tcpClose', (d) => {
    const { id, error } = d as { id: string; error?: string };
    sockets.get(id)?._onNativeClose(error);
  });
  onNativeEvent('MeshNet', 'tcpAccept', (d) => {
    const info = d as { serverId: string; id: string } & ConnectResult;
    const server = servers.get(info.serverId);
    if (!server) {
      void callNative('MeshNet', 'tcpDestroy', { id: info.id }).catch(() => {});
      return;
    }
    const s = new Socket();
    s._adoptAccepted(info.id, info);
    server.emit('connection', s);
  });
}

export function isIPv4(s: string): boolean {
  return isValidIpv4Literal(s);
}

export function isIPv6(s: string): boolean {
  return isValidIpv6Literal(s);
}

export function isIP(s: string): 0 | 4 | 6 {
  if (isIPv4(s)) return 4;
  if (isIPv6(s)) return 6;
  return 0;
}

interface ConnectOpts {
  host?: string;
  port?: number;
  timeout?: number;
  tls?: boolean;
  servername?: string;
  rejectUnauthorized?: boolean;
  ca?: unknown;
  cert?: unknown;
  key?: unknown;
  pfx?: unknown;
  passphrase?: string;
  ALPNProtocols?: string[];
}

function pemOrBytesToB64(v: unknown): string | string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.map((x) => pemOrBytesToB64(x) as string);
  if (typeof v === 'string') return Buffer.from(v, 'utf8').toString('base64');
  if (v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  return undefined;
}

export class Socket extends Duplex {
  remoteAddress: string | undefined;
  remotePort: number | undefined;
  remoteFamily: string | undefined;
  localAddress: string | undefined;
  localPort: number | undefined;
  bytesWritten = 0;
  bytesRead = 0;
  connecting = false;
  pending = true;
  encrypted = false;
  authorized = false;
  authorizationError: string | undefined;
  alpnProtocol: string | false = false;
  private nativeId: string | null = null;
  private idleMs = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private noDelay = true;
  private keepAlive: { enable: boolean; delay: number } = { enable: false, delay: 0 };
  private writeChain: Promise<void> = Promise.resolve();
  /** Counted as a live link for background-mode purposes (see linkTracker). */
  private linkCounted = false;

  constructor() {
    super({ allowHalfOpen: false });
    installListeners();
  }

  get readyState(): string {
    if (this.connecting) return 'opening';
    if (!this.nativeId) return 'closed';
    if (this.readable && this.writable) return 'open';
    if (this.readable) return 'readOnly';
    if (this.writable) return 'writeOnly';
    return 'closed';
  }

  /** @internal accepted server-side connection */
  _adoptAccepted(id: string, info: ConnectResult): void {
    this.nativeId = id;
    sockets.set(id, this);
    this.applyInfo(info);
    this.pending = false;
  }

  private applyInfo(info: ConnectResult): void {
    this.remoteAddress = info.remoteAddress;
    this.remotePort = info.remotePort;
    this.remoteFamily =
      info.remoteFamily ?? (info.remoteAddress && isIPv6(info.remoteAddress) ? 'IPv6' : 'IPv4');
    this.localAddress = info.localAddress;
    this.localPort = info.localPort;
    this.authorized = info.authorized ?? false;
    this.authorizationError = info.authorizationError;
    this.alpnProtocol = info.alpnProtocol ?? false;
  }

  connect(...args: unknown[]): this {
    let opts: ConnectOpts = {};
    let cb: (() => void) | undefined;
    if (typeof args[0] === 'object' && args[0] !== null) {
      opts = { ...(args[0] as ConnectOpts) };
      cb = typeof args[1] === 'function' ? (args[1] as () => void) : undefined;
    } else {
      opts.port = Number(args[0]);
      if (typeof args[1] === 'string') {
        opts.host = args[1];
        cb = typeof args[2] === 'function' ? (args[2] as () => void) : undefined;
      } else {
        cb = typeof args[1] === 'function' ? (args[1] as () => void) : undefined;
      }
    }
    if (cb) this.once(opts.tls ? 'secureConnect' : 'connect', cb);
    if (typeof opts.timeout === 'number') this.setTimeout(opts.timeout);
    const id = `s${nextSocketId++}`;
    this.nativeId = id;
    sockets.set(id, this);
    this.connecting = true;
    this.encrypted = opts.tls === true;
    void callNative<ConnectResult>('MeshNet', 'tcpConnect', {
      id,
      host: opts.host ?? 'localhost',
      port: opts.port,
      tls: opts.tls === true,
      servername: opts.servername ?? opts.host,
      rejectUnauthorized: opts.rejectUnauthorized !== false,
      caB64: pemOrBytesToB64(opts.ca),
      certB64: pemOrBytesToB64(opts.cert),
      keyB64: pemOrBytesToB64(opts.key),
      pfxB64: pemOrBytesToB64(opts.pfx),
      passphrase: opts.passphrase,
      alpn: opts.ALPNProtocols,
      noDelay: this.noDelay,
      keepAlive: this.keepAlive.enable,
      keepAliveDelayMs: this.keepAlive.delay,
    }).then(
      (info) => {
        if (this.destroyed) {
          void callNative('MeshNet', 'tcpDestroy', { id }).catch(() => {});
          return;
        }
        this.connecting = false;
        this.pending = false;
        this.applyInfo(info);
        this.touch();
        this.linkCounted = true;
        linkOpened('tcp');
        this.emit('connect');
        if (opts.tls) this.emit('secureConnect');
        this.emit('ready');
      },
      (err: unknown) => {
        this.connecting = false;
        sockets.delete(id);
        this.nativeId = null;
        const e = err instanceof Error ? err : new Error(String(err));
        const m =
          /\b(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|EAI_AGAIN|CERT_[A-Z_]+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\b/.exec(
            e.message,
          );
        if (m && !(e as Error & { code?: string }).code)
          (e as Error & { code?: string }).code = m[1];
        this.destroy(e);
      },
    );
    return this;
  }

  override _read(): void {
    // Push-based: data arrives via native events.
  }

  override _write(
    chunk: unknown,
    encoding: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, encoding);
    const send = () => {
      const id = this.nativeId;
      if (!id) return Promise.reject(new Error('This socket is closed'));
      this.bytesWritten += buf.length;
      this.touch();
      return callNative('MeshNet', 'tcpWrite', { id, dataB64: buf.toString('base64') }).then(
        () => undefined,
      );
    };
    const run = () => {
      this.writeChain = this.writeChain.then(send).then(
        () => {
          cb();
        },
        (e: unknown) => {
          cb(e instanceof Error ? e : new Error(String(e)));
        },
      );
    };
    if (this.connecting) this.once('connect', run);
    else run();
  }

  override _final(cb: (err?: Error | null) => void): void {
    const id = this.nativeId;
    if (!id) {
      cb();
      return;
    }
    void this.writeChain
      .then(() => callNative('MeshNet', 'tcpEnd', { id }))
      .then(
        () => {
          cb();
        },
        (e: unknown) => {
          cb(e instanceof Error ? e : new Error(String(e)));
        },
      );
  }

  override _destroy(err: Error | null, cb: (err: Error | null) => void): void {
    this.clearIdle();
    if (this.linkCounted) {
      this.linkCounted = false;
      linkClosed('tcp');
    }
    const id = this.nativeId;
    this.nativeId = null;
    if (id) {
      sockets.delete(id);
      void callNative('MeshNet', 'tcpDestroy', { id }).catch(() => {});
    }
    cb(err);
  }

  /** @internal */
  _onData(buf: Buffer): void {
    this.bytesRead += buf.length;
    this.touch();
    this.push(buf);
  }

  /** @internal */
  _onEnd(): void {
    this.push(null);
  }

  /** @internal */
  _onNativeClose(error?: string): void {
    const id = this.nativeId;
    if (id) sockets.delete(id);
    this.nativeId = null;
    if (error) {
      const e = new Error(error);
      const m = /\b(ECONNRESET|EPIPE|ETIMEDOUT)\b/.exec(error);
      (e as Error & { code?: string }).code = m?.[1] ?? 'ECONNRESET';
      this.destroy(e);
      return;
    }
    this.push(null);
    if (!this.destroyed) this.destroy();
  }

  setNoDelay(noDelay = true): this {
    this.noDelay = noDelay;
    if (this.nativeId && !this.connecting) {
      void callNative('MeshNet', 'tcpSetOptions', { id: this.nativeId, noDelay }).catch(() => {});
    }
    return this;
  }

  setKeepAlive(enable = false, initialDelay = 0): this {
    this.keepAlive = { enable, delay: initialDelay };
    if (this.nativeId && !this.connecting) {
      void callNative('MeshNet', 'tcpSetOptions', { id: this.nativeId, keepAlive: enable }).catch(
        () => {},
      );
    }
    return this;
  }

  setTimeout(ms: number, cb?: () => void): this {
    this.idleMs = ms;
    if (cb) {
      if (ms === 0) this.removeListener('timeout', cb);
      else this.once('timeout', cb);
    }
    this.touch();
    return this;
  }

  private touch(): void {
    this.clearIdle();
    if (this.idleMs > 0 && !this.destroyed) {
      this.idleTimer = setTimeout(() => this.emit('timeout'), this.idleMs);
    }
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  address(): { address: string; family: string; port: number } | Record<string, never> {
    if (!this.localAddress) return {};
    return {
      address: this.localAddress,
      family: isIPv6(this.localAddress) ? 'IPv6' : 'IPv4',
      port: this.localPort ?? 0,
    };
  }

  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  getPeerCertificate(): Record<string, unknown> {
    return {};
  }
  getProtocol(): string | null {
    return this.encrypted ? 'TLSv1.3' : null;
  }
  getCipher(): Record<string, string> {
    return {};
  }
}

export class Server extends EventEmitter {
  private nativeId: string | null = null;
  private boundPort = 0;
  private boundHost = '127.0.0.1';
  listening = false;

  constructor(optsOrListener?: unknown, listener?: (s: Socket) => void) {
    super();
    installListeners();
    const l = typeof optsOrListener === 'function' ? optsOrListener : listener;
    if (l) this.on('connection', l as (s: Socket) => void);
  }

  listen(...args: unknown[]): this {
    let port = 0;
    let host = '127.0.0.1';
    let cb: (() => void) | undefined;
    let tlsOpts: Record<string, unknown> | undefined;
    for (const a of args) {
      if (typeof a === 'number') port = a;
      else if (typeof a === 'string') host = a;
      else if (typeof a === 'function') cb = a as () => void;
      else if (a && typeof a === 'object') {
        const o = a as { port?: number; host?: string; tls?: Record<string, unknown> };
        if (typeof o.port === 'number') port = o.port;
        if (typeof o.host === 'string') host = o.host;
        if (o.tls) tlsOpts = o.tls;
      }
    }
    if (cb) this.once('listening', cb);
    const id = `l${nextSocketId++}`;
    this.nativeId = id;
    servers.set(id, this);
    void callNative<{ port: number; host?: string }>('MeshNet', 'tcpListen', {
      id,
      host,
      port,
      tls: tlsOpts
        ? {
            certB64: pemOrBytesToB64(tlsOpts.cert),
            keyB64: pemOrBytesToB64(tlsOpts.key),
            caB64: pemOrBytesToB64(tlsOpts.ca),
            pfxB64: pemOrBytesToB64(tlsOpts.pfx),
            passphrase: tlsOpts.passphrase,
            requestCert: tlsOpts.requestCert === true,
            rejectUnauthorized: tlsOpts.rejectUnauthorized !== false,
          }
        : undefined,
    }).then(
      (r) => {
        this.boundPort = r.port;
        this.boundHost = r.host ?? host;
        this.listening = true;
        this.emit('listening');
      },
      (e: unknown) => {
        servers.delete(id);
        this.nativeId = null;
        this.emit('error', e instanceof Error ? e : new Error(String(e)));
      },
    );
    return this;
  }

  address(): { address: string; family: string; port: number } | null {
    if (!this.listening) return null;
    return {
      address: this.boundHost,
      family: isIPv6(this.boundHost) ? 'IPv6' : 'IPv4',
      port: this.boundPort,
    };
  }

  close(cb?: (err?: Error) => void): this {
    const id = this.nativeId;
    this.nativeId = null;
    this.listening = false;
    if (id) {
      servers.delete(id);
      void callNative('MeshNet', 'tcpServerClose', { id })
        .catch(() => {})
        .finally(() => {
          this.emit('close');
          cb?.();
        });
    } else {
      queueMicrotask(() => cb?.(new Error('Server is not running.')));
    }
    return this;
  }

  getConnections(cb: (err: Error | null, n: number) => void): void {
    cb(null, 0);
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

export function createServer(opts?: unknown, listener?: (s: Socket) => void): Server {
  return new Server(opts, listener);
}

export function createConnection(...args: unknown[]): Socket {
  const s = new Socket();
  return s.connect(...args);
}

export const connect = createConnection;

export class BlockList {
  addAddress(): void {}
  check(): boolean {
    return false;
  }
}

export default {
  Socket,
  Server,
  BlockList,
  createServer,
  createConnection,
  connect,
  isIP,
  isIPv4,
  isIPv6,
};
