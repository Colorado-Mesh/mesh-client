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

const MANIFEST_PERSIST_DEBOUNCE_MS = 500;

export class TileCache {
  private totalBytes = 0;
  private sourceStats = new Map<string, { tileCount: number; diskBytes: number }>();
  private statsInitialized = false;
  private manifestChain: Promise<void> = Promise.resolve();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Serialized read-modify-write for manifest.json (regions + sources). */
  mutateManifest(mutator: (manifest: TileCacheManifest) => void | Promise<void>): Promise<void> {
    const run = this.manifestChain.then(async () => {
      const manifest = await this.readManifestFromDisk();
      await mutator(manifest);
      await this.writeManifestAtomic(manifest);
    });
    this.manifestChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async readManifest(): Promise<TileCacheManifest> {
    return this.readManifestFromDisk();
  }

  private async readManifestFromDisk(): Promise<TileCacheManifest> {
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

  /** @deprecated Prefer mutateManifest for concurrent-safe updates. */
  async writeManifest(manifest: TileCacheManifest): Promise<void> {
    await this.mutateManifest((m) => {
      m.sources = manifest.sources;
      m.regions = manifest.regions;
      m.version = 1;
    });
  }

  private async writeManifestAtomic(manifest: TileCacheManifest): Promise<void> {
    await this.ensureRoot();
    manifest.lastUpdated = Date.now();
    const dest = this.manifestPath();
    const tmp = path.join(this.rootDir, `manifest.${process.pid}.${Date.now()}.tmp`);
    try {
      await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
      await fs.rename(tmp, dest);
    } catch (e: unknown) {
      await fs.unlink(tmp).catch(() => {
        // catch-no-log-ok cleanup
      });
      throw e;
    }
  }

  private async ensureStats(): Promise<void> {
    if (this.statsInitialized) return;
    await this.ensureRoot();
    const manifest = await this.readManifestFromDisk();
    let tileCount = 0;
    let diskBytes = 0;
    this.sourceStats.clear();
    for (const [id, src] of Object.entries(manifest.sources)) {
      this.sourceStats.set(id, { tileCount: src.tileCount, diskBytes: src.diskBytes });
      tileCount += src.tileCount;
      diskBytes += src.diskBytes;
    }
    if (tileCount === 0 && diskBytes === 0) {
      // Manifest empty — one-time scan in case files exist without stats.
      const scanned = await this.scanAllTiles();
      for (const [id, src] of scanned) {
        this.sourceStats.set(id, src);
        tileCount += src.tileCount;
        diskBytes += src.diskBytes;
      }
      if (tileCount > 0) {
        await this.persistSourceStatsNow();
      }
    }
    this.totalBytes = diskBytes;
    this.statsInitialized = true;
  }

  private applySourceDelta(basemapId: string, tileDelta: number, bytesDelta: number): void {
    const cur = this.sourceStats.get(basemapId) ?? { tileCount: 0, diskBytes: 0 };
    const next = {
      tileCount: Math.max(0, cur.tileCount + tileDelta),
      diskBytes: Math.max(0, cur.diskBytes + bytesDelta),
    };
    if (next.tileCount === 0 && next.diskBytes === 0) {
      this.sourceStats.delete(basemapId);
    } else {
      this.sourceStats.set(basemapId, next);
    }
    this.totalBytes = Math.max(0, this.totalBytes + bytesDelta);
  }

  private schedulePersistSourceStats(): void {
    if (this.persistTimer != null) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistSourceStatsNow().catch(() => {
        // catch-no-log-ok best-effort debounce flush
      });
    }, MANIFEST_PERSIST_DEBOUNCE_MS);
  }

  private async persistSourceStatsNow(): Promise<void> {
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const snapshot = new Map(this.sourceStats);
    await this.mutateManifest((m) => {
      const sources: TileCacheManifest['sources'] = {};
      for (const [id, src] of snapshot) {
        sources[id] = { tileCount: src.tileCount, diskBytes: src.diskBytes };
      }
      m.sources = sources;
    });
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
    await this.ensureStats();
    const dest = this.tilePath(c);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    let replacedBytes = 0;
    try {
      const st = await fs.stat(dest);
      replacedBytes = st.size;
    } catch {
      // catch-no-log-ok new file
    }
    await fs.writeFile(dest, data);
    if (replacedBytes > 0) {
      this.applySourceDelta(c.basemapId, 0, data.byteLength - replacedBytes);
    } else {
      this.applySourceDelta(c.basemapId, 1, data.byteLength);
    }
    this.schedulePersistSourceStats();
    await this.evictIfNeeded();
  }

  async clearCache(): Promise<void> {
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await fs.rm(this.rootDir, { recursive: true, force: true });
    await this.ensureRoot();
    this.sourceStats.clear();
    this.totalBytes = 0;
    this.statsInitialized = true;
    await this.mutateManifest((m) => {
      m.sources = {};
      m.regions = [];
    });
  }

  async clearSource(basemapId: OfflineMapBasemapId): Promise<void> {
    await this.ensureStats();
    await fs.rm(path.join(this.rootDir, basemapId), { recursive: true, force: true });
    const removed = this.sourceStats.get(basemapId);
    if (removed) {
      this.totalBytes = Math.max(0, this.totalBytes - removed.diskBytes);
      this.sourceStats.delete(basemapId);
    }
    await this.mutateManifest((m) => {
      const nextSources: TileCacheManifest['sources'] = {};
      for (const [key, value] of Object.entries(m.sources)) {
        if (key !== basemapId) nextSources[key] = value;
      }
      m.sources = nextSources;
      m.regions = m.regions.filter((r) => r.basemapId !== basemapId);
    });
  }

  async listCachedStats(): Promise<TileCacheStats> {
    await this.ensureStats();
    let tileCount = 0;
    for (const src of this.sourceStats.values()) {
      tileCount += src.tileCount;
    }
    return { tileCount, diskBytes: this.totalBytes };
  }

  private async scanAllTiles(): Promise<Map<string, { tileCount: number; diskBytes: number }>> {
    const bySource = new Map<string, { tileCount: number; diskBytes: number }>();
    const walk = async (dir: string, basemapId: string | null): Promise<void> => {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        // catch-no-log-ok
        return;
      }
      for (const name of names) {
        if (name === 'manifest.json' || name.endsWith('.tmp')) continue;
        const full = path.join(dir, name);
        let st;
        try {
          st = await fs.stat(full);
        } catch {
          // catch-no-log-ok race
          continue;
        }
        if (st.isDirectory()) {
          const nextId = basemapId ?? (isOfflineMapBasemapId(name) ? name : null);
          await walk(full, nextId);
        } else if (st.isFile() && name.endsWith('.png') && basemapId) {
          const cur = bySource.get(basemapId) ?? { tileCount: 0, diskBytes: 0 };
          cur.tileCount += 1;
          cur.diskBytes += st.size;
          bySource.set(basemapId, cur);
        }
      }
    };
    await walk(this.rootDir, null);
    return bySource;
  }

  private async evictIfNeeded(): Promise<void> {
    await this.ensureStats();
    if (this.totalBytes <= this.maxBytes) return;

    interface Entry {
      file: string;
      basemapId: OfflineMapBasemapId;
      mtimeMs: number;
      size: number;
    }
    const entries: Entry[] = [];

    const walk = async (dir: string, basemapId: OfflineMapBasemapId | null): Promise<void> => {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch {
        // catch-no-log-ok
        return;
      }
      for (const name of names) {
        if (name === 'manifest.json' || name.endsWith('.tmp')) continue;
        const full = path.join(dir, name);
        let st;
        try {
          st = await fs.stat(full);
        } catch {
          // catch-no-log-ok race
          continue;
        }
        if (st.isDirectory()) {
          const nextId = basemapId ?? (isOfflineMapBasemapId(name) ? name : null);
          if (nextId) await walk(full, nextId);
        } else if (st.isFile() && name.endsWith('.png') && basemapId) {
          entries.push({ file: full, basemapId, mtimeMs: st.mtimeMs, size: st.size });
        }
      }
    };

    await walk(this.rootDir, null);
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const e of entries) {
      if (this.totalBytes <= this.maxBytes) break;
      try {
        await fs.unlink(e.file);
        this.applySourceDelta(e.basemapId, -1, -e.size);
      } catch {
        // catch-no-log-ok race
      }
    }
    this.schedulePersistSourceStats();
  }
}

export function createTileCache(userDataPath: string, maxBytes?: number): TileCache {
  return new TileCache(path.join(userDataPath, 'tile-cache'), maxBytes);
}
