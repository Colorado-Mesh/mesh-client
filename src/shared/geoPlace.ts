/** IPC contract for `geo:resolvePlace` (weather forecast place lookup). */

export const GEO_PLACE_NAME_MAX_LENGTH = 80;
export const GEO_PLACE_QUALIFIER_MAX_LENGTH = 64;
export const GEO_PLACE_MAX_QUALIFIERS = 4;

export interface GeoResolvePlaceRequest {
  name: string;
  /** Region / state / country parts after the name, e.g. `['CO']` or `['BC', 'Canada']`. */
  qualifiers?: string[];
  /** Disambiguation hint: the candidate nearest this point wins. */
  nearLat?: number;
  nearLon?: number;
  /** Allow the Open-Meteo geocoding fallback when the offline table has no match. */
  allowOnline: boolean;
}

export type GeoResolvedPlaceSource = 'cache' | 'gazetteer' | 'online';

export interface GeoResolvedPlace {
  lat: number;
  lon: number;
  population?: number;
  /** Display label, e.g. `Aurora, Colorado, US`. */
  label: string;
  source: GeoResolvedPlaceSource;
}

function isFiniteInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

/** Validate an untrusted `geo:resolvePlace` payload. Returns null when malformed. */
export function parseGeoResolvePlaceRequest(raw: unknown): GeoResolvePlaceRequest | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string') return null;
  const name = r.name.trim();
  if (!name || name.length > GEO_PLACE_NAME_MAX_LENGTH) return null;
  let qualifiers: string[] = [];
  if (r.qualifiers !== undefined) {
    if (!Array.isArray(r.qualifiers) || r.qualifiers.length > GEO_PLACE_MAX_QUALIFIERS) return null;
    for (const q of r.qualifiers) {
      if (typeof q !== 'string' || q.length > GEO_PLACE_QUALIFIER_MAX_LENGTH) return null;
    }
    qualifiers = (r.qualifiers as string[]).map((q) => q.trim()).filter(Boolean);
  }
  const hasNear = isFiniteInRange(r.nearLat, -90, 90) && isFiniteInRange(r.nearLon, -180, 180);
  return {
    name,
    qualifiers,
    ...(hasNear ? { nearLat: r.nearLat as number, nearLon: r.nearLon as number } : {}),
    allowOnline: r.allowOnline === true,
  };
}
