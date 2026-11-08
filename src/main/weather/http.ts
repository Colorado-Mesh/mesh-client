import { lookup } from 'dns/promises';
import { fetch as undiciFetch } from 'undici';

import { MS_PER_SECOND } from '@/shared/timeConstants';

import { sanitizeLogMessage } from '../log-service';
import { createPinnedPublicAgent, isGlobalPublicAddress } from '../pinnedPublicConnect';

export const WEATHER_JSON_TIMEOUT_MS = 15 * MS_PER_SECOND;
export const WEATHER_TILE_TIMEOUT_MS = 15 * MS_PER_SECOND;
export const WEATHER_MAX_REDIRECTS = 2;

export const ALLOWED_WEATHER_HOSTS = new Set([
  'api.open-meteo.com',
  'api.rainviewer.com',
  'tilecache.rainviewer.com',
  'mesonet.agron.iastate.edu',
]);

export interface WeatherFetchDeps {
  fetchImpl?: (input: string, init?: RequestInit & { dispatcher?: unknown }) => Promise<Response>;
  resolveHost?: (host: string) => Promise<string[]>;
  now?: () => number;
  isOnline?: () => boolean;
}

export function weatherUserAgent(appVersion: string): string {
  return `mesh-client/${appVersion} (+https://github.com/Colorado-Mesh/mesh-client)`;
}

async function defaultResolveHost(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((r) => r.address);
}

/** Read a Response body with a hard byte cap (mirrors offline-maps/protocol). */
export async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > maxBytes) return null;
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {
          // catch-no-log-ok stream may already be closed
        });
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // catch-no-log-ok aborted / truncated body → treat as miss
    try {
      await reader.cancel();
    } catch {
      // catch-no-log-ok already closed
    }
    return null;
  }
  if (total === 0) return null;
  return Buffer.concat(chunks, total);
}

function isAllowedHost(hostname: string): boolean {
  return ALLOWED_WEATHER_HOSTS.has(hostname.toLowerCase());
}

async function fetchPinned(
  urlString: string,
  init: RequestInit,
  deps?: WeatherFetchDeps,
): Promise<Response> {
  if (deps?.fetchImpl) {
    return deps.fetchImpl(urlString, init);
  }
  const url = new URL(urlString);
  if (!isAllowedHost(url.hostname)) {
    throw new Error('host not allowlisted');
  }
  const resolveHost = deps?.resolveHost ?? defaultResolveHost;
  const addresses = await resolveHost(url.hostname);
  const publicAddr = addresses.find((a) => isGlobalPublicAddress(a));
  if (!publicAddr) {
    throw new Error('no public address');
  }
  const agent = createPinnedPublicAgent(url, publicAddr);
  try {
    return (await undiciFetch(urlString, {
      ...init,
      dispatcher: agent,
      redirect: 'manual',
    } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
  } finally {
    void agent.close().catch(() => {
      // catch-no-log-ok agent cleanup
    });
  }
}

/** Drop an unused Response body so undici / fetch can release the connection. */
function discardResponseBody(response: Response): void {
  void response.body?.cancel().catch(() => {
    // catch-no-log-ok stream may already be closed
  });
}

export async function fetchBounded(
  url: string,
  opts: {
    timeoutMs: number;
    maxBytes: number;
    accept: string;
    userAgent: string;
    deps?: WeatherFetchDeps;
  },
): Promise<{ body: Buffer; contentType: string } | null> {
  let current = url;
  for (let hop = 0; hop <= WEATHER_MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      console.warn('[weather] invalid URL ' + sanitizeLogMessage(current.slice(0, 80)));
      return null;
    }
    if (parsed.protocol !== 'https:') return null;
    if (!isAllowedHost(parsed.hostname)) {
      console.warn('[weather] host rejected ' + sanitizeLogMessage(parsed.hostname));
      return null;
    }

    let response: Response;
    try {
      response = await fetchPinned(
        current,
        {
          method: 'GET',
          headers: {
            Accept: opts.accept,
            'User-Agent': opts.userAgent,
          },
          signal: AbortSignal.timeout(opts.timeoutMs),
        },
        opts.deps,
      );
    } catch (err) {
      console.warn(
        '[weather] fetch failed ' +
          sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (!loc || hop === WEATHER_MAX_REDIRECTS) {
        discardResponseBody(response);
        return null;
      }
      try {
        current = new URL(loc, current).toString();
      } catch {
        // catch-no-log-ok malformed redirect Location
        discardResponseBody(response);
        return null;
      }
      discardResponseBody(response);
      continue;
    }

    if (!response.ok) {
      discardResponseBody(response);
      console.warn(`[weather] upstream status ${response.status}`);
      return null;
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    const accepted = opts.accept.split(',').map((s) => s.trim().split(';')[0] ?? '');
    const okType =
      accepted.some((a) => a === '*/*' || contentType === a || contentType.startsWith(a + '+')) ||
      accepted.some((a) => a.endsWith('/*') && contentType.startsWith(a.slice(0, -1)));
    if (!okType && contentType && !accepted.includes('*/*')) {
      // Allow image/png when accept includes image/*, etc.
      const wildcardOk = accepted.some(
        (a) => a.endsWith('/*') && contentType.startsWith(a.replace('/*', '/')),
      );
      if (!wildcardOk && !accepted.includes(contentType)) {
        discardResponseBody(response);
        console.warn('[weather] unexpected content-type ' + sanitizeLogMessage(contentType));
        return null;
      }
    }

    const body = await readBoundedResponseBody(response, opts.maxBytes);
    if (!body) return null;
    return { body, contentType: contentType || 'application/octet-stream' };
  }
  return null;
}
