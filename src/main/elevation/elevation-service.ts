import { net } from 'electron';
import path from 'path';

import { computeTerrainClearance, sampleGreatCirclePoints } from '@/shared/elevation/profileMath';
import type {
  ElevationCacheStats,
  ElevationHgtEstimate,
  ElevationHgtEstimateRequest,
  ElevationHgtProgress,
  ElevationProfileRequest,
  ElevationProfileResult,
  ElevationProfileSample,
  ElevationResult,
} from '@/shared/elevation/types';
import { MAX_PATH_KM } from '@/shared/elevation/validation';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { sanitizeLogMessage } from '../log-service';
import {
  fetchBounded,
  WEATHER_JSON_TIMEOUT_MS,
  type WeatherFetchDeps,
  weatherUserAgent,
} from '../weather/http';
import {
  createHgtElevationReader,
  downloadHgtTile,
  HGT_TILE_BYTES,
  type HgtElevationReader,
  hgtTileExists,
  hgtTilesForBounds,
  listHgtTiles,
} from './hgt';
import { ElevationSampleCache } from './sample-cache';

const OPEN_METEO_ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
const ELEVATION_JSON_MAX_BYTES = 256 * 1024;
const BATCH_SIZE = 50;

export interface ElevationServiceDeps extends WeatherFetchDeps {
  getAppVersion: () => string;
  userDataPath: string;
}

export interface ElevationService {
  sampleProfile(req: ElevationProfileRequest): Promise<ElevationResult<ElevationProfileResult>>;
  estimateHgt(req: ElevationHgtEstimateRequest): Promise<ElevationResult<ElevationHgtEstimate>>;
  downloadHgt(
    req: ElevationHgtEstimateRequest & { jobId: string },
    onProgress: (p: ElevationHgtProgress) => void,
  ): Promise<ElevationResult<{ completed: number; failed: number }>>;
  cancelDownload(jobId: string): void;
  cacheStats(): Promise<ElevationCacheStats>;
  clearCache(): Promise<void>;
}

/**
 * Prefer Electron `net.isOnline()`. Do not fall back to Node's global `navigator.onLine`:
 * Node exposes `navigator` but leaves `onLine` undefined, which is falsy and falsely reports offline.
 */
function isOnline(deps: ElevationServiceDeps): boolean {
  return deps.isOnline ? deps.isOnline() : net.isOnline();
}

export function createElevationService(deps: ElevationServiceDeps): ElevationService {
  const cacheDir = path.join(deps.userDataPath, 'elevation-cache');
  const sampleCache = new ElevationSampleCache(cacheDir);
  const abortByJob = new Map<string, AbortController>();
  let loadPromise: Promise<void> | null = null;

  async function ensureLoaded(): Promise<void> {
    loadPromise ??= sampleCache.load();
    await loadPromise;
  }

  async function elevationAt(
    lat: number,
    lon: number,
    hgtReader: HgtElevationReader,
  ): Promise<{
    elevationM: number | null;
    /** True when value came from persisted Open-Meteo sample cache (not offline DEM). */
    fromSampleCache: boolean;
    fromHgt: boolean;
  }> {
    await ensureLoaded();
    // Prefer HGT DEM over rounded network sample cache (higher resolution; not mixed into cache).
    const hgt = await hgtReader.read(lat, lon);
    if (hgt != null) {
      return { elevationM: hgt, fromSampleCache: false, fromHgt: true };
    }
    const cached = sampleCache.get(lat, lon);
    if (cached != null) {
      return { elevationM: cached, fromSampleCache: true, fromHgt: false };
    }
    return { elevationM: null, fromSampleCache: false, fromHgt: false };
  }

  async function fetchOpenMeteoBatch(
    points: { lat: number; lon: number }[],
  ): Promise<(number | null)[]> {
    if (points.length === 0) return [];
    const lats = points.map((p) => p.lat.toFixed(5)).join(',');
    const lons = points.map((p) => p.lon.toFixed(5)).join(',');
    const url = `${OPEN_METEO_ELEVATION_URL}?latitude=${lats}&longitude=${lons}`;
    const fetched = await fetchBounded(url, {
      timeoutMs: WEATHER_JSON_TIMEOUT_MS,
      maxBytes: ELEVATION_JSON_MAX_BYTES,
      accept: 'application/json',
      userAgent: weatherUserAgent(deps.getAppVersion()),
      deps,
    });
    if (!fetched) return points.map(() => null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fetched.body.toString('utf8'));
    } catch {
      // catch-no-log-ok invalid Open-Meteo JSON → treat as missing elevations
      return points.map(() => null);
    }
    const elevRaw =
      parsed != null && typeof parsed === 'object'
        ? (parsed as { elevation?: unknown }).elevation
        : undefined;
    if (!Array.isArray(elevRaw)) return points.map(() => null);
    const elevList: unknown[] = elevRaw;
    return points.map((_, i) => {
      const v = elevList[i];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    });
  }

  return {
    async sampleProfile(req) {
      await ensureLoaded();
      const start: [number, number] = [req.start.lat, req.start.lon];
      const end: [number, number] = [req.end.lat, req.end.lon];
      const count = req.sampleCount ?? 64;
      const pathPoints = sampleGreatCirclePoints(start, end, count);
      if (pathPoints.length < 2) {
        return {
          ok: false,
          error: { code: 'invalid_request', message: 'invalid_path' },
        };
      }
      const totalM = pathPoints[pathPoints.length - 1]?.distanceM ?? 0;
      if (totalM / 1000 > MAX_PATH_KM) {
        return {
          ok: false,
          error: { code: 'invalid_request', message: 'path_too_long' },
        };
      }

      const elevations: (number | null)[] = Array.from({ length: pathPoints.length }, () => null);
      let usedNetwork = false;
      let anySampleCacheHit = false;
      let allResolvedFromHgt = true;
      const needNetwork: { index: number; lat: number; lon: number }[] = [];
      const hgtReader = createHgtElevationReader(cacheDir);

      try {
        for (let i = 0; i < pathPoints.length; i++) {
          const p = pathPoints[i];
          if (!p) continue;
          const local = await elevationAt(p.lat, p.lon, hgtReader);
          if (local.elevationM != null) {
            elevations[i] = local.elevationM;
            if (local.fromSampleCache) {
              anySampleCacheHit = true;
              allResolvedFromHgt = false;
            } else if (!local.fromHgt) {
              allResolvedFromHgt = false;
            }
          } else {
            allResolvedFromHgt = false;
            needNetwork.push({ index: i, lat: p.lat, lon: p.lon });
          }
        }

        if (needNetwork.length > 0 && isOnline(deps)) {
          for (let offset = 0; offset < needNetwork.length; offset += BATCH_SIZE) {
            const batch = needNetwork.slice(offset, offset + BATCH_SIZE);
            const values = await fetchOpenMeteoBatch(batch);
            usedNetwork = true;
            for (let j = 0; j < batch.length; j++) {
              const elev = values[j];
              const item = batch[j];
              if (item && elev != null) {
                elevations[item.index] = elev;
                sampleCache.set(item.lat, item.lon, elev);
              }
            }
          }
          try {
            await sampleCache.flush();
          } catch (err: unknown) {
            console.warn(
              '[elevation] sampleCache.flush ' +
                sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
            );
          }
        }
      } finally {
        await hgtReader.close();
      }

      // fullyOffline: every sample from HGT DEM this call (network sample-cache hits do not count).
      const fullyOffline =
        !usedNetwork && !anySampleCacheHit && allResolvedFromHgt && needNetwork.length === 0;

      const freq = req.frequencyMhz ?? 915;
      const antStart = req.antennaHeightStartM ?? 2;
      const antEnd = req.antennaHeightEndM ?? 2;
      const summary = computeTerrainClearance({
        distancesM: pathPoints.map((p) => p.distanceM),
        elevationsM: elevations,
        frequencyMhz: freq,
        antennaHeightStartM: antStart,
        antennaHeightEndM: antEnd,
      });

      if (summary.clearance === 'unknown' && elevations.every((e) => e == null)) {
        return {
          ok: false,
          error: {
            code: isOnline(deps) ? 'no_elevation' : 'offline',
            message: 'no_elevation',
          },
        };
      }

      const samples: ElevationProfileSample[] = pathPoints.map((p, i) => {
        const c = summary.samples[i];
        return {
          lat: p.lat,
          lon: p.lon,
          distanceM: p.distanceM,
          elevationM: elevations[i] ?? null,
          losHeightM: c?.losHeightM ?? null,
          fresnelRadiusM: c?.fresnelRadiusM ?? null,
          clearanceM: c?.clearanceM ?? null,
          effectiveElevationM: c?.effectiveElevationM ?? null,
        };
      });

      return {
        ok: true,
        data: {
          samples,
          totalDistanceM: totalM,
          frequencyMhz: freq,
          antennaHeightStartM: antStart,
          antennaHeightEndM: antEnd,
          clearance: summary.clearance,
          minClearanceM: summary.minClearanceM,
          usedNetwork,
          fullyOffline,
        },
      };
    },

    async estimateHgt(req) {
      const tileNames = hgtTilesForBounds(req);
      const missing: string[] = [];
      for (const name of tileNames) {
        if (!(await hgtTileExists(cacheDir, name))) missing.push(name);
      }
      return {
        ok: true,
        data: {
          tileNames,
          missingTileNames: missing,
          missingBytes: missing.length * HGT_TILE_BYTES,
        },
      };
    },

    async downloadHgt(req, onProgress) {
      const tileNames = hgtTilesForBounds(req);
      const missing: string[] = [];
      for (const name of tileNames) {
        if (!(await hgtTileExists(cacheDir, name))) missing.push(name);
      }
      const jobId = req.jobId;
      const controller = new AbortController();
      abortByJob.set(jobId, controller);
      let completed = 0;
      let failed = 0;
      const total = missing.length;
      try {
        if (total === 0) {
          onProgress({ jobId, completed: 0, total: 0, failed: 0, done: true });
          return { ok: true, data: { completed: 0, failed: 0 } };
        }
        if (!isOnline(deps)) {
          return { ok: false, error: { code: 'offline', message: 'offline' } };
        }
        for (const tile of missing) {
          if (controller.signal.aborted) {
            onProgress({
              jobId,
              completed,
              total,
              failed,
              cancelled: true,
              done: true,
            });
            return { ok: false, error: { code: 'cancelled', message: 'cancelled' } };
          }
          onProgress({ jobId, completed, total, failed, currentTile: tile });
          const ok = await downloadHgtTile(cacheDir, tile, {
            getAppVersion: deps.getAppVersion,
            fetchImpl: deps.fetchImpl,
            signal: controller.signal,
          });
          if (ok) completed += 1;
          else failed += 1;
          onProgress({ jobId, completed, total, failed, currentTile: tile });
        }
        onProgress({ jobId, completed, total, failed, done: true });
        return { ok: true, data: { completed, failed } };
      } catch (err) {
        console.warn(
          '[elevation] downloadHgt ' +
            sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
        );
        return { ok: false, error: { code: 'fetch_failed', message: 'fetch_failed' } };
      } finally {
        abortByJob.delete(jobId);
      }
    },

    cancelDownload(jobId) {
      abortByJob.get(jobId)?.abort();
      abortByJob.delete(jobId);
    },

    async cacheStats() {
      await ensureLoaded();
      const hgt = await listHgtTiles(cacheDir);
      return {
        sampleEntries: sampleCache.size(),
        hgtTiles: hgt.count,
        hgtBytes: hgt.bytes,
      };
    },

    async clearCache() {
      await ensureLoaded();
      await sampleCache.clear();
      // Leave HGT tiles; operator can clear via dedicated path later if needed.
      // Clearing HGT is expensive to re-download — expose via clearHgt in same clear for now.
      const hgt = await listHgtTiles(cacheDir);
      const fs = await import('fs/promises');
      for (const name of hgt.names) {
        await fs.unlink(path.join(cacheDir, 'hgt', `${name}.hgt`)).catch(() => {
          // catch-no-log-ok
        });
      }
    },
  };
}

/** Test helper delay constant (unused in prod). */
export const ELEVATION_FLUSH_DEBOUNCE_MS = 2 * MS_PER_SECOND;
