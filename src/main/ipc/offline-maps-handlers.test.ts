// @vitest-environment node
import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  assertIpcSender: vi.fn(),
  isOnline: true,
}));

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      harness.handlers.set(channel, fn);
    },
  },
  net: {
    isOnline: () => harness.isOnline,
    fetch: vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))),
  },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: (...args: unknown[]) => harness.assertIpcSender(...args),
}));

vi.mock('../log-service', async () => {
  const actual = await import('../sanitize-log-message');
  return { sanitizeLogMessage: actual.sanitizeLogMessage };
});

import type { CustomMapSourcesService } from '../offline-maps/custom-sources-service';
import type { TileCache } from '../offline-maps/tile-cache';
import { registerOfflineMapsIpcHandlers } from './offline-maps-handlers';

describe('registerOfflineMapsIpcHandlers', () => {
  const cache = {
    listCachedStats: vi.fn(() => Promise.resolve({ tileCount: 0, diskBytes: 0 })),
    readManifest: vi.fn(() =>
      Promise.resolve({ version: 1 as const, lastUpdated: 0, sources: {}, regions: [] }),
    ),
    writeManifest: vi.fn(() => Promise.resolve()),
    mutateManifest: vi.fn((fn: (m: { regions: unknown[] }) => void) => {
      const m = { version: 1 as const, lastUpdated: 0, sources: {}, regions: [] as unknown[] };
      fn(m);
      return Promise.resolve();
    }),
    clearCache: vi.fn(() => Promise.resolve()),
    clearSource: vi.fn(() => Promise.resolve()),
    getCachedTile: vi.fn(() => Promise.resolve(null)),
    putCachedTile: vi.fn(() => Promise.resolve()),
  } as unknown as TileCache;

  beforeEach(() => {
    harness.handlers.clear();
    harness.assertIpcSender.mockReset().mockImplementation(() => {});
    harness.isOnline = true;
    registerOfflineMapsIpcHandlers(
      () => null,
      () => cache,
    );
  });

  it('registers estimate/download/cancel/status/clear with assertIpcSender', async () => {
    for (const channel of [
      'offline-maps:estimate',
      'offline-maps:download',
      'offline-maps:cancel',
      'offline-maps:status',
      'offline-maps:clear',
    ] as const) {
      expect(harness.handlers.has(channel)).toBe(true);
    }
    const event = {} as IpcMainInvokeEvent;
    await harness.handlers.get('offline-maps:status')!(event);
    expect(harness.assertIpcSender).toHaveBeenCalledWith(event, 'offline-maps:status');
  });

  it('estimates a valid region', async () => {
    const result = await harness.handlers.get('offline-maps:estimate')!(
      {},
      {
        bounds: { north: 40.01, south: 40.0, east: -105.0, west: -105.01 },
        minZoom: 14,
        maxZoom: 14,
        basemapId: 'osm',
      },
    );
    expect(result).toMatchObject({ withinCaps: true });
    expect((result as { tileCount: number }).tileCount).toBeGreaterThan(0);
  });

  it('rejects non-finite / out-of-range bounds', () => {
    expect(() =>
      harness.handlers.get('offline-maps:estimate')!(
        {},
        {
          bounds: { north: NaN, south: 40.0, east: -105.0, west: -105.01 },
          minZoom: 14,
          maxZoom: 14,
          basemapId: 'osm',
        },
      ),
    ).toThrow(/Invalid estimate/);
    expect(() =>
      harness.handlers.get('offline-maps:estimate')!(
        {},
        {
          bounds: { north: 40.01, south: 40.0, east: -105.0, west: -105.01 },
          minZoom: Number.POSITIVE_INFINITY,
          maxZoom: 14,
          basemapId: 'osm',
        },
      ),
    ).toThrow(/Invalid estimate/);
  });

  it('rejects bulk download and estimate for custom source ids', () => {
    const args = {
      bounds: { north: 40.01, south: 40.0, east: -105.0, west: -105.01 },
      minZoom: 14,
      maxZoom: 14,
      basemapId: 'xyz-0123456789ab',
    };
    expect(() => harness.handlers.get('offline-maps:download')!({}, args)).toThrow(
      /Invalid download/,
    );
    expect(() => harness.handlers.get('offline-maps:estimate')!({}, args)).toThrow(
      /Invalid estimate/,
    );
  });

  it('allows clearing a custom source cache but not arbitrary ids', async () => {
    await harness.handlers.get('offline-maps:clear')!({}, 'xyz-0123456789ab');
    expect(cache.clearSource).toHaveBeenCalledWith('xyz-0123456789ab');
    await expect(harness.handlers.get('offline-maps:clear')!({}, '../x')).rejects.toThrow(
      /Invalid basemap id/,
    );
  });

  describe('custom source channels', () => {
    const service = {
      list: vi.fn(() => Promise.resolve([])),
      addXyz: vi.fn(() => Promise.resolve({ ok: false, code: 'host' })),
      remove: vi.fn(() => Promise.resolve({ ok: true })),
      pickMbtiles: vi.fn(() => Promise.resolve({ ok: false, code: 'cancelled' })),
      importMbtiles: vi.fn(() => Promise.resolve({ ok: false, code: 'unknown_inspect' })),
    };

    beforeEach(() => {
      harness.handlers.clear();
      vi.clearAllMocks();
      registerOfflineMapsIpcHandlers(
        () => null,
        () => cache,
        () => service as unknown as CustomMapSourcesService,
      );
    });

    it('guards every channel with assertIpcSender', async () => {
      const event = {};
      await harness.handlers.get('offline-maps:custom-list')!(event);
      await harness.handlers.get('offline-maps:custom-pick-mbtiles')!(event);
      await harness.handlers.get('offline-maps:custom-remove')!(event, 'xyz-0123456789ab');
      expect(harness.assertIpcSender).toHaveBeenCalledWith(event, 'offline-maps:custom-list');
      expect(harness.assertIpcSender).toHaveBeenCalledWith(
        event,
        'offline-maps:custom-pick-mbtiles',
      );
      expect(harness.assertIpcSender).toHaveBeenCalledWith(event, 'offline-maps:custom-remove');
    });

    it('forwards well-formed add/import requests and rejects malformed shapes', async () => {
      const add = harness.handlers.get('offline-maps:custom-add-xyz')!;
      const req = {
        name: 'n',
        urlTemplate: 'https://t.example.org/{z}/{x}/{y}',
        attribution: 'a',
        confirmed: true,
      };
      await add({}, req);
      expect(service.addXyz).toHaveBeenCalledWith(req);
      expect(() => add({}, { ...req, confirmed: 'yes' })).toThrow(/Invalid custom source/);
      expect(() => add({}, null)).toThrow(/Invalid custom source/);

      const imp = harness.handlers.get('offline-maps:custom-import-mbtiles')!;
      // The renderer cannot smuggle a path: unknown keys (e.g. filePath) are dropped.
      await imp(
        {},
        { inspectId: 'i', name: 'n', attribution: 'a', confirmed: true, filePath: '/etc/passwd' },
      );
      expect(service.importMbtiles).toHaveBeenCalledWith({
        inspectId: 'i',
        name: 'n',
        attribution: 'a',
        confirmed: true,
      });
      expect(() => imp({}, { inspectId: 1 })).toThrow(/Invalid MBTiles/);
    });

    it('throws when the custom-source service is unavailable', () => {
      harness.handlers.clear();
      registerOfflineMapsIpcHandlers(
        () => null,
        () => cache,
      );
      expect(() => harness.handlers.get('offline-maps:custom-list')!({})).toThrow(/not ready/);
    });
  });
});
