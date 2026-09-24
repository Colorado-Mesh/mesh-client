import { randomUUID } from 'crypto';
import { net } from 'electron';

import {
  buildRemoteTileUrl,
  meshTilesUserAgent,
  type OfflineMapBasemapId,
  OSM_TILE_HTTP_REFERRER,
} from '@/shared/offlineMaps/basemapRegistry';
import {
  enumerateRegionTiles,
  estimateRegionBytes,
  estimateTileCount,
  isRegionWithinCaps,
  type LatLonBounds,
  OFFLINE_MAP_DOWNLOAD_CONCURRENCY,
  OFFLINE_MAP_MAX_ZOOM,
  OFFLINE_MAP_TILE_FETCH_TIMEOUT_MS,
  type WebMercatorTile,
} from '@/shared/offlineMaps/tileMath';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { sanitizeLogMessage } from '../log-service';
import type { TileCache } from './tile-cache';

/** Match renderer online-recovery debounce (60s). */
const ONLINE_RESUME_DEBOUNCE_MS = 60 * MS_PER_SECOND;

export interface OfflineMapsEstimateRequest {
  bounds: LatLonBounds;
  minZoom: number;
  maxZoom: number;
  basemapId: OfflineMapBasemapId;
}

export interface OfflineMapsEstimateResult {
  tileCount: number;
  sizeEstimateBytes: number;
  withinCaps: boolean;
}

export type OfflineMapsDownloadRequest = OfflineMapsEstimateRequest;

export interface OfflineMapsProgress {
  jobId: string;
  source: OfflineMapBasemapId;
  completed: number;
  total: number;
  failed: number;
  bytes: number;
  paused: boolean;
}

export interface OfflineMapsJobResult {
  jobId: string;
  completed: number;
  failed: number;
  bytes: number;
  cancelled: boolean;
}

type ProgressCb = (p: OfflineMapsProgress) => void;
type DoneCb = (r: OfflineMapsJobResult) => void;
type ErrorCb = (e: { jobId: string; message: string }) => void;

interface ActiveJob {
  id: string;
  request: OfflineMapsDownloadRequest;
  abort: AbortController;
  cancelled: boolean;
  paused: boolean;
  completed: number;
  failed: number;
  bytes: number;
  total: number;
  queue: WebMercatorTile[];
  resumeTimer: ReturnType<typeof setTimeout> | null;
}

export interface OfflineMapsDownloaderDeps {
  cache: TileCache;
  getAppVersion: () => string;
  isOnline?: () => boolean;
  fetchImpl?: typeof fetch;
  concurrency?: number;
  onlineDebounceMs?: number;
  offlinePollMs?: number;
  onProgress: ProgressCb;
  onDone: DoneCb;
  onError: ErrorCb;
}

export class OfflineMapsDownloader {
  private readonly jobs = new Map<string, ActiveJob>();
  private readonly isOnline: () => boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly concurrency: number;
  private readonly onlineDebounceMs: number;
  private readonly offlinePollMs: number;

  constructor(private readonly deps: OfflineMapsDownloaderDeps) {
    this.isOnline = deps.isOnline ?? (() => net.isOnline());
    this.fetchImpl =
      deps.fetchImpl ??
      ((input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof input === 'string' || input instanceof Request) {
          return net.fetch(input, init);
        }
        return net.fetch(input.href, init);
      });
    this.concurrency = deps.concurrency ?? OFFLINE_MAP_DOWNLOAD_CONCURRENCY;
    this.onlineDebounceMs = deps.onlineDebounceMs ?? ONLINE_RESUME_DEBOUNCE_MS;
    this.offlinePollMs = deps.offlinePollMs ?? 1_000;
  }

  estimate(req: OfflineMapsEstimateRequest): OfflineMapsEstimateResult {
    const minZoom = Math.max(0, Math.floor(req.minZoom));
    const maxZoom = Math.min(OFFLINE_MAP_MAX_ZOOM, Math.max(minZoom, Math.floor(req.maxZoom)));
    const tileCount = estimateTileCount(req.bounds, minZoom, maxZoom);
    return {
      tileCount,
      sizeEstimateBytes: estimateRegionBytes(tileCount),
      withinCaps: isRegionWithinCaps(tileCount),
    };
  }

  start(req: OfflineMapsDownloadRequest): string {
    const estimate = this.estimate(req);
    if (!estimate.withinCaps) {
      throw new Error('Region exceeds offline download caps');
    }
    const minZoom = Math.max(0, Math.floor(req.minZoom));
    const maxZoom = Math.min(OFFLINE_MAP_MAX_ZOOM, Math.max(minZoom, Math.floor(req.maxZoom)));
    const queue = enumerateRegionTiles(req.bounds, minZoom, maxZoom);
    const id = randomUUID();
    const job: ActiveJob = {
      id,
      request: { ...req, minZoom, maxZoom },
      abort: new AbortController(),
      cancelled: false,
      paused: false,
      completed: 0,
      failed: 0,
      bytes: 0,
      total: queue.length,
      queue: [...queue],
      resumeTimer: null,
    };
    this.jobs.set(id, job);
    void this.runJob(job);
    return id;
  }

  cancel(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.cancelled = true;
    job.abort.abort();
    if (job.resumeTimer) {
      clearTimeout(job.resumeTimer);
      job.resumeTimer = null;
    }
    return true;
  }

  listActive(): OfflineMapsProgress[] {
    return [...this.jobs.values()].map((j) => ({
      jobId: j.id,
      source: j.request.basemapId,
      completed: j.completed,
      total: j.total,
      failed: j.failed,
      bytes: j.bytes,
      paused: j.paused,
    }));
  }

  private emitProgress(job: ActiveJob): void {
    this.deps.onProgress({
      jobId: job.id,
      source: job.request.basemapId,
      completed: job.completed,
      total: job.total,
      failed: job.failed,
      bytes: job.bytes,
      paused: job.paused,
    });
  }

  private async runJob(job: ActiveJob): Promise<void> {
    try {
      while (!job.cancelled && job.queue.length > 0) {
        if (!this.isOnline()) {
          job.paused = true;
          this.emitProgress(job);
          await this.waitUntilOnline(job);
          if (job.cancelled) break;
          job.paused = false;
          this.emitProgress(job);
          continue;
        }

        const batch: WebMercatorTile[] = [];
        while (batch.length < this.concurrency && job.queue.length > 0) {
          const next = job.queue.shift();
          if (next) batch.push(next);
        }
        await Promise.all(batch.map((tile) => this.fetchOne(job, tile)));
        this.emitProgress(job);
      }

      if (!job.cancelled) {
        const manifest = await this.deps.cache.readManifest();
        manifest.regions.push({
          id: job.id,
          basemapId: job.request.basemapId,
          bounds: job.request.bounds,
          minZoom: job.request.minZoom,
          maxZoom: job.request.maxZoom,
          completedAt: Date.now(),
          tileCount: job.completed,
        });
        await this.deps.cache.writeManifest(manifest);
      }

      this.deps.onDone({
        jobId: job.id,
        completed: job.completed,
        failed: job.failed,
        bytes: job.bytes,
        cancelled: job.cancelled,
      });
    } catch (e: unknown) {
      const message = sanitizeLogMessage(e instanceof Error ? e.message : String(e));
      console.warn('[offline-maps] job failed:', message);
      this.deps.onError({ jobId: job.id, message });
    } finally {
      if (job.resumeTimer) clearTimeout(job.resumeTimer);
      this.jobs.delete(job.id);
    }
  }

  private waitUntilOnline(job: ActiveJob): Promise<void> {
    return new Promise((resolve) => {
      const tick = () => {
        if (job.cancelled) {
          resolve();
          return;
        }
        if (this.isOnline()) {
          job.resumeTimer = setTimeout(() => {
            job.resumeTimer = null;
            if (!this.isOnline() && !job.cancelled) {
              void this.waitUntilOnline(job).then(resolve);
              return;
            }
            resolve();
          }, this.onlineDebounceMs);
          return;
        }
        job.resumeTimer = setTimeout(tick, this.offlinePollMs);
      };
      tick();
    });
  }

  private async fetchOne(job: ActiveJob, tile: WebMercatorTile): Promise<void> {
    if (job.cancelled) return;
    const existing = await this.deps.cache.getCachedTile({
      basemapId: job.request.basemapId,
      z: tile.z,
      x: tile.x,
      y: tile.y,
    });
    if (existing) {
      job.completed += 1;
      job.bytes += existing.byteLength;
      return;
    }

    const url = buildRemoteTileUrl(job.request.basemapId, tile.z, tile.x, tile.y, {
      subdomainIndex: (tile.x + tile.y) % 4,
    });
    try {
      const res = await this.fetchImpl(url, {
        headers: {
          'User-Agent': meshTilesUserAgent(this.deps.getAppVersion()),
          Referer: OSM_TILE_HTTP_REFERRER,
        },
        signal: AbortSignal.timeout(OFFLINE_MAP_TILE_FETCH_TIMEOUT_MS),
      });
      if (job.cancelled || job.abort.signal.aborted) return;
      if (!res.ok) {
        job.failed += 1;
        return;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      await this.deps.cache.putCachedTile(
        { basemapId: job.request.basemapId, z: tile.z, x: tile.x, y: tile.y },
        buf,
      );
      job.completed += 1;
      job.bytes += buf.byteLength;
    } catch (e: unknown) {
      if (job.cancelled || job.abort.signal.aborted) return;
      if (!this.isOnline()) {
        job.queue.unshift(tile);
        return;
      }
      console.debug(
        '[offline-maps] tile fetch failed:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      job.failed += 1;
    }
  }
}
