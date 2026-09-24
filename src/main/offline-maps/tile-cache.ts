import fs from 'fs/promises';
import path from 'path';

import {
  isOfflineMapBasemapId,
  type OfflineMapBasemapId,
} from '@/shared/offlineMaps/basemapRegistry';
import { TILE_CACHE_MAX_BYTES } from '@/shared/offlineMaps/tileMath';

export interface TileCacheCoords {
  basemapId: OfflineMapBasemapId;
  z: number;
  x: number;
  y: number;
  retina?: boolean;
}

export interface TileCacheStats {
  tileCount: number;
  diskBytes: number;
}

export interface TileCacheManifest {
  version: 1;
  lastUpdated: number;
  sources: Record<
    string,
    {
      tileCount: number;
      diskBytes: number;
    }
  >;
  regions: {
    id: string;
    basemapId: OfflineMapBasemapId;
    bounds: { north: number; south: number; east: number; west: number };
    minZoom: number;
    maxZoom: number;
    completedAt: number;
    tileCount: number;
  }[];
}

function emptyManifest(): TileCacheManifest {
  return { version: 1, lastUpdated: 0, sources: {}, regions: [] };
}

export function tileFileName(y: number, retina: boolean): string {
  return retina ? `${y}@2x.png` : `${y}.png`;
}

/** Reject traversal / overflow before any path join. */
export function parseTileCoords(
  basemapId: string,
  zRaw: string,
  xRaw: string,
  yRaw: string,
): TileCacheCoords | null {
  if (!isOfflineMapBasemapId(basemapId)) return null;
  if (!/^\d+$/.test(zRaw) || !/^\d+$/.test(xRaw)) return null;
  const retina = yRaw.endsWith('@2x');
  const yDigits = retina ? yRaw.slice(0, -3) : yRaw;
  if (!/^\d+$/.test(yDigits)) return null;
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yDigits);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (z < 0 || z > 22 || x < 0 || y < 0) return null;
  const n = 2 ** z;
  if (x >= n || y >= n) return null;
  return { basemapId, z, x, y, retina };
}

export class TileCache {
  constructor(
    private readonly rootDir: string,
    private readonly maxBytes: number = TILE_CACHE_MAX_BYTES,
  ) {}

  private manifestPath(): string {
    return path.join(this.rootDir, 'manifest.json');
  }

  private tilePath(c: TileCacheCoords): string {
    return path.join(
      this.rootDir,
      c.basemapId,
      String(c.z),
      String(c.x),
      tileFileName(c.y, c.retina === true),
    );
  }

  async ensureRoot(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  async readManifest(): Promise<TileCacheManifest> {
    try {
      const raw = await fs.readFile(this.manifestPath(), 'utf8');
      const parsed = JSON.parse(raw) as TileCacheManifest;
      if (parsed?.version !== 1 || typeof parsed.sources !== 'object') {
        return emptyManifest();
      }
      if (!Array.isArray(parsed.regions)) parsed.regions = [];
      return parsed;
    } catch {
      // catch-no-log-ok missing/corrupt manifest → empty
      return emptyManifest();
    }
  }

  async writeManifest(manifest: TileCacheManifest): Promise<void> {
    await this.ensureRoot();
    manifest.lastUpdated = Date.now();
    await fs.writeFile(this.manifestPath(), JSON.stringify(manifest, null, 2), 'utf8');
  }

  async getCachedTile(c: TileCacheCoords): Promise<Buffer | null> {
    try {
      const buf = await fs.readFile(this.tilePath(c));
      // Touch mtime for LRU
      const now = new Date();
      await fs.utimes(this.tilePath(c), now, now).catch(() => {
        // catch-no-log-ok utimes best-effort
      });
      return buf;
    } catch {
      // catch-no-log-ok cache miss
      return null;
    }
  }

  async putCachedTile(c: TileCacheCoords, data: Buffer): Promise<void> {
    const dest = this.tilePath(c);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, data);
    await this.evictIfNeeded();
    await this.refreshSourceStats(c.basemapId);
  }

  async clearCache(): Promise<void> {
    await fs.rm(this.rootDir, { recursive: true, force: true });
    await this.ensureRoot();
    await this.writeManifest(emptyManifest());
  }

  async clearSource(basemapId: OfflineMapBasemapId): Promise<void> {
    await fs.rm(path.join(this.rootDir, basemapId), { recursive: true, force: true });
    const manifest = await this.readManifest();
    const nextSources: TileCacheManifest['sources'] = {};
    for (const [key, value] of Object.entries(manifest.sources)) {
      if (key !== basemapId) nextSources[key] = value;
    }
    manifest.sources = nextSources;
    manifest.regions = manifest.regions.filter((r) => r.basemapId !== basemapId);
    await this.writeManifest(manifest);
  }

  async listCachedStats(): Promise<TileCacheStats> {
    const manifest = await this.readManifest();
    let tileCount = 0;
    let diskBytes = 0;
    for (const src of Object.values(manifest.sources)) {
      tileCount += src.tileCount;
      diskBytes += src.diskBytes;
    }
    return { tileCount, diskBytes };
  }

  private async refreshSourceStats(basemapId: OfflineMapBasemapId): Promise<void> {
    const sourceRoot = path.join(this.rootDir, basemapId);
    let tileCount = 0;
    let diskBytes = 0;
    try {
      const walk = async (dir: string): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            await walk(full);
          } else if (ent.isFile() && ent.name.endsWith('.png')) {
            tileCount += 1;
            const st = await fs.stat(full);
            diskBytes += st.size;
          }
        }
      };
      await walk(sourceRoot);
    } catch {
      // catch-no-log-ok source dir missing
    }
    const manifest = await this.readManifest();
    manifest.sources[basemapId] = { tileCount, diskBytes };
    await this.writeManifest(manifest);
  }

  private async evictIfNeeded(): Promise<void> {
    interface Entry {
      file: string;
      mtimeMs: number;
      size: number;
    }
    const entries: Entry[] = [];
    let total = 0;

    const walk = async (dir: string): Promise<void> => {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        // catch-no-log-ok
        return;
      }
      for (const name of names) {
        if (name === 'manifest.json') continue;
        const full = path.join(dir, name);
        let st;
        try {
          st = await fs.stat(full);
        } catch {
          // catch-no-log-ok race
          continue;
        }
        if (st.isDirectory()) {
          await walk(full);
        } else if (st.isFile() && name.endsWith('.png')) {
          entries.push({ file: full, mtimeMs: st.mtimeMs, size: st.size });
          total += st.size;
        }
      }
    };

    await walk(this.rootDir);
    if (total <= this.maxBytes) return;

    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const e of entries) {
      if (total <= this.maxBytes) break;
      try {
        await fs.unlink(e.file);
        total -= e.size;
      } catch {
        // catch-no-log-ok race
      }
    }

    for (const id of OFFLINE_MAP_BASEMAP_IDS_LOCAL) {
      await this.refreshSourceStats(id);
    }
  }
}

const OFFLINE_MAP_BASEMAP_IDS_LOCAL: OfflineMapBasemapId[] = ['osm', 'dark'];

export function createTileCache(userDataPath: string, maxBytes?: number): TileCache {
  return new TileCache(path.join(userDataPath, 'tile-cache'), maxBytes);
}
