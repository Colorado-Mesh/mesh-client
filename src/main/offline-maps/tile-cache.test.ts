// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import type { TileCache } from './tile-cache';
import { createTileCache, parseTileCoords } from './tile-cache';

describe('tile-cache', () => {
  const roots: string[] = [];

  afterEach(async () => {
    const { rmSync } = await import('fs');
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function makeCache(maxBytes = 1024 * 1024): TileCache {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-tile-cache-'));
    roots.push(root);
    return createTileCache(root, maxBytes);
  }

  it('rejects traversal and overflow coords', () => {
    expect(parseTileCoords('osm', '14', '1', '../2')).toBeNull();
    expect(parseTileCoords('osm', '-1', '0', '0')).toBeNull();
    expect(parseTileCoords('evil', '1', '0', '0')).toBeNull();
    expect(parseTileCoords('osm', '1', '999', '0')).toBeNull();
  });

  it('round-trips put/get including retina', async () => {
    const cache = makeCache();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await cache.putCachedTile({ basemapId: 'osm', z: 3, x: 1, y: 2 }, png);
    await cache.putCachedTile({ basemapId: 'dark', z: 3, x: 1, y: 2, retina: true }, png);
    expect(await cache.getCachedTile({ basemapId: 'osm', z: 3, x: 1, y: 2 })).toEqual(png);
    expect(
      await cache.getCachedTile({ basemapId: 'dark', z: 3, x: 1, y: 2, retina: true }),
    ).toEqual(png);
    expect(await cache.getCachedTile({ basemapId: 'osm', z: 3, x: 1, y: 9 })).toBeNull();
  });

  it('persists manifest stats across reload', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-tile-cache-'));
    roots.push(root);
    const cache = createTileCache(root);
    await cache.putCachedTile({ basemapId: 'osm', z: 2, x: 0, y: 0 }, Buffer.alloc(10));
    const stats = await cache.listCachedStats();
    expect(stats.tileCount).toBe(1);
    expect(stats.diskBytes).toBe(10);

    const reloaded = createTileCache(root);
    const again = await reloaded.listCachedStats();
    expect(again.tileCount).toBe(1);
  });

  it('isolates new dark tiles from cached CARTO errors without deleting old regions or files', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mesh-tile-cache-'));
    roots.push(root);
    const legacyDir = path.join(root, 'tile-cache', 'dark', '3', '1');
    mkdirSync(legacyDir, { recursive: true });
    const oldTile = path.join(legacyDir, '2.png');
    writeFileSync(oldTile, 'CARTO API KEY REQUIRED');
    const cache = createTileCache(root);
    const region = {
      id: 'saved-dark-region',
      basemapId: 'dark' as const,
      bounds: { north: 40, south: 39, east: -104, west: -105 },
      minZoom: 3,
      maxZoom: 3,
      completedAt: 1,
      tileCount: 1,
    };
    await cache.mutateManifest((m) => {
      m.regions.push(region);
    });
    const coords = { basemapId: 'dark' as const, z: 3, x: 1, y: 2 };
    expect(await cache.getCachedTile(coords)).toBeNull();
    const freshTile = Buffer.from('OSM tile');
    await cache.putCachedTile(coords, freshTile);
    expect(await cache.getCachedTile(coords)).toEqual(freshTile);
    expect(readFileSync(oldTile, 'utf8')).toBe('CARTO API KEY REQUIRED');
    expect((await cache.readManifest()).regions).toEqual([region]);
    expect((await cache.listCachedStats()).tileCount).toBe(2);
    expect(await createTileCache(root).getCachedTile(coords)).toEqual(freshTile);
  });

  it('evicts oldest tiles when over the byte budget', async () => {
    const cache = makeCache(30);
    await cache.putCachedTile({ basemapId: 'osm', z: 2, x: 0, y: 0 }, Buffer.alloc(20));
    await new Promise((r) => setTimeout(r, 20));
    await cache.putCachedTile({ basemapId: 'osm', z: 2, x: 0, y: 1 }, Buffer.alloc(20));
    const first = await cache.getCachedTile({ basemapId: 'osm', z: 2, x: 0, y: 0 });
    const second = await cache.getCachedTile({ basemapId: 'osm', z: 2, x: 0, y: 1 });
    // At least one may remain; total should be within budget after eviction (low-water ~90%).
    expect(Boolean(first) || Boolean(second)).toBe(true);
    const stats = await cache.listCachedStats();
    expect(stats.diskBytes).toBeLessThanOrEqual(30);
    expect(stats.diskBytes).toBeLessThanOrEqual(Math.floor(30 * 0.9));
  });

  it('clears all and per-source', async () => {
    const cache = makeCache();
    await cache.putCachedTile({ basemapId: 'osm', z: 1, x: 0, y: 0 }, Buffer.alloc(4));
    await cache.putCachedTile({ basemapId: 'dark', z: 1, x: 0, y: 0 }, Buffer.alloc(4));
    await cache.clearSource('osm');
    expect(await cache.getCachedTile({ basemapId: 'osm', z: 1, x: 0, y: 0 })).toBeNull();
    expect(await cache.getCachedTile({ basemapId: 'dark', z: 1, x: 0, y: 0 })).not.toBeNull();
    await cache.clearCache();
    expect(await cache.getCachedTile({ basemapId: 'dark', z: 1, x: 0, y: 0 })).toBeNull();
  });
});
