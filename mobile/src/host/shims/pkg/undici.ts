/**
 * `undici` shim for the mobile host worker. `fetch` goes through the native HTTP stack.
 * An `Agent` built with a pinned `connect.lookup` (see `src/main/pinnedPublicConnect.ts`) passes
 * the already-validated address to the native layer so DNS-rebinding protection still applies.
 */
import { mobileFetch } from '../nativeFetch';

export interface AgentOpts {
  connect?: {
    lookup?: (
      host: string,
      opts: { all?: boolean },
      cb: (err: Error | null, address: unknown, family?: number) => void,
    ) => void;
  };
}

export class Agent {
  constructor(readonly options: AgentOpts = {}) {}
  /** @internal */
  pinnedAddress(host: string): Promise<string | undefined> {
    const lookup = this.options.connect?.lookup;
    if (!lookup) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      lookup(host, {}, (err, address) => {
        resolve(err ? undefined : typeof address === 'string' ? address : undefined);
      });
    });
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  destroy(): Promise<void> {
    return Promise.resolve();
  }
}

export class Dispatcher extends Agent {}
export class Pool extends Agent {}
export class Client extends Agent {}
export class ProxyAgent extends Agent {}

export async function fetch(
  input: string | URL | Request,
  init: RequestInit & { dispatcher?: Agent } = {},
): Promise<Response> {
  const { dispatcher, ...rest } = init;
  if (dispatcher instanceof Agent) {
    const u = new URL(input instanceof Request ? input.url : String(input));
    const pinned = await dispatcher.pinnedAddress(u.hostname.replace(/^\[|\]$/g, ''));
    if (pinned) {
      const headers = new Headers(rest.headers);
      headers.set('x-mesh-pinned-address', pinned);
      return mobileFetch(input, { ...rest, headers });
    }
  }
  return mobileFetch(input, rest);
}

export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const FormData = globalThis.FormData;
export function setGlobalDispatcher(): void {}
export function getGlobalDispatcher(): Agent {
  return new Agent();
}
export async function request(
  url: string,
  opts: RequestInit = {},
): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: { text(): Promise<string>; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> };
}> {
  const r = await mobileFetch(url, opts);
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return {
    statusCode: r.status,
    headers,
    body: { text: () => r.text(), json: () => r.json(), arrayBuffer: () => r.arrayBuffer() },
  };
}
export default {
  fetch,
  Agent,
  Dispatcher,
  Pool,
  Client,
  ProxyAgent,
  Headers,
  Request,
  Response,
  FormData,
  setGlobalDispatcher,
  getGlobalDispatcher,
  request,
};
