// @vitest-environment node
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await cache.getCachedTile({ basemapId: 'osm', z: 3, x: 1, y: 1 })).toEqual(png);
  });
});
