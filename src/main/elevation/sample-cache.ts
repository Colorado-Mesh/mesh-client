import fs from 'fs/promises';
import path from 'path';

/** Round lat/lon to ~100 m for cache keys (~0.001°). */
export function elevationCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

interface SampleCacheFile {
  version: 1;
  entries: Record<string, { elevationM: number; updatedAt: number }>;
}

const MAX_ENTRIES = 50_000;

/** Network Open-Meteo sample cache only — do not store HGT DEM samples here. */
export class ElevationSampleCache {
  private entries = new Map<string, { elevationM: number; updatedAt: number }>();
  private dirty = false;
  private loaded = false;

  constructor(private readonly cacheDir: string) {}

  private filePath(): string {
    return path.join(this.cacheDir, 'samples.json');
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.filePath(), 'utf8');
      const parsed = JSON.parse(raw) as SampleCacheFile;
      if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || !parsed.entries) return;
      for (const [key, value] of Object.entries(parsed.entries)) {
        if (
          typeof value?.elevationM === 'number' &&
          Number.isFinite(value.elevationM) &&
          typeof value.updatedAt === 'number'
        ) {
          this.entries.set(key, { elevationM: value.elevationM, updatedAt: value.updatedAt });
        }
      }
    } catch {
      // catch-no-log-ok missing or corrupt cache
    }
  }

  get(lat: number, lon: number): number | null {
    const hit = this.entries.get(elevationCacheKey(lat, lon));
    return hit?.elevationM ?? null;
  }

  set(lat: number, lon: number, elevationM: number): void {
    if (!Number.isFinite(elevationM)) return;
    this.entries.set(elevationCacheKey(lat, lon), { elevationM, updatedAt: Date.now() });
    this.dirty = true;
    if (this.entries.size > MAX_ENTRIES) {
      // Drop oldest ~10%.
      const sorted = [...this.entries.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      const drop = Math.ceil(this.entries.size * 0.1);
      for (let i = 0; i < drop; i++) {
        const key = sorted[i]?.[0];
        if (key) this.entries.delete(key);
      }
    }
  }

  size(): number {
    return this.entries.size;
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;
    // Clear before await so concurrent set() can mark dirty again without being wiped on success.
    this.dirty = false;
    await fs.mkdir(this.cacheDir, { recursive: true });
    const entries: SampleCacheFile['entries'] = {};
    for (const [key, value] of this.entries) {
      entries[key] = value;
    }
    const payload: SampleCacheFile = { version: 1, entries };
    // Unique stage name — CodeQL js/insecure-temporary-file rejects predictable `*.tmp`.
    const tmp = path.join(this.cacheDir, `samples.${process.pid}.${Date.now()}.tmp`);
    try {
      await fs.writeFile(tmp, JSON.stringify(payload), 'utf8');
      await fs.rename(tmp, this.filePath());
    } catch (err) {
      this.dirty = true;
      await fs.unlink(tmp).catch(() => {
        // catch-no-log-ok cleanup
      });
      throw err;
    }
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.dirty = false;
    try {
      await fs.unlink(this.filePath());
    } catch {
      // catch-no-log-ok
    }
  }
}
