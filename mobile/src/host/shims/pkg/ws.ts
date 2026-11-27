/**
 * `ws` package shim for the mobile host worker: a client WebSocket over the native `MeshNet`
 * plugin (custom headers such as the Reticulum sidecar bearer token are not possible with the
 * WebView `WebSocket`). Mirrors the `ws` client events: open, message(data, isBinary),
 * close(code, reason), error, plus send / close / terminate / ping.
 */
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';

import { callNative, onNativeEvent } from '../../hostChannel';

const sockets = new Map<string, WebSocketShim>();
let nextId = 1;
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  onNativeEvent('MeshNet', 'wsOpen', (d) =>
    sockets.get((d as { id: string }).id)?._open((d as { protocol?: string }).protocol),
  );
  onNativeEvent('MeshNet', 'wsMessage', (d) => {
    const m = d as { id: string; text?: string; dataB64?: string };
    const s = sockets.get(m.id);
    if (!s) return;
    if (m.dataB64 !== undefined) s.emit('message', Buffer.from(m.dataB64, 'base64'), true);
    else s.emit('message', Buffer.from(m.text ?? '', 'utf8'), false);
  });
  onNativeEvent('MeshNet', 'wsClose', (d) => {
    const m = d as { id: string; code: number; reason: string };
    sockets.get(m.id)?._closed(m.code, m.reason);
  });
  onNativeEvent('MeshNet', 'wsError', (d) => {
    const m = d as { id: string; message: string };
    sockets.get(m.id)?._error(m.message);
  });
}

export class WebSocketShim extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  protocol = '';
  binaryType: 'nodebuffer' | 'arraybuffer' | 'fragments' = 'nodebuffer';
  bufferedAmount = 0;
  readonly url: string;
  private readonly id = `w${nextId++}`;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  constructor(url: string | URL, protocolsOrOpts?: unknown, maybeOpts?: unknown) {
    super();
    install();
    this.url = String(url);
    const protocols =
      typeof protocolsOrOpts === 'string' || Array.isArray(protocolsOrOpts)
        ? protocolsOrOpts
        : undefined;
    const opts = ((protocols ? maybeOpts : protocolsOrOpts) ?? {}) as {
      headers?: Record<string, string>;
      handshakeTimeout?: number;
      rejectUnauthorized?: boolean;
    };
    sockets.set(this.id, this);
    void callNative('MeshNet', 'wsConnect', {
      id: this.id,
      url: this.url,
      headers: opts.headers ?? {},
      protocols: protocols ? (Array.isArray(protocols) ? protocols : [protocols]) : [],
      timeoutMs: opts.handshakeTimeout,
      rejectUnauthorized: opts.rejectUnauthorized !== false,
    }).catch((e: unknown) => {
      this._error(e instanceof Error ? e.message : String(e));
    });
  }

  /** @internal */
  _open(protocol?: string): void {
    this.readyState = 1;
    this.protocol = protocol ?? '';
    this.emit('open');
    this.onopen?.({});
  }

  /** @internal */
  _closed(code: number, reason: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    sockets.delete(this.id);
    this.emit('close', code, Buffer.from(reason ?? ''));
    this.onclose?.({ code, reason });
  }

  /** @internal */
  _error(message: string): void {
    const err = new Error(message);
    this.emit('error', err);
    this.onerror?.(err);
    if (this.readyState !== 3) this._closed(1006, message);
  }

  override emit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === 'message' && this.onmessage) {
      const data = args[0] as Buffer;
      this.onmessage({ data: args[1] ? data : data.toString('utf8') });
    }
    if (event === 'error' && this.listenerCount('error') === 0) return false;
    return super.emit(event, ...args);
  }

  // `ws` also supports addEventListener-style handlers.
  addEventListener(type: string, l: (...a: unknown[]) => void): void {
    this.on(type, l);
  }
  removeEventListener(type: string, l: (...a: unknown[]) => void): void {
    this.off(type, l);
  }

  send(data: unknown, optsOrCb?: unknown, maybeCb?: (e?: Error) => void): void {
    const cb = (typeof optsOrCb === 'function' ? optsOrCb : maybeCb) as
      ((e?: Error) => void) | undefined;
    if (this.readyState !== 1) {
      cb?.(new Error('WebSocket is not open'));
      return;
    }
    const isText = typeof data === 'string';
    const payload = isText
      ? { text: data }
      : {
          dataB64: Buffer.from(
            data instanceof ArrayBuffer ? new Uint8Array(data) : (data as Uint8Array),
          ).toString('base64'),
        };
    callNative('MeshNet', 'wsSend', { id: this.id, ...payload }).then(
      () => cb?.(),
      (e: unknown) => cb?.(e instanceof Error ? e : new Error(String(e))),
    );
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    void callNative('MeshNet', 'wsClose', { id: this.id, code, reason }).catch(() => {});
  }

  terminate(): void {
    void callNative('MeshNet', 'wsClose', { id: this.id, code: 1006, reason: 'terminate' }).catch(
      () => {},
    );
    this._closed(1006, 'terminated');
  }

  ping(): void {}
  pong(): void {}
  pause(): void {}
  resume(): void {}
}

export class WebSocketServer extends EventEmitter {
  constructor() {
    super();
    throw new Error('WebSocket servers are not available on mobile');
  }
}

export default WebSocketShim;
export { WebSocketShim as WebSocket };
