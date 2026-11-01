// @vitest-environment node
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomMapSourceRecord } from './custom-sources';
import { createMeshTilesProtocolHandler, parseMeshTilesRequestUrl } from './protocol';
import { createTileCache } from './tile-cache';

vi.mock('electron', () => ({
  net: {
    isOnline: () => true,
    fetch: vi.fn(),
  },
}));

describe('mesh-tiles protocol', () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rmSync } = await import('fs');
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('parses valid mesh-tiles URLs and rejects bad paths', () => {
    expect(parseMeshTilesRequestUrl('mesh-tiles://osm/14/1/2.png')).toEqual({
      basemapId: 'osm',
      z: 14,
      x: 1,
      y: 2,
      retina: false,
    });
    expect(parseMeshTilesRequestUrl('mesh-tiles://dark/14/1/2@2x.png')?.retina).toBe(true);
    expect(parseMeshTilesRequestUrl('mesh-tiles://dark/14/1/2.png?source=osm-v1')).toEqual({
      basemapId: 'dark',
      z: 14,
      x: 1,
      y: 2,
      retina: false,
    });
    expect(parseMeshTilesRequestUrl('mesh-tiles://osm/../1/2.png')).toBeNull();
    expect(parseMeshTilesRequestUrl('https://evil/1/2/3.png')).toBeNull();
    expect(parseMeshTilesRequestUrl('mesh-tiles://usgs-topo/14/1/2.png')).toEqual({
      basemapId: 'usgs-topo',
      z: 14,
      x: 1,
      y: 2,
      retina: false,
    });
    expect(parseMeshTilesRequestUrl('mesh-tiles://esri/14/1/2.png')).toBeNull();
  });

  it('serves cache hits without fetching', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-tile-proto-'));
    roots.push(root);
    const cache = createTileCache(root);
    const png = Buffer.from([1, 2, 3]);
    await cache.putCachedTile({ basemapId: 'osm', z: 3, x: 1, y: 1 }, png);
    const fetchImpl = vi.fn();
    const handler = createMeshTilesProtocolHandler({
      cache,
      getAppVersion: () => '9.9.9',
      isOnline: () => true,
      fetchImpl: fetchImpl,
    });
    const res = await handler(new Request('mesh-tiles://osm/3/1/1.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
  });

  it('returns 404 offline on miss without fetching', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-tile-proto-'));
    roots.push(root);
    const cache = createTileCache(root);
    const fetchImpl = vi.fn();
    const handler = createMeshTilesProtocolHandler({
      cache,
      getAppVersion: () => '9.9.9',
      isOnline: () => false,
      fetchImpl: fetchImpl,
    });
    const res = await handler(new Request('mesh-tiles://osm/3/1/1.png'));
    expect(res.status).toBe(404);
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches, caches, and sets User-Agent on miss when online', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-tile-proto-'));
    roots.push(root);
    const cache = createTileCache(root);
    const png = Buffer.from([9, 8, 7]);
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('User-Agent')).toContain('mesh-client/9.9.9');
      return Promise.resolve(new Response(png, { status: 200 }));
    });
    const handler = createMeshTilesProtocolHandler({
      cache,
      getAppVersion: () => '9.9.9',
      isOnline: () => true,
      fetchImpl: fetchImpl,
    });
    const res = await handler(new Request('mesh-tiles://osm/3/1/1.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await cache.getCachedTile({ basemapId: 'osm', z: 3, x: 1, y: 1 })).toEqual(png);
  });

  it('sets CORP on invalid requests and failed remote fetches', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-tile-proto-'));
    roots.push(root);
    const handler = createMeshTilesProtocolHandler({
      cache: createTileCache(root),
      getAppVersion: () => '9.9.9',
      isOnline: () => true,
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    });
    const invalid = await handler(new Request('mesh-tiles://unknown/3/1/1.png'));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    const unavailable = await handler(new Request('mesh-tiles://osm/3/1/1.png'));
    expect(unavailable.status).toBe(404);
    expect(unavailable.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
  });

  describe('custom sources', () => {
    const XYZ_ID = 'xyz-0123456789ab';
    const MB_ID = 'mbtiles-0123456789ab';
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
    const record = (over: Partial<CustomMapSourceRecord> = {}): CustomMapSourceRecord => ({
      id: XYZ_ID,
      kind: 'xyz',
      name: 'Custom',
      attribution: 'A',
      addedAt: 1,
      confirmedAt: 1,
      host: 'tiles.example.org',
      urlTemplate: 'https://tiles.example.org/{z}/{x}/{y}.png?key=k',
      ...over,
    });

    function setup(opts: {
      rec?: CustomMapSourceRecord | null;
      fetchImpl?: ReturnType<typeof vi.fn>;
      addresses?: string[];
      mbtilesTile?: Buffer | null;
    }) {
      const root = mkdtempSync(path.join(tmpdir(), 'mesh-tile-proto-'));
      roots.push(root);
      const cache = createTileCache(root);
      const fetchImpl = opts.fetchImpl ?? vi.fn();
      const resolveHost = vi.fn(() => Promise.resolve(opts.addresses ?? ['93.184.216.34']));
      const readMbtilesTile = vi.fn(() => Promise.resolve(opts.mbtilesTile ?? null));
      const handler = createMeshTilesProtocolHandler({
        cache,
        getAppVersion: () => '9.9.9',
        isOnline: () => true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolveHost,
        customSources: {
          get: (id) =>
            Promise.resolve(opts.rec === undefined ? record() : opts.rec).then((r) =>
              r?.id === id ? r : null,
            ),
          readMbtilesTile,
        },
      });
      return { handler, cache, fetchImpl, resolveHost, readMbtilesTile };
    }

    it('parses custom ids but only well-formed ones', () => {
      expect(parseMeshTilesRequestUrl(`mesh-tiles://${XYZ_ID}/3/1/1.png`)?.basemapId).toBe(XYZ_ID);
      expect(parseMeshTilesRequestUrl('mesh-tiles://xyz-nothex/3/1/1.png')).toBeNull();
    });

    it('does not fetch for an unknown (never-confirmed or removed) source', async () => {
      const { handler, fetchImpl } = setup({ rec: null });
      const res = await handler(new Request(`mesh-tiles://${XYZ_ID}/3/1/1.png`));
      expect(res.status).toBe(404);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('fetches only the confirmed host, never sends the OSM referrer, and caches images', async () => {
      const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        expect(headers.get('Referer')).toBeNull();
        expect(headers.get('User-Agent')).toContain('mesh-client/9.9.9');
        expect(init?.redirect).toBe('error');
        return Promise.resolve(new Response(PNG, { status: 200 }));
      });
      const { handler, cache } = setup({ fetchImpl });
      const res = await handler(new Request(`mesh-tiles://${XYZ_ID}/3/1/2.png`));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://tiles.example.org/3/1/2.png?key=k');
      expect(await cache.getCachedTile({ basemapId: XYZ_ID, z: 3, x: 1, y: 2 })).toEqual(PNG);
      // second request is a cache hit
      await handler(new Request(`mesh-tiles://${XYZ_ID}/3/1/2.png`));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('refuses hosts that resolve to private addresses', async () => {
      const fetchImpl = vi.fn();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { handler } = setup({ fetchImpl, addresses: ['10.0.0.8'] });
      const res = await handler(new Request(`mesh-tiles://${XYZ_ID}/3/1/1.png`));
      expect(res.status).toBe(404);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('re-validates a tampered persisted template before fetching', async () => {
      const fetchImpl = vi.fn();
      const { handler } = setup({
        fetchImpl,
        rec: record({ urlTemplate: 'https://127.0.0.1/{z}/{x}/{y}.png' }),
      });
      const res = await handler(new Request(`mesh-tiles://${XYZ_ID}/3/1/1.png`));
      expect(res.status).toBe(404);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('does not cache or serve non-image / oversized responses', async () => {
      const html = vi.fn().mockResolvedValue(new Response('<html>denied</html>', { status: 200 }));
      const a = setup({ fetchImpl: html });
      expect((await a.handler(new Request(`mesh-tiles://${XYZ_ID}/3/1/1.png`))).status).toBe(404);
      expect(await a.cache.getCachedTile({ basemapId: XYZ_ID, z: 3, x: 1, y: 1 })).toBeNull();

      const big = vi.fn().mockResolvedValue(
        new Response(PNG, {
          status: 200,
          headers: { 'content-length': String(10 * 1024 * 1024) },
        }),
      );
      const b = setup({ fetchImpl: big });
      expect((await b.handler(new Request(`mesh-tiles://${XYZ_ID}/3/1/1.png`))).status).toBe(404);

      // Oversized body without a trustworthy Content-Length — chunked reader must abort.
      const oversize = Buffer.alloc(3 * 1024 * 1024, 0x89);
      const stream = vi.fn().mockResolvedValue(
        new Response(oversize, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
      const c = setup({ fetchImpl: stream });
      expect((await c.handler(new Request(`mesh-tiles://${XYZ_ID}/3/1/1.png`))).status).toBe(404);
      expect(await c.cache.getCachedTile({ basemapId: XYZ_ID, z: 3, x: 1, y: 1 })).toBeNull();
    });

    it('serves MBTiles tiles from the package and never goes online on a miss', async () => {
      const mb = record({ id: MB_ID, kind: 'mbtiles', host: undefined, urlTemplate: undefined });
      const hit = setup({ rec: mb, mbtilesTile: PNG });
      const ok = await hit.handler(new Request(`mesh-tiles://${MB_ID}/3/1/1.png`));
      expect(ok.status).toBe(200);
      expect(Buffer.from(await ok.arrayBuffer())).toEqual(PNG);
      const miss = setup({ rec: mb, mbtilesTile: null });
      expect((await miss.handler(new Request(`mesh-tiles://${MB_ID}/3/1/1.png`))).status).toBe(404);
      expect(miss.fetchImpl).not.toHaveBeenCalled();
      expect(miss.resolveHost).not.toHaveBeenCalled();
    });
  });
});
