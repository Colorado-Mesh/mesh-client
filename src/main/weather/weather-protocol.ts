import { net } from 'electron';

import { MS_PER_MINUTE } from '@/shared/timeConstants';
import {
  buildIemNexradUrl,
  buildRainViewerCoverageUrl,
  buildRainViewerRadarUrl,
} from '@/shared/weather/radarProviders';
import { WEATHER_RADAR_MAX_ZOOM, WEATHER_TILE_MAX_BYTES } from '@/shared/weather/validation';

import { sanitizeLogMessage } from '../log-service';
import {
  fetchBounded,
  WEATHER_TILE_TIMEOUT_MS,
  type WeatherFetchDeps,
  weatherUserAgent,
} from './http';
import { IEM_RADAR_LAGS, iemUpstreamLayer, radarBucketMs } from './iemRadar';
import {
  fetchRainViewerManifest,
  pathForRainViewerTime,
  type RainViewerManifest,
} from './rainViewer';
import { ProviderCircuit, RateLimiter, TtlCache, withInflightDedup } from './weather-cache';

export interface WeatherProtocolDeps extends WeatherFetchDeps {
  getAppVersion: () => string;
}

interface ParsedWeatherTile {
  kind: 'radar' | 'coverage';
  provider: 'rainviewer' | 'iem';
  frameId: string;
  z: number;
  x: number;
  y: number;
  bucket: number | null;
}

const LAG_SET = new Set<number>(IEM_RADAR_LAGS);

export function parseMeshWeatherUrl(urlString: string): ParsedWeatherTile | null {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    // catch-no-log-ok invalid mesh-weather URL
    return null;
  }
  if (url.protocol !== 'mesh-weather:') return null;
  const kind = url.hostname;
  if (kind !== 'radar' && kind !== 'coverage') return null;
  const parts = url.pathname
    .replace(/^\//, '')
    .replace(/\.png$/, '')
    .split('/');
  // radar/rainviewer/<frame>/<z>/<x>/<y>  OR coverage/rainviewer/<z>/<x>/<y>
  // radar/iem/<lag>/<z>/<x>/<y>
  if (kind === 'coverage') {
    if (parts.length !== 4) return null;
    const [provider, zS, xS, yS] = parts;
    if (provider !== 'rainviewer') return null;
    const z = Number(zS);
    const x = Number(xS);
    const y = Number(yS);
    if (!validTile(z, x, y)) return null;
    return { kind: 'coverage', provider: 'rainviewer', frameId: '', z, x, y, bucket: null };
  }
  if (parts.length !== 5) return null;
  const [provider, frameId, zS, xS, yS] = parts;
  if (provider !== 'rainviewer' && provider !== 'iem') return null;
  const z = Number(zS);
  const x = Number(xS);
  const y = Number(yS);
  if (!validTile(z, x, y)) return null;
  if (provider === 'iem') {
    const lag = Number(frameId);
    if (!LAG_SET.has(lag)) return null;
    const t = url.searchParams.get('t');
    const bucket = t != null ? Number(t) : Number.NaN;
    if (!Number.isFinite(bucket)) return null;
    return { kind: 'radar', provider: 'iem', frameId: String(lag), z, x, y, bucket };
  }
  if (!/^\d+$/.test(frameId)) return null;
  return { kind: 'radar', provider: 'rainviewer', frameId, z, x, y, bucket: null };
}

function validTile(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || z < 0 || z > WEATHER_RADAR_MAX_ZOOM) return false;
  const max = 2 ** z;
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < max && y < max;
}

function pngResponse(body: Buffer, status = 200): Response {
  const ab = new Uint8Array(body.byteLength);
  ab.set(body);
  return new Response(ab, {
    status,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'no-store',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: {
      'cache-control': 'no-store',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}

/** Shared tile fetch outcome — callers each build a fresh Response (body is single-use). */
export type WeatherTileInflightResult = { ok: true; body: Buffer } | { ok: false; status: number };

export interface WeatherProtocolState {
  tileCache: TtlCache<string, Buffer>;
  tileLimiter: RateLimiter;
  rainViewerCircuit: ProviderCircuit;
  iemCircuit: ProviderCircuit;
  manifestCache: TtlCache<string, RainViewerManifest>;
  inflight: Map<string, Promise<WeatherTileInflightResult>>;
  lastFailLogMs: Map<string, number>;
}

/** ~16 RainViewer frames × ~25 visible tiles for one initial playback pass. */
const TILE_RATE_LIMIT_PER_MINUTE = 16 * 25;

export function createWeatherProtocolState(): WeatherProtocolState {
  return {
    tileCache: new TtlCache({
      maxEntries: 512,
      ttlMs: 30 * MS_PER_MINUTE,
      maxBytes: 96 * 1024 * 1024,
    }),
    tileLimiter: new RateLimiter(TILE_RATE_LIMIT_PER_MINUTE, MS_PER_MINUTE),
    rainViewerCircuit: new ProviderCircuit('rainviewer'),
    iemCircuit: new ProviderCircuit('iem-nexrad'),
    manifestCache: new TtlCache({ maxEntries: 1, ttlMs: 5 * MS_PER_MINUTE }),
    inflight: new Map(),
    lastFailLogMs: new Map(),
  };
}

let sharedState: WeatherProtocolState | null = null;

export function getWeatherProtocolState(): WeatherProtocolState {
  sharedState ??= createWeatherProtocolState();
  return sharedState;
}

export function resetWeatherProtocolStateForTests(): void {
  sharedState = createWeatherProtocolState();
}

export function createWeatherProtocolHandler(
  deps: WeatherProtocolDeps,
  state: WeatherProtocolState = getWeatherProtocolState(),
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const isOnline = deps.isOnline ?? (() => net.isOnline());
    if (!isOnline()) return emptyResponse(503);

    const parsed = parseMeshWeatherUrl(request.url);
    if (!parsed) return emptyResponse(400);

    const cacheKey = request.url;
    const cached = state.tileCache.get(cacheKey, deps.now?.());
    if (cached) return pngResponse(cached);

    if (!state.tileLimiter.tryAcquire(deps.now?.())) return emptyResponse(429);

    const shared = await withInflightDedup(state.inflight, cacheKey, async () => {
      try {
        const upstream = await resolveUpstream(parsed, deps, state);
        if (!upstream) return { ok: false as const, status: 404 };
        const circuit = parsed.provider === 'iem' ? state.iemCircuit : state.rainViewerCircuit;
        if (!circuit.canAttempt(deps.now?.())) return { ok: false as const, status: 503 };

        const result = await fetchBounded(upstream, {
          timeoutMs: WEATHER_TILE_TIMEOUT_MS,
          maxBytes: WEATHER_TILE_MAX_BYTES,
          accept: 'image/png,image/*',
          userAgent: weatherUserAgent(deps.getAppVersion()),
          deps,
        });
        if (!result) {
          circuit.recordFailure('tile fetch failed', deps.now?.());
          logFailOnce(state, cacheKey, 'tile fetch failed', deps.now?.());
          return { ok: false as const, status: 404 };
        }
        circuit.recordSuccess();
        state.tileCache.set(cacheKey, result.body, deps.now?.(), result.body.byteLength);
        return { ok: true as const, body: result.body };
      } catch (err) {
        // catch-no-log-ok rate-limited via logFailOnce
        logFailOnce(
          state,
          cacheKey,
          err instanceof Error ? err.message : String(err),
          deps.now?.(),
        );
        return { ok: false as const, status: 404 };
      }
    });
    return shared.ok ? pngResponse(shared.body) : emptyResponse(shared.status);
  };
}

async function resolveUpstream(
  parsed: ParsedWeatherTile,
  deps: WeatherProtocolDeps,
  state: WeatherProtocolState,
): Promise<string | null> {
  if (parsed.provider === 'iem') {
    const now = deps.now?.() ?? Date.now();
    const expected = radarBucketMs(now);
    if (parsed.bucket == null || Math.abs(parsed.bucket - expected) > 30 * MS_PER_MINUTE) {
      return null;
    }
    const lag = Number(parsed.frameId);
    return buildIemNexradUrl(iemUpstreamLayer(lag), parsed.z, parsed.x, parsed.y);
  }

  let manifest = state.manifestCache.get('manifest', deps.now?.());
  if (!manifest) {
    manifest = (await fetchRainViewerManifest(deps)) ?? undefined;
    if (manifest) state.manifestCache.set('manifest', manifest, deps.now?.());
  }
  if (!manifest) return null;

  if (parsed.kind === 'coverage') {
    return buildRainViewerCoverageUrl(manifest.host, parsed.z, parsed.x, parsed.y);
  }

  const timeSeconds = Number(parsed.frameId);
  let path = pathForRainViewerTime(manifest, timeSeconds);
  if (!path) {
    const refreshed = await fetchRainViewerManifest(deps);
    if (refreshed) {
      state.manifestCache.set('manifest', refreshed, deps.now?.());
      path = pathForRainViewerTime(refreshed, timeSeconds);
      manifest = refreshed;
    }
  }
  if (!path) return null;
  return buildRainViewerRadarUrl(manifest.host, path, parsed.z, parsed.x, parsed.y);
}

function logFailOnce(
  state: WeatherProtocolState,
  key: string,
  message: string,
  nowMs = Date.now(),
): void {
  const last = state.lastFailLogMs.get(key) ?? 0;
  if (nowMs - last < 5 * MS_PER_MINUTE) return;
  state.lastFailLogMs.set(key, nowMs);
  console.warn('[weather] tile ' + sanitizeLogMessage(message.slice(0, 200)));
}
