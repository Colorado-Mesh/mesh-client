/**
 * `dgram` shim for the mobile host worker (MeshCom EXTUDP, Reticulum AutoInterface probes) over
 * the native `MeshNet` UDP methods.
 */
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';

import { callNative, onNativeEvent } from '../../hostChannel';

const sockets = new Map<string, DgramSocket>();
let nextId = 1;
let installed = false;

function install(): void {
  if (installed) return;
  installed = true;
  onNativeEvent('MeshNet', 'udpMessage', (d) => {
    const m = d as { id: string; dataB64: string; address: string; port: number };
    const s = sockets.get(m.id);
    if (!s) return;
    const buf = Buffer.from(m.dataB64, 'base64');
    s.emit('message', buf, {
      address: m.address,
      family: m.address.includes(':') ? 'IPv6' : 'IPv4',
      port: m.port,
      size: buf.length,
    });
  });
  onNativeEvent('MeshNet', 'udpError', (d) => {
    const m = d as { id: string; message: string };
    sockets.get(m.id)?.emit('error', new Error(m.message));
  });
}

type SendCb = (err: Error | null, bytes?: number) => void;

export class DgramSocket extends EventEmitter {
  private readonly id = `u${nextId++}`;
  private opened: Promise<void>;
  private bound: { address: string; port: number } | null = null;
  private closed = false;

  constructor(
    private readonly type: 'udp4' | 'udp6',
    private readonly reuseAddr = false,
  ) {
    super();
    install();
    sockets.set(this.id, this);
    this.opened = callNative('MeshNet', 'udpCreate', { id: this.id, type, reuseAddr }).then(
      () => undefined,
    );
    this.opened.catch((e: unknown) =>
      this.emit('error', e instanceof Error ? e : new Error(String(e))),
    );
  }

  bind(...args: unknown[]): this {
    let port = 0;
    let address = this.type === 'udp6' ? '::' : '0.0.0.0';
    let cb: (() => void) | undefined;
    for (const a of args) {
      if (typeof a === 'number') port = a;
      else if (typeof a === 'string') address = a;
      else if (typeof a === 'function') cb = a as () => void;
      else if (a && typeof a === 'object') {
        const o = a as { port?: number; address?: string };
        if (typeof o.port === 'number') port = o.port;
        if (typeof o.address === 'string') address = o.address;
      }
    }
    if (cb) this.once('listening', cb);
    void this.opened
      .then(() =>
        callNative<{ address: string; port: number }>('MeshNet', 'udpBind', {
          id: this.id,
          port,
          address,
        }),
      )
      .then(
        (r) => {
          this.bound = r;
          this.emit('listening');
        },
        (e: unknown) => this.emit('error', e instanceof Error ? e : new Error(String(e))),
      );
    return this;
  }

  send(msg: Uint8Array | string | (Uint8Array | string)[], ...rest: unknown[]): void {
    let offset: number;
    let length: number | undefined;
    let port: number;
    let address: string | undefined;
    let cb: SendCb | undefined;
    const parts = Array.isArray(msg) ? msg : [msg];
    let buf = Buffer.concat(
      parts.map((p) => (typeof p === 'string' ? Buffer.from(p) : Buffer.from(p))),
    );
    if (typeof rest[0] === 'number' && typeof rest[1] === 'number' && typeof rest[2] === 'number') {
      offset = rest[0];
      length = rest[1];
      port = rest[2];
      address = typeof rest[3] === 'string' ? rest[3] : undefined;
      cb = rest.find((r) => typeof r === 'function') as SendCb | undefined;
      buf = buf.subarray(offset, offset + length);
    } else {
      port = Number(rest[0]);
      address = typeof rest[1] === 'string' ? rest[1] : undefined;
      cb = rest.find((r) => typeof r === 'function') as SendCb | undefined;
    }
    void this.opened
      .then(() =>
        callNative('MeshNet', 'udpSend', {
          id: this.id,
          dataB64: buf.toString('base64'),
          port,
          address: address ?? (this.type === 'udp6' ? '::1' : '127.0.0.1'),
        }),
      )
      .then(
        () => cb?.(null, buf.length),
        (e: unknown) => {
          const err = e instanceof Error ? e : new Error(String(e));
          if (cb) cb(err);
          else this.emit('error', err);
        },
      );
  }

  close(cb?: () => void): this {
    if (this.closed) return this;
    this.closed = true;
    sockets.delete(this.id);
    void callNative('MeshNet', 'udpClose', { id: this.id })
      .catch(() => {})
      .finally(() => {
        this.emit('close');
        cb?.();
      });
    return this;
  }

  address(): { address: string; family: string; port: number } {
    if (!this.bound) throw Object.assign(new Error('getsockname EBADF'), { code: 'EBADF' });
    return { ...this.bound, family: this.type === 'udp6' ? 'IPv6' : 'IPv4' };
  }

  setBroadcast(flag: boolean): void {
    void this.opened
      .then(() => callNative('MeshNet', 'udpSetOptions', { id: this.id, broadcast: flag }))
      .catch(() => {});
  }
  setMulticastTTL(ttl: number): number {
    void this.opened
      .then(() => callNative('MeshNet', 'udpSetOptions', { id: this.id, multicastTtl: ttl }))
      .catch(() => {});
    return ttl;
  }
  setMulticastLoopback(flag: boolean): boolean {
    void this.opened
      .then(() => callNative('MeshNet', 'udpSetOptions', { id: this.id, multicastLoopback: flag }))
      .catch(() => {});
    return flag;
  }
  setMulticastInterface(): void {}
  setTTL(ttl: number): number {
    return ttl;
  }
  addMembership(group: string, iface?: string): void {
    void this.opened
      .then(() => callNative('MeshNet', 'udpAddMembership', { id: this.id, group, iface }))
      .catch(() => {});
  }
  dropMembership(group: string, iface?: string): void {
    void this.opened
      .then(() => callNative('MeshNet', 'udpDropMembership', { id: this.id, group, iface }))
      .catch(() => {});
  }
  setRecvBufferSize(): void {}
  setSendBufferSize(): void {}
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
}

export function createSocket(
  typeOrOpts: 'udp4' | 'udp6' | { type: 'udp4' | 'udp6'; reuseAddr?: boolean },
  listener?: (msg: Buffer, rinfo: unknown) => void,
): DgramSocket {
  const opts = typeof typeOrOpts === 'string' ? { type: typeOrOpts } : typeOrOpts;
  const s = new DgramSocket(opts.type, 'reuseAddr' in opts ? Boolean(opts.reuseAddr) : false);
  if (listener) s.on('message', listener);
  return s;
}

export const Socket = DgramSocket;
export default { createSocket, Socket };
