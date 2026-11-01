import { app, type BrowserWindow, ipcMain, net } from 'electron';

import type { OfflineMapBasemapId } from '@/shared/offlineMaps/basemapRegistry';
import { isMapSourceId, isOfflineMapBasemapId } from '@/shared/offlineMaps/basemapRegistry';
import type {
  AddXyzSourceRequest,
  ImportMbtilesRequest,
} from '@/shared/offlineMaps/customMapSources';
import type { LatLonBounds } from '@/shared/offlineMaps/tileMath';

import { sanitizeLogMessage } from '../log-service';
import type { CustomMapSourcesService } from '../offline-maps/custom-sources-service';
import { OfflineMapsDownloader } from '../offline-maps/downloader';
import type { TileCache } from '../offline-maps/tile-cache';
import { assertIpcSender } from '../validate-ipc-sender';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLatLonBounds(value: unknown): value is LatLonBounds {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  if (
    !isFiniteNumber(b.north) ||
    !isFiniteNumber(b.south) ||
    !isFiniteNumber(b.east) ||
    !isFiniteNumber(b.west)
  ) {
    return false;
  }
  if (b.north < -90 || b.north > 90 || b.south < -90 || b.south > 90) return false;
  if (b.north < b.south) return false;
  // Longitude may wrap the antimeridian; reject only absurd magnitudes.
  if (Math.abs(b.east) > 360 || Math.abs(b.west) > 360) return false;
  return true;
}

function parseDownloadArgs(raw: unknown): {
  bounds: LatLonBounds;
  minZoom: number;
  maxZoom: number;
  basemapId: OfflineMapBasemapId;
  retina?: boolean;
} | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!isLatLonBounds(o.bounds)) return null;
  if (!isOfflineMapBasemapId(o.basemapId)) return null;
  if (!isFiniteNumber(o.minZoom) || !isFiniteNumber(o.maxZoom)) return null;
  const retina = o.retina === true && o.basemapId === 'dark' ? true : undefined;
  return {
    bounds: o.bounds,
    minZoom: o.minZoom,
    maxZoom: o.maxZoom,
    basemapId: o.basemapId,
    ...(retina ? { retina: true } : {}),
  };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
}

/** Shape-only parse; semantic validation (URL policy, text limits) happens in the main-process store. */
function parseAddXyzArgs(raw: unknown): AddXyzSourceRequest | null {
  const o = asRecord(raw);
  if (!o) return null;
  if (typeof o.name !== 'string' || typeof o.urlTemplate !== 'string') return null;
  if (typeof o.attribution !== 'string' || typeof o.confirmed !== 'boolean') return null;
  if (o.maxNativeZoom != null && typeof o.maxNativeZoom !== 'number') return null;
  return {
    name: o.name,
    urlTemplate: o.urlTemplate,
    attribution: o.attribution,
    confirmed: o.confirmed,
    ...(typeof o.maxNativeZoom === 'number' ? { maxNativeZoom: o.maxNativeZoom } : {}),
  };
}

function parseImportMbtilesArgs(raw: unknown): ImportMbtilesRequest | null {
  const o = asRecord(raw);
  if (!o) return null;
  if (typeof o.inspectId !== 'string' || typeof o.name !== 'string') return null;
  if (typeof o.attribution !== 'string' || typeof o.confirmed !== 'boolean') return null;
  return {
    inspectId: o.inspectId,
    name: o.name,
    attribution: o.attribution,
    confirmed: o.confirmed,
  };
}

let downloader: OfflineMapsDownloader | null = null;

export function registerOfflineMapsIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  getCache: () => TileCache | null,
  getCustomSources: () => CustomMapSourcesService | null = () => null,
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
    if (!isMapSourceId(source)) throw new Error('Invalid basemap id');
    await cache.clearSource(source);
    return { ok: true };
  });

  const requireCustom = (): CustomMapSourcesService => {
    const svc = getCustomSources();
    if (!svc) throw new Error('Custom map sources not ready');
    return svc;
  };

  ipcMain.handle('offline-maps:custom-list', (event) => {
    assertIpcSender(event, 'offline-maps:custom-list');
    return requireCustom().list();
  });

  ipcMain.handle('offline-maps:custom-add-xyz', (event, raw: unknown) => {
    assertIpcSender(event, 'offline-maps:custom-add-xyz');
    const args = parseAddXyzArgs(raw);
    if (!args) throw new Error('Invalid custom source request');
    return requireCustom().addXyz(args);
  });

  ipcMain.handle('offline-maps:custom-remove', (event, id: unknown) => {
    assertIpcSender(event, 'offline-maps:custom-remove');
    if (typeof id !== 'string') throw new Error('Invalid source id');
    return requireCustom().remove(id);
  });

  ipcMain.handle('offline-maps:custom-pick-mbtiles', (event) => {
    assertIpcSender(event, 'offline-maps:custom-pick-mbtiles');
    return requireCustom().pickMbtiles();
  });

  ipcMain.handle('offline-maps:custom-import-mbtiles', (event, raw: unknown) => {
    assertIpcSender(event, 'offline-maps:custom-import-mbtiles');
    const args = parseImportMbtilesArgs(raw);
    if (!args) throw new Error('Invalid MBTiles import request');
    return requireCustom().importMbtiles(args);
  });
}
