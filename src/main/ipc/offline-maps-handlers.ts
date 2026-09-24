import { app, type BrowserWindow, ipcMain, net } from 'electron';

import type { OfflineMapBasemapId } from '@/shared/offlineMaps/basemapRegistry';
import { isOfflineMapBasemapId } from '@/shared/offlineMaps/basemapRegistry';
import type { LatLonBounds } from '@/shared/offlineMaps/tileMath';

import { sanitizeLogMessage } from '../log-service';
import { OfflineMapsDownloader } from '../offline-maps/downloader';
import type { TileCache } from '../offline-maps/tile-cache';
import { assertIpcSender } from '../validate-ipc-sender';

function isLatLonBounds(value: unknown): value is LatLonBounds {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return (
    typeof b.north === 'number' &&
    typeof b.south === 'number' &&
    typeof b.east === 'number' &&
    typeof b.west === 'number'
  );
}

function parseDownloadArgs(raw: unknown): {
  bounds: LatLonBounds;
  minZoom: number;
  maxZoom: number;
  basemapId: OfflineMapBasemapId;
} | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!isLatLonBounds(o.bounds)) return null;
  if (!isOfflineMapBasemapId(o.basemapId)) return null;
  if (typeof o.minZoom !== 'number' || typeof o.maxZoom !== 'number') return null;
  return {
    bounds: o.bounds,
    minZoom: o.minZoom,
    maxZoom: o.maxZoom,
    basemapId: o.basemapId,
  };
}

let downloader: OfflineMapsDownloader | null = null;

export function registerOfflineMapsIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  getCache: () => TileCache | null,
): void {
  const send = (channel: string, payload: unknown) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  };

  const ensureDownloader = (): OfflineMapsDownloader => {
    if (downloader) return downloader;
    const cache = getCache();
    if (!cache) {
      throw new Error('Tile cache not ready');
    }
    downloader = new OfflineMapsDownloader({
      cache,
      getAppVersion: () => app.getVersion(),
      isOnline: () => net.isOnline(),
      onProgress: (p) => {
        send('offline-maps:progress', p);
      },
      onDone: (r) => {
        send('offline-maps:done', r);
      },
      onError: (e) => {
        send('offline-maps:error', e);
      },
    });
    return downloader;
  };

  ipcMain.handle('offline-maps:estimate', (event, raw: unknown) => {
    assertIpcSender(event, 'offline-maps:estimate');
    const args = parseDownloadArgs(raw);
    if (!args) throw new Error('Invalid estimate request');
    return ensureDownloader().estimate(args);
  });

  ipcMain.handle('offline-maps:download', (event, raw: unknown) => {
    assertIpcSender(event, 'offline-maps:download');
    const args = parseDownloadArgs(raw);
    if (!args) throw new Error('Invalid download request');
    if (!net.isOnline()) {
      throw new Error('Offline — cannot start map download');
    }
    try {
      const jobId = ensureDownloader().start(args);
      return { jobId };
    } catch (e: unknown) {
      const message = sanitizeLogMessage(e instanceof Error ? e.message : String(e));
      console.warn('[offline-maps] download start failed:', message);
      throw new Error(message);
    }
  });

  ipcMain.handle('offline-maps:cancel', (event, jobId: unknown) => {
    assertIpcSender(event, 'offline-maps:cancel');
    if (typeof jobId !== 'string' || !jobId) throw new Error('Invalid job id');
    return { cancelled: ensureDownloader().cancel(jobId) };
  });

  ipcMain.handle('offline-maps:status', async (event) => {
    assertIpcSender(event, 'offline-maps:status');
    const cache = getCache();
    const stats = cache ? await cache.listCachedStats() : { tileCount: 0, diskBytes: 0 };
    const manifest = cache ? await cache.readManifest() : null;
    return {
      activeJobs: downloader?.listActive() ?? [],
      stats,
      regions: manifest?.regions ?? [],
      sources: manifest?.sources ?? {},
    };
  });

  ipcMain.handle('offline-maps:clear', async (event, source: unknown) => {
    assertIpcSender(event, 'offline-maps:clear');
    const cache = getCache();
    if (!cache) throw new Error('Tile cache not ready');
    if (source == null || source === 'all') {
      await cache.clearCache();
      return { ok: true };
    }
    if (!isOfflineMapBasemapId(source)) throw new Error('Invalid basemap id');
    await cache.clearSource(source);
    return { ok: true };
  });
}
