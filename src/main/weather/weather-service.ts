import { net } from 'electron';

import { MS_PER_HOUR, MS_PER_MINUTE } from '@/shared/timeConstants';
import { buildGridCells, chooseGridStep, weatherPointCacheKey } from '@/shared/weather/grid';
import {
  RAINVIEWER_ATTRIBUTION,
  RAINVIEWER_MAX_NATIVE_ZOOM,
  selectRadarProvider,
} from '@/shared/weather/radarProviders';
import type {
  RadarFrames,
  WeatherErrorCode,
  WeatherGrid,
  WeatherPointForecast,
  WeatherRadarFramesRequest,
  WeatherResult,
} from '@/shared/weather/types';
import {
  clampZoom,
  isLatLon,
  isLatLonBounds,
  type LatLonBounds,
  normalizeLon,
  WEATHER_GRID_MAX_POINTS,
} from '@/shared/weather/validation';

import type { WeatherFetchDeps } from './http';
import { iemFrames } from './iemRadar';
import { fetchGrid, fetchPointForecast } from './openMeteo';
import { fetchRainViewerManifest, type RainViewerManifest } from './rainViewer';
import { ProviderCircuit, RateLimiter, TtlCache, withInflightDedup } from './weather-cache';
import { getWeatherProtocolState, type WeatherProtocolState } from './weather-protocol';

export interface WeatherServiceDeps extends WeatherFetchDeps {
  getAppVersion: () => string;
}

export interface WeatherService {
  pointForecast(lat: number, lon: number): Promise<WeatherResult<WeatherPointForecast>>;
  grid(bounds: LatLonBounds, zoom: number): Promise<WeatherResult<WeatherGrid>>;
  radarFrames(req: WeatherRadarFramesRequest): Promise<WeatherResult<RadarFrames>>;
  clearMemoryCache(): void;
}

function fail(
  code: WeatherErrorCode,
  message: string,
  retryAfterMs?: number,
): WeatherResult<never> {
  const error: { code: WeatherErrorCode; message: string; retryAfterMs?: number } = {
    code,
    message,
  };
  if (retryAfterMs != null) error.retryAfterMs = retryAfterMs;
  return { ok: false, error };
}

function rainViewerFramesFromManifest(manifest: RainViewerManifest, nowMs: number): RadarFrames {
  return {
    provider: 'rainviewer',
    fetchedAtMs: nowMs,
    maxNativeZoom: RAINVIEWER_MAX_NATIVE_ZOOM,
    attribution: RAINVIEWER_ATTRIBUTION,
    coverageUrlTemplate: 'mesh-weather://coverage/rainviewer/{z}/{x}/{y}.png',
    frames: manifest.frames.map((f) => ({
      provider: 'rainviewer' as const,
      id: String(Math.floor(f.timeMs / 1000)),
      timeMs: f.timeMs,
      kind: f.kind,
      tileUrlTemplate: `mesh-weather://radar/rainviewer/${Math.floor(f.timeMs / 1000)}/{z}/{x}/{y}.png`,
    })),
  };
}

export function createWeatherService(
  deps: WeatherServiceDeps,
  protocolState: WeatherProtocolState = getWeatherProtocolState(),
): WeatherService {
  const pointCache = new TtlCache<string, WeatherPointForecast>({
    maxEntries: 512,
    ttlMs: 10 * MS_PER_MINUTE,
  });
  const gridPointCache = new TtlCache<string, WeatherGrid['points'][number]>({
    maxEntries: 2048,
    ttlMs: 10 * MS_PER_MINUTE,
  });
  const negative = new TtlCache<string, true>({ maxEntries: 1024, ttlMs: 5 * MS_PER_MINUTE });
  const openMeteoCircuit = new ProviderCircuit('open-meteo');
  const openMeteoLimiter = new RateLimiter(60, MS_PER_MINUTE);
  const openMeteoHourLimiter = new RateLimiter(1000, MS_PER_HOUR);
  const rainManifestLimiter = new RateLimiter(6, MS_PER_MINUTE);
  const pointInflight = new Map<string, Promise<WeatherResult<WeatherPointForecast>>>();

  const isOnline = () => (deps.isOnline ? deps.isOnline() : net.isOnline());
  const now = () => deps.now?.() ?? Date.now();

  async function pointForecast(
    lat: number,
    lon: number,
  ): Promise<WeatherResult<WeatherPointForecast>> {
    if (!isOnline()) return fail('offline', 'offline');
    if (!isLatLon({ lat, lon })) return fail('invalid_request', 'invalid_request');
    const rLat = Number(lat.toFixed(2));
    const rLon = Number(normalizeLon(lon).toFixed(2));
    const cacheKey = weatherPointCacheKey(rLat, rLon);
    const cached = pointCache.get(cacheKey, now());
    if (cached) return { ok: true, data: cached };
    if (negative.get(`open-meteo:point:${cacheKey}`, now())) {
      return fail('provider_error', 'provider_error');
    }
    if (!openMeteoCircuit.canAttempt(now())) return fail('provider_error', 'provider_error');
    if (!openMeteoLimiter.tryAcquire(now()) || !openMeteoHourLimiter.tryAcquire(now())) {
      return fail('rate_limited', 'rate_limited', openMeteoLimiter.retryAfterMs(now()));
    }

    return withInflightDedup(pointInflight, `point:${cacheKey}`, async () => {
      const data = await fetchPointForecast(rLat, rLon, deps);
      if (!data) {
        openMeteoCircuit.recordFailure('point forecast failed', now());
        negative.set(`open-meteo:point:${cacheKey}`, true, now());
        return fail('provider_error', 'provider_error');
      }
      openMeteoCircuit.recordSuccess();
      pointCache.set(cacheKey, data, now());
      return { ok: true, data };
    });
  }

  async function grid(bounds: LatLonBounds, zoom: number): Promise<WeatherResult<WeatherGrid>> {
    if (!isOnline()) return fail('offline', 'offline');
    if (!isLatLonBounds(bounds)) return fail('invalid_request', 'invalid_request');
    const z = clampZoom(zoom);
    const step = chooseGridStep(bounds, z);
    const cells = buildGridCells({
      bounds,
      zoom: z,
      stepDeg: step,
      maxPoints: WEATHER_GRID_MAX_POINTS,
    });

    const points: WeatherGrid['points'] = [];
    const missing: typeof cells = [];
    for (const cell of cells) {
      const key = weatherPointCacheKey(cell.lat, cell.lon);
      const hit = gridPointCache.get(key, now());
      if (hit) points.push(hit);
      else missing.push(cell);
    }

    if (missing.length > 0) {
      if (!openMeteoCircuit.canAttempt(now())) {
        if (points.length === 0) return fail('provider_error', 'provider_error');
      } else if (!openMeteoLimiter.tryAcquire(now()) || !openMeteoHourLimiter.tryAcquire(now())) {
        if (points.length === 0) {
          return fail('rate_limited', 'rate_limited', openMeteoLimiter.retryAfterMs(now()));
        }
      } else {
        const fetched = await fetchGrid(missing, deps);
        if (!fetched) {
          openMeteoCircuit.recordFailure('grid fetch failed', now());
          if (points.length === 0) return fail('provider_error', 'provider_error');
        } else {
          openMeteoCircuit.recordSuccess();
          for (let i = 0; i < fetched.points.length; i++) {
            const p = fetched.points[i];
            const cell = fetched.requestCells[i];
            if (!cell) continue;
            gridPointCache.set(weatherPointCacheKey(cell.lat, cell.lon), p, now());
            points.push(p);
          }
        }
      }
    }

    return {
      ok: true,
      data: {
        provider: 'open-meteo',
        fetchedAtMs: now(),
        stepDeg: step,
        points,
        partial: points.length < cells.length,
      },
    };
  }

  async function radarFrames(req: WeatherRadarFramesRequest): Promise<WeatherResult<RadarFrames>> {
    if (!isOnline()) return fail('offline', 'offline');
    if (!isLatLonBounds(req.bounds)) return fail('invalid_request', 'invalid_request');
    const z = clampZoom(req.zoom);
    const preference =
      req.provider === 'rainviewer' || req.provider === 'iem-nexrad' || req.provider === 'auto'
        ? req.provider
        : 'auto';
    const provider = selectRadarProvider(req.bounds, z, preference);

    if (provider === 'iem-nexrad') {
      return { ok: true, data: iemFrames(now()) };
    }

    const cachedManifest = protocolState.manifestCache.get('manifest', now());
    if (cachedManifest) {
      return { ok: true, data: rainViewerFramesFromManifest(cachedManifest, now()) };
    }

    if (!protocolState.rainViewerCircuit.canAttempt(now())) {
      return fail('provider_error', 'provider_error');
    }
    if (!rainManifestLimiter.tryAcquire(now())) {
      return fail('rate_limited', 'rate_limited', rainManifestLimiter.retryAfterMs(now()));
    }

    const manifest = await fetchRainViewerManifest(deps);
    if (!manifest) {
      protocolState.rainViewerCircuit.recordFailure('manifest failed', now());
      return fail('provider_error', 'provider_error');
    }
    protocolState.rainViewerCircuit.recordSuccess();
    protocolState.manifestCache.set('manifest', manifest, now());
    return { ok: true, data: rainViewerFramesFromManifest(manifest, now()) };
  }

  function clearMemoryCache(): void {
    pointCache.clear();
    gridPointCache.clear();
    negative.clear();
    protocolState.tileCache.clear();
    protocolState.manifestCache.clear();
  }

  return { pointForecast, grid, radarFrames, clearMemoryCache };
}
