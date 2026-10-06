import fs from 'node:fs';
import path from 'node:path';

import type { GeoResolvedPlace } from '../../shared/geoPlace';
import { sanitizeLogMessage } from '../log-service';

export const PLACE_CACHE_FILENAME = 'geo-place-cache.json';
export const PLACE_CACHE_MAX_ENTRIES = 2000;

interface CachedPlace {
  lat: number;
  lon: number;
  population?: number;
  label: string;
  savedAt: number;
}

function isCachedPlace(v: unknown): v is CachedPlace {
  if (v == null || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.lat === 'number' &&
    Number.isFinite(c.lat) &&
    typeof c.lon === 'number' &&
    Number.isFinite(c.lon) &&
    typeof c.label === 'string' &&
    typeof c.savedAt === 'number' &&
    (c.population === undefined || typeof c.population === 'number')
  );
}

/**
 * Small persistent map of resolved online place lookups, stored as JSON in `userData`.
 * A missing or corrupt file is treated as empty (logged); writes go to a sibling temp file and are
 * renamed into place so a crash mid-write never leaves a truncated cache.
 */
export class PlaceCache {
  private entries: Map<string, CachedPlace> | null = null;

  constructor(private readonly filePath: string) {}

  static inDirectory(dir: string): PlaceCache {
    return new PlaceCache(path.join(dir, PLACE_CACHE_FILENAME));
  }

  private load(): Map<string, CachedPlace> {
    if (this.entries) return this.entries;
    const entries = new Map<string, CachedPlace>();
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (isCachedPlace(v)) entries.set(k, v);
          }
        }
      }
    } catch (err) {
      console.warn(
        '[geo] place cache unreadable, starting empty:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
    }
    this.entries = entries;
    return entries;
  }

  get(key: string): GeoResolvedPlace | null {
    const hit = this.load().get(key);
    if (!hit) return null;
    return {
      lat: hit.lat,
      lon: hit.lon,
      ...(hit.population != null ? { population: hit.population } : {}),
      label: hit.label,
      source: 'cache',
    };
  }

  set(key: string, place: Omit<GeoResolvedPlace, 'source'>, now = Date.now()): void {
    const entries = this.load();
    entries.delete(key);
    entries.set(key, {
      lat: place.lat,
      lon: place.lon,
      ...(place.population != null ? { population: place.population } : {}),
      label: place.label,
      savedAt: now,
    });
    while (entries.size > PLACE_CACHE_MAX_ENTRIES) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }
    this.persist(entries);
  }

  private persist(entries: Map<string, CachedPlace>): void {
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries)));
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.warn(
        '[geo] place cache write failed (lookup result kept in memory):',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        // catch-no-log-ok best-effort temp cleanup after a logged write failure
      }
    }
  }
}
