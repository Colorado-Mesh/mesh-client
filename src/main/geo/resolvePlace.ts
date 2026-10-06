import fs from 'node:fs';

import type { GeoResolvedPlace, GeoResolvePlaceRequest } from '../../shared/geoPlace';
import { sanitizeLogMessage } from '../log-service';
import {
  type GazetteerIndex,
  gazetteerLabel,
  normalizePlaceToken,
  parseGazetteerTsv,
  searchGazetteer,
} from './gazetteer';
import { geocodeOpenMeteo } from './openMeteoGeocode';
import type { PlaceCache } from './placeCache';

/**
 * Cache key for an online place hit. `near` is a ~1° cell so a nearby radio and a distant one
 * do not share a result.
 */
export function placeCacheKey(
  name: string,
  qualifiers: readonly string[],
  near?: { lat: number; lon: number },
): string {
  const base = [name, ...qualifiers].map(normalizePlaceToken).join('|');
  if (!near) return base;
  return `${base}|${Math.round(near.lat)}|${Math.round(near.lon)}`;
}

export interface PlaceResolverDeps {
  gazetteerPath: string;
  cache: PlaceCache;
  geocodeOnline?: typeof geocodeOpenMeteo;
}

/**
 * Resolves forecast place names: the bundled GeoNames table (loaded lazily on first use), then
 * the online-lookup cache, then Open-Meteo when `allowOnline`. A missing / unreadable gazetteer
 * is logged once and treated as empty so online lookup still works.
 */
export class PlaceResolver {
  private index: GazetteerIndex | null = null;

  constructor(private readonly deps: PlaceResolverDeps) {}

  private gazetteer(): GazetteerIndex {
    if (this.index) return this.index;
    try {
      this.index = parseGazetteerTsv(fs.readFileSync(this.deps.gazetteerPath, 'utf8'));
    } catch (err) {
      console.warn(
        '[geo] gazetteer unavailable; offline place lookup disabled:',
        sanitizeLogMessage(err instanceof Error ? err.message : String(err)),
      );
      this.index = { byName: new Map(), size: 0 };
    }
    return this.index;
  }

  async resolve(request: GeoResolvePlaceRequest): Promise<GeoResolvedPlace | null> {
    const qualifiers = request.qualifiers ?? [];
    const near =
      request.nearLat != null && request.nearLon != null
        ? { lat: request.nearLat, lon: request.nearLon }
        : undefined;
    const offline = searchGazetteer(this.gazetteer(), request.name, qualifiers, near);
    if (offline) {
      return {
        lat: offline.lat,
        lon: offline.lon,
        population: offline.population,
        label: gazetteerLabel(offline),
        source: 'gazetteer',
      };
    }

    const key = placeCacheKey(request.name, qualifiers, near);
    const cached = this.deps.cache.get(key);
    if (cached) return cached;

    if (!request.allowOnline) return null;
    const online = await (this.deps.geocodeOnline ?? geocodeOpenMeteo)(
      request.name,
      qualifiers,
      near,
    );
    if (!online) return null;
    this.deps.cache.set(key, online);
    return { ...online, source: 'online' };
  }
}
