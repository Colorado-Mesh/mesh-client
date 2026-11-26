import fs from 'fs/promises';
import path from 'path';

import {
  DARK_BASEMAP_CACHE_REVISION,
  isMapSourceId,
  type MapSourceId,
  type OfflineMapBasemapId,
} from '@/shared/offlineMaps/basemapRegistry';
import {
  CUSTOM_SOURCE_CACHE_MAX_BYTES,
  isCustomMapSourceId,
} from '@/shared/offlineMaps/customMapSources';
import { TILE_CACHE_MAX_BYTES } from '@/shared/offlineMaps/tileMath';
import { joinUnderRoot } from '@/shared/pathUnderRoot';

import { sanitizeLogMessage } from '../sanitize-log-message';

export interface TileCacheCoords {
  basemapId: MapSourceId;
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
  if (!isMapSourceId(basemapId)) return null;
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
  private statsInit: Promise<void> | null = null;
  private evictionInFlight: Promise<void> | null = null;
  private readonly sourceEvictionInFlight = new Map<string, Promise<void>>();
  private manifestChain: Promise<void> = Promise.resolve();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly rootDir: string,
    private readonly maxBytes: number = TILE_CACHE_MAX_BYTES,
    private readonly customSourceMaxBytes: number = CUSTOM_SOURCE_CACHE_MAX_BYTES,
  ) {}

  private manifestPath(): string {
    return joinUnderRoot(this.rootDir, 'manifest.json');
  }

  private tilePath(c: TileCacheCoords): string {
    const segments: string[] = [c.basemapId];
    if (c.basemapId === 'dark') segments.push(DARK_BASEMAP_CACHE_REVISION);
    segments.push(String(c.z), String(c.x), tileFileName(c.y, c.retina === true));
    return joinUnderRoot(this.rootDir, ...segments);
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
    } catch (e: unknown) {
      console.debug(
        '[main/offline-maps/tile-cache] catch:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );

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
    const tmp = joinUnderRoot(this.rootDir, `manifest.${process.pid}.${Date.now()}.tmp`);
    try {
      await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
      await fs.rename(tmp, dest);
    } catch (e: unknown) {
      console.debug(
        '[main/offline-maps/tile-cache] catch:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
      await fs.unlink(tmp).catch(() => {});
      throw e;
    }
  }

  private async ensureStats(): Promise<void> {
    if (this.statsInitialized) return;
    this.statsInit ??= this.initializeStats().finally(() => {
      this.statsInit = null;
    });
    await this.statsInit;
  }

  private async initializeStats(): Promise<void> {
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
      void this.persistSourceStatsNow().catch((e: unknown) => {
        console.debug(
          '[main/offline-maps/tile-cache] catch:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
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
      await fs.utimes(this.tilePath(c), now, now).catch((e: unknown) => {
        console.debug(
          '[main/offline-maps/tile-cache] catch:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      });
      return buf;
    } catch (e: unknown) {
      console.debug(
        '[main/offline-maps/tile-cache] catch:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );

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
    } catch (e: unknown) {
      console.debug(
        '[main/offline-maps/tile-cache] catch:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    }
    await fs.writeFile(dest, data);
    if (replacedBytes > 0) {
      this.applySourceDelta(c.basemapId, 0, data.byteLength - replacedBytes);
    } else {
      this.applySourceDelta(c.basemapId, 1, data.byteLength);
    }
    this.schedulePersistSourceStats();
    if (isCustomMapSourceId(c.basemapId)) {
      await this.evictCustomSourceIfNeeded(c.basemapId);
    }
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

  async clearSource(basemapId: MapSourceId): Promise<void> {
    await this.ensureStats();
    await fs.rm(joinUnderRoot(this.rootDir, basemapId), { recursive: true, force: true });
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
      } catch (e: unknown) {
        console.debug(
          '[main/offline-maps/tile-cache] catch:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );

        return;
      }
      for (const name of names) {
        if (name === 'manifest.json' || name.endsWith('.tmp')) continue;
        const full = joinUnderRoot(dir, name);
        let st;
        try {
          st = await fs.stat(full);
        } catch (e: unknown) {
          console.debug(
            '[main/offline-maps/tile-cache] catch:',
            sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
          );

          continue;
        }
        if (st.isDirectory()) {
          const nextId = basemapId ?? (isMapSourceId(name) ? name : null);
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
    this.evictionInFlight ??= this.runEvictionToBudget().finally(() => {
      this.evictionInFlight = null;
    });
    await this.evictionInFlight;
  }

  /**
   * Evict until the cache fits, then stop. A pass that removes nothing means the in-memory
   * totals no longer match the disk (tiles deleted outside the app, an unreadable directory, or
   * a persistent unlink failure). Rescan so stale bytes stop blocking new writes instead of
   * walking the cache directory forever.
   */
  private async runEvictionToBudget(): Promise<void> {
    for (;;) {
      if (this.totalBytes <= this.maxBytes) return;
      if ((await this.runEviction()) > 0) continue;
      console.warn(
        `mcL1508 [offline-maps] tile eviction removed nothing while ${this.totalBytes} B > ${this.maxBytes} B; reconciling cache stats`,
      );
      try {
        await this.reconcileStatsFromDisk();
      } catch (e: unknown) {
        console.debug(
          '[main/offline-maps/tile-cache] catch:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
      return;
    }
  }

  /** Rebuild `sourceStats` / `totalBytes` from the files actually on disk. */
  private async reconcileStatsFromDisk(): Promise<void> {
    const scanned = await this.scanAllTiles();
    let diskBytes = 0;
    for (const src of scanned.values()) diskBytes += src.diskBytes;
    this.sourceStats = new Map(scanned);
    this.totalBytes = diskBytes;
    await this.persistSourceStatsNow();
  }

  /**
   * Per-source quota for custom XYZ sources: a single provider cannot crowd out the shared cache.
   * Evicts that source's oldest tiles (by mtime) down to ~90% of the quota; single-flight per source.
   */
  private async evictCustomSourceIfNeeded(id: MapSourceId): Promise<void> {
    const used = this.sourceStats.get(id)?.diskBytes ?? 0;
    if (used <= this.customSourceMaxBytes) return;
    let run = this.sourceEvictionInFlight.get(id);
    if (!run) {
      run = this.runCustomSourceEviction(id).finally(() => {
        this.sourceEvictionInFlight.delete(id);
      });
      this.sourceEvictionInFlight.set(id, run);
    }
    await run;
  }

  private async runCustomSourceEviction(id: MapSourceId): Promise<void> {
    const lowWater = Math.floor(this.customSourceMaxBytes * 0.9);
    const entries: { file: string; mtimeMs: number; size: number }[] = [];
    const walk = async (dir: string): Promise<void> => {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch (e: unknown) {
        console.debug(
          '[main/offline-maps/tile-cache] catch:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );

        return;
      }
      for (const name of names) {
        const full = joinUnderRoot(dir, name);
        let st;
        try {
          st = await fs.stat(full);
        } catch (e: unknown) {
          console.debug(
            '[main/offline-maps/tile-cache] catch:',
            sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
          );

          continue;
        }
        if (st.isDirectory()) await walk(full);
        else if (st.isFile() && name.endsWith('.png')) {
          entries.push({ file: full, mtimeMs: st.mtimeMs, size: st.size });
        }
      }
    };
    await walk(joinUnderRoot(this.rootDir, id));
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let removed = 0;
    for (const e of entries) {
      if ((this.sourceStats.get(id)?.diskBytes ?? 0) <= lowWater) break;
      try {
        await fs.unlink(e.file);
        this.applySourceDelta(id, -1, -e.size);
        removed += 1;
      } catch (e: unknown) {
        console.debug(
          '[main/offline-maps/tile-cache] catch:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    }
    if (removed > 0) this.schedulePersistSourceStats();
  }

  /** Evict oldest tiles down to ~90% of maxBytes (hysteresis / low-water mark). */
  private async runEviction(): Promise<number> {
    const lowWater = Math.floor(this.maxBytes * 0.9);
    if (this.totalBytes <= lowWater) return 0;

    interface Entry {
      file: string;
      basemapId: MapSourceId;
      mtimeMs: number;
      size: number;
    }
    const entries: Entry[] = [];

    const walk = async (dir: string, basemapId: MapSourceId | null): Promise<void> => {
      let names: string[];
      try {
        names = await fs.readdir(dir);
      } catch (e: unknown) {
        console.debug(
          '[main/offline-maps/tile-cache] catch:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );

        return;
      }
      for (const name of names) {
        if (name === 'manifest.json' || name.endsWith('.tmp')) continue;
        const full = joinUnderRoot(dir, name);
        let st;
        try {
          st = await fs.stat(full);
        } catch (e: unknown) {
          console.debug(
            '[main/offline-maps/tile-cache] catch:',
            sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
          );

          continue;
        }
        if (st.isDirectory()) {
          const nextId = basemapId ?? (isMapSourceId(name) ? name : null);
          if (nextId) await walk(full, nextId);
        } else if (st.isFile() && name.endsWith('.png') && basemapId) {
          entries.push({ file: full, basemapId, mtimeMs: st.mtimeMs, size: st.size });
        }
      }
    };

    await walk(this.rootDir, null);
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let removed = 0;
    let removedBytes = 0;
    for (const e of entries) {
      if (this.totalBytes <= lowWater) break;
      try {
        await fs.unlink(e.file);
        this.applySourceDelta(e.basemapId, -1, -e.size);
        removed += 1;
        removedBytes += e.size;
      } catch (e: unknown) {
        console.debug(
          '[main/offline-maps/tile-cache] catch:',
          sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
        );
      }
    }
    if (removed > 0) {
      this.schedulePersistSourceStats();
    }
    return removedBytes;
  }
}

export function createTileCache(
  userDataPath: string,
  maxBytes?: number,
  customSourceMaxBytes?: number,
): TileCache {
  return new TileCache(joinUnderRoot(userDataPath, 'tile-cache'), maxBytes, customSourceMaxBytes);
}
