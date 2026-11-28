/**
 * `tls` shim for the mobile host worker: TLS client sockets over the native `MeshNet` plugin
 * (the same `Socket` class as `net`, opened with `tls: true`). Server-side TLS uses
 * `MeshNet.tcpListen` with a certificate; see `createServer`.
 */
import { Server, Socket } from './net';

export class TLSSocket extends Socket {}

export function connect(...args: unknown[]): TLSSocket {
  let opts: Record<string, unknown> = {};
  let cb: (() => void) | undefined;
  if (typeof args[0] === 'object' && args[0] !== null) {
    opts = { ...(args[0] as Record<string, unknown>) };
    cb = typeof args[1] === 'function' ? (args[1] as () => void) : undefined;
  } else {
    opts.port = Number(args[0]);
    let i = 1;
    if (typeof args[i] === 'string') opts.host = args[i++];
    if (typeof args[i] === 'object' && args[i] !== null)
      opts = { ...(args[i++] as Record<string, unknown>), ...opts };
    if (typeof args[i] === 'function') cb = args[i] as () => void;
  }
  const s = new TLSSocket();
  s.connect({ ...opts, tls: true }, cb);
  return s;
}

/** Local TLS servers (TAK) terminate TLS natively; the PEM/PFX material is passed through. */
class TlsServer extends Server {
  constructor(
    private readonly tlsOpts: Record<string, unknown>,
    listener?: (s: Socket) => void,
  ) {
    super(listener);
    this.on('connection', (s: Socket) => this.emit('secureConnection', s));
  }
  override listen(...args: unknown[]): this {
    (this as unknown as { tlsOptions: unknown }).tlsOptions = this.tlsOpts;
    return super.listen(...args, { tls: this.tlsOpts });
  }
}

export function createServer(
  opts: Record<string, unknown> = {},
  listener?: (s: Socket) => void,
): Server {
  return new TlsServer(opts, listener);
}

export function createSecureContext(opts: unknown): { context: unknown } {
  return { context: opts };
}

export const rootCertificates: string[] = [];
export const DEFAULT_MIN_VERSION = 'TLSv1.2';
export const DEFAULT_MAX_VERSION = 'TLSv1.3';
export function checkServerIdentity(): undefined {
  return undefined;
}

export default {
  TLSSocket,
  connect,
  createServer,
  createSecureContext,
  rootCertificates,
  checkServerIdentity,
  DEFAULT_MIN_VERSION,
  DEFAULT_MAX_VERSION,
};
