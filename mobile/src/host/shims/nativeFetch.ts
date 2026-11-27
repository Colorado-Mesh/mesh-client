/**
 * `fetch` for the mobile host worker.
 *
 * The desktop main process fetches arbitrary origins (MQTT presets, weather, tiles, GitHub,
 * link previews, the Reticulum sidecar on 127.0.0.1). Inside a WebView worker those requests
 * would hit CORS and mixed-content rules, so cross-origin requests go through the native
 * `MeshNet` plugin (OkHttp on Android, URLSession on iOS), streaming the body back in chunks.
 *
 * Same-origin, `data:` and `blob:` URLs, and the `web` platform (browser test harness) use the
 * WebView's own fetch.
 */
import { Buffer } from 'buffer';

import { callNative, onNativeEvent } from '../hostChannel';

interface HttpStartResult {
  status: number;
  statusText?: string;
  headers: Record<string, string>;
  url?: string;
}

interface StreamSink {
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  queued: Uint8Array[];
  ended: boolean;
  error: Error | null;
}

const sinks = new Map<string, StreamSink>();
let listenersInstalled = false;
let nextReq = 1;

function installListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  onNativeEvent('MeshNet', 'httpData', (d) => {
    const { id, dataB64 } = d as { id: string; dataB64: string };
    const sink = sinks.get(id);
    if (!sink) return;
    const chunk = Uint8Array.from(Buffer.from(dataB64, 'base64'));
    if (sink.controller) sink.controller.enqueue(chunk);
    else sink.queued.push(chunk);
  });
  onNativeEvent('MeshNet', 'httpEnd', (d) => {
    const { id } = d as { id: string };
    const sink = sinks.get(id);
    if (!sink) return;
    sink.ended = true;
    sinks.delete(id);
    try {
      sink.controller?.close();
    } catch {
      // catch-no-log-ok stream already closed or errored by the consumer
    }
  });
  onNativeEvent('MeshNet', 'httpError', (d) => {
    const { id, message } = d as { id: string; message: string };
    const sink = sinks.get(id);
    if (!sink) return;
    sink.error = new TypeError(`fetch failed: ${message}`);
    sinks.delete(id);
    try {
      sink.controller?.error(sink.error);
    } catch {
      // catch-no-log-ok stream already closed by the consumer
    }
  });
}

function shouldUseWebFetch(url: URL): boolean {
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
  // Bundled assets (same origin) load from the WebView. Everything else goes through MeshNet,
  // including in the browser harness, where the web MeshNet tunnels to the bridge (and falls back
  // to fetch when no bridge is running).
  return typeof location !== 'undefined' && url.origin === location.origin;
}

async function bodyToBytes(body: BodyInit | null | undefined): Promise<Uint8Array | null> {
  if (body == null) return null;
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body))
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  new Headers(h).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export async function mobileFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const req = input instanceof Request ? input : null;
  const url = new URL(
    input instanceof Request ? input.url : typeof input === 'string' ? input : input.href,
  );
  if (shouldUseWebFetch(url)) return fetchViaWebView(input, init);

  installListeners();
  const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
  const headers = headersToRecord(init?.headers ?? req?.headers);
  const bodyBytes =
    init?.body !== undefined
      ? await bodyToBytes(init.body)
      : req && method !== 'GET' && method !== 'HEAD'
        ? new Uint8Array(await req.arrayBuffer())
        : null;
  const id = `h${nextReq++}`;
  const sink: StreamSink = { controller: null, queued: [], ended: false, error: null };
  sinks.set(id, sink);

  const signal = init?.signal ?? req?.signal;
  const abort = () => {
    sinks.delete(id);
    void callNative('MeshNet', 'httpCancel', { id }).catch(() => {});
    try {
      sink.controller?.error(new DOMException('The operation was aborted.', 'AbortError'));
    } catch {
      // catch-no-log-ok stream already closed
    }
  };
  if (signal?.aborted) {
    sinks.delete(id);
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  signal?.addEventListener('abort', abort, { once: true });

  let start: HttpStartResult;
  try {
    start = await callNative<HttpStartResult>('MeshNet', 'httpRequest', {
      id,
      url: url.href,
      method,
      headers,
      bodyB64: bodyBytes ? Buffer.from(bodyBytes).toString('base64') : undefined,
      followRedirects: init?.redirect !== 'manual',
    });
  } catch (err) {
    sinks.delete(id);
    signal?.removeEventListener('abort', abort);
    if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
    throw new TypeError(`fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  const nullBody = method === 'HEAD' || start.status === 204 || start.status === 304;
  const stream = nullBody
    ? null
    : new ReadableStream<Uint8Array>({
        start(controller) {
          sink.controller = controller;
          for (const c of sink.queued) controller.enqueue(c);
          sink.queued = [];
          if (sink.error) controller.error(sink.error);
          else if (sink.ended) controller.close();
        },
        cancel() {
          abort();
        },
      });
  if (nullBody) {
    sinks.delete(id);
    void callNative('MeshNet', 'httpCancel', { id }).catch(() => {});
  }
  const response = new Response(stream, {
    status: start.status,
    statusText: start.statusText ?? '',
    headers: start.headers,
  });
  if (start.url) {
    Object.defineProperty(response, 'url', { value: start.url });
  } else {
    Object.defineProperty(response, 'url', { value: url.href });
  }
  return response;
}

function fetchViaWebView(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const f = (globalThis as { __meshWebFetch?: typeof fetch }).__meshWebFetch ?? fetch;
  return f(input, init);
}
