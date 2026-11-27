/**
 * `http` / `https` shim: client `request` / `get` over the mobile native fetch. Used by the
 * beacon feed, GPS (gpsd HTTP), and TAK enrollment. No server support.
 */
import { Buffer } from 'buffer';
import { EventEmitter } from 'events';
import { Readable } from 'readable-stream';

import { mobileFetch } from '../nativeFetch';

export interface ReqOpts {
  protocol?: string;
  hostname?: string;
  host?: string;
  port?: number | string;
  path?: string;
  method?: string;
  headers?: Record<string, string | string[] | number>;
  timeout?: number;
  signal?: AbortSignal;
}

export class IncomingMessage extends Readable {
  statusCode = 0;
  statusMessage = '';
  headers: Record<string, string> = {};
  constructor() {
    super({ read() {} });
  }
  setEncoding(enc: BufferEncoding): this {
    super.setEncoding(enc);
    return this;
  }
}

class ClientRequest extends EventEmitter {
  private readonly body: Buffer[] = [];
  private readonly ac = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  destroyed = false;
  constructor(
    private readonly url: string,
    private readonly opts: ReqOpts,
    cb?: (res: IncomingMessage) => void,
  ) {
    super();
    if (cb) this.once('response', cb);
    if (opts.timeout) this.setTimeout(opts.timeout);
    opts.signal?.addEventListener('abort', () => this.destroy(new Error('aborted')));
  }
  setHeader(): void {}
  setTimeout(ms: number, cb?: () => void): this {
    if (cb) this.once('timeout', cb);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.emit('timeout'), ms);
    return this;
  }
  write(chunk: string | Uint8Array): boolean {
    this.body.push(Buffer.from(chunk as Uint8Array));
    return true;
  }
  end(chunk?: string | Uint8Array): this {
    if (chunk) this.write(chunk);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.opts.headers ?? {}))
      headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    const method = (this.opts.method ?? 'GET').toUpperCase();
    mobileFetch(this.url, {
      method,
      headers,
      body:
        this.body.length && method !== 'GET' && method !== 'HEAD'
          ? Buffer.concat(this.body)
          : undefined,
      signal: this.ac.signal,
    }).then(
      async (r) => {
        if (this.timer) clearTimeout(this.timer);
        const res = new IncomingMessage();
        res.statusCode = r.status;
        res.statusMessage = r.statusText;
        r.headers.forEach((v, k) => {
          res.headers[k] = v;
        });
        this.emit('response', res);
        if (!r.body) {
          res.push(null);
          return;
        }
        const reader = r.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.push(Buffer.from(value));
          }
          res.push(null);
        } catch (e) {
          res.destroy(e instanceof Error ? e : new Error(String(e)));
        }
      },
      (e: unknown) => {
        if (this.timer) clearTimeout(this.timer);
        if (!this.destroyed) this.emit('error', e instanceof Error ? e : new Error(String(e)));
      },
    );
    return this;
  }
  destroy(err?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ac.abort();
    if (err) this.emit('error', err);
    this.emit('close');
    return this;
  }
  abort(): void {
    this.destroy();
  }
}

function toUrl(
  defaultProtocol: string,
  input: string | URL | ReqOpts,
  opts?: ReqOpts,
): { url: string; opts: ReqOpts } {
  if (typeof input === 'string' || input instanceof URL) {
    return { url: String(input), opts: opts ?? {} };
  }
  const protocol = input.protocol ?? defaultProtocol;
  const host = input.hostname ?? input.host ?? 'localhost';
  const port = input.port ? `:${input.port}` : '';
  const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return { url: `${protocol}//${h}${port}${input.path ?? '/'}`, opts: input };
}

function makeModule(defaultProtocol: string) {
  const request = (
    input: string | URL | ReqOpts,
    optsOrCb?: ReqOpts | ((r: IncomingMessage) => void),
    cb?: (r: IncomingMessage) => void,
  ) => {
    const o = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    const c = typeof optsOrCb === 'function' ? optsOrCb : cb;
    const { url, opts } = toUrl(defaultProtocol, input, o);
    return new ClientRequest(url, opts, c);
  };
  const get = (
    input: string | URL | ReqOpts,
    optsOrCb?: ReqOpts | ((r: IncomingMessage) => void),
    cb?: (r: IncomingMessage) => void,
  ) => {
    const req = request(input, optsOrCb, cb);
    req.end();
    return req;
  };
  class Agent {
    constructor(public options: unknown = {}) {}
    destroy(): void {}
  }
  const createServer = () => {
    throw new Error('HTTP servers are not available on mobile');
  };
  return {
    request,
    get,
    Agent,
    globalAgent: new Agent(),
    createServer,
    IncomingMessage,
    ClientRequest,
    STATUS_CODES: {} as Record<number, string>,
    METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH'],
  };
}

export const http = makeModule('http:');
export const https = makeModule('https:');
