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
});
