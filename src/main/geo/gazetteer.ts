import { haversineKm } from './geoDistance';

/** One row of the bundled GeoNames cities table (`resources/geo/cities15000.tsv`). */
export interface GazetteerPlace {
  name: string;
  country: string;
  admin1Code: string;
  admin1Name: string;
  lat: number;
  lon: number;
  population: number;
}

export interface GazetteerIndex {
  byName: Map<string, GazetteerPlace[]>;
  size: number;
}

/** Lowercase, strip diacritics, collapse whitespace. */
export function normalizePlaceToken(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function addToIndex(byName: Map<string, GazetteerPlace[]>, key: string, place: GazetteerPlace) {
  if (!key) return;
  const list = byName.get(key);
  if (!list) byName.set(key, [place]);
  else if (!list.includes(place)) list.push(place);
}

/** Parse the TSV produced by `scripts/build-geo-gazetteer.mjs`. Malformed rows are skipped. */
export function parseGazetteerTsv(tsv: string): GazetteerIndex {
  const byName = new Map<string, GazetteerPlace[]>();
  let size = 0;
  const lines = tsv.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split('\t');
    if (f.length < 8) continue;
    const lat = Number(f[5]);
    const lon = Number(f[6]);
    if (!f[0] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const place: GazetteerPlace = {
      name: f[0],
      country: f[2],
      admin1Code: f[3],
      admin1Name: f[4],
      lat,
      lon,
      population: Number(f[7]) || 0,
    };
    addToIndex(byName, normalizePlaceToken(f[0]), place);
    if (f[1]) addToIndex(byName, normalizePlaceToken(f[1]), place);
    size++;
  }
  return { byName, size };
}

let regionNames: Intl.DisplayNames | null | undefined;

function countryName(code: string): string {
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      // catch-no-log-ok Intl.DisplayNames unavailable; country names just won't match
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? '';
  } catch {
    // catch-no-log-ok unknown region code
    return '';
  }
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US',
  'united states of america': 'US',
  uk: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
};

/** True when a qualifier names this place's country or first-level admin area. */
export function qualifierMatches(place: GazetteerPlace, qualifier: string): boolean {
  const q = normalizePlaceToken(qualifier);
  if (!q) return false;
  if (q === place.country.toLowerCase()) return true;
  if (COUNTRY_ALIASES[q] === place.country) return true;
  if (q === place.admin1Code?.toLowerCase()) return true;
  if (place.admin1Name && q === normalizePlaceToken(place.admin1Name)) return true;
  return q === normalizePlaceToken(countryName(place.country));
}

export interface PlaceCandidate {
  lat: number;
  lon: number;
  population?: number;
}

/** Nearest to `near` when given, else the most populous. */
export function pickBestCandidate<T extends PlaceCandidate>(
  candidates: T[],
  near?: { lat: number; lon: number },
): T | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  if (near) {
    let bestKm = haversineKm(near.lat, near.lon, best.lat, best.lon);
    for (const c of candidates.slice(1)) {
      const km = haversineKm(near.lat, near.lon, c.lat, c.lon);
      if (km < bestKm) {
        best = c;
        bestKm = km;
      }
    }
    return best;
  }
  for (const c of candidates.slice(1)) {
    if ((c.population ?? 0) > (best.population ?? 0)) best = c;
  }
  return best;
}

/**
 * Look up `name` in the index. When qualifiers are given, only places matching at least one of
 * them are considered (so "Aurora, CO" never resolves to Aurora, Illinois).
 */
export function searchGazetteer(
  index: GazetteerIndex,
  name: string,
  qualifiers: readonly string[],
  near?: { lat: number; lon: number },
): GazetteerPlace | null {
  const matches = index.byName.get(normalizePlaceToken(name)) ?? [];
  const filtered =
    qualifiers.length > 0
      ? matches.filter((p) => qualifiers.some((q) => qualifierMatches(p, q)))
      : matches;
  return pickBestCandidate(filtered, near);
}

export function gazetteerLabel(place: GazetteerPlace): string {
  return [place.name, place.admin1Name, place.country].filter(Boolean).join(', ');
}
