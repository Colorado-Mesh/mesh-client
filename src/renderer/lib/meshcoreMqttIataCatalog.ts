import { haversineDistanceKm } from './nodeStatus';

/** Compact airport row: [IATA, name, city, lat, lon]. */
export type MeshcoreIataAirportRow = readonly [string, string, string, number, number];

export interface MeshcoreIataAirport {
  code: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
}

/** Special LetsMesh analyzer segment — not a geo airport. */
export const MESHCORE_IATA_TEST_CODE = 'test';

export interface MeshcoreIataCatalogFile {
  source: string;
  generatedAt: string;
  airports: MeshcoreIataAirportRow[];
}

let cachedAirports: MeshcoreIataAirport[] | null = null;
let loadPromise: Promise<MeshcoreIataAirport[]> | null = null;

function rowToAirport(row: MeshcoreIataAirportRow): MeshcoreIataAirport {
  return {
    code: row[0],
    name: row[1],
    city: row[2],
    lat: row[3],
    lon: row[4],
  };
}

/** Parse vendored catalog JSON into airport objects (idempotent). */
export function parseMeshcoreIataCatalog(data: MeshcoreIataCatalogFile): MeshcoreIataAirport[] {
  return data.airports.map(rowToAirport);
}

/** Lazy-load the vendored airport catalog (shared promise). */
export async function loadMeshcoreIataAirports(): Promise<MeshcoreIataAirport[]> {
  if (cachedAirports) return cachedAirports;
  loadPromise ??= import('./meshcoreMqttIataAirports.json')
    .then((mod) => {
      // JSON resolve types rows as (string|number)[][]; cast via unknown to our 5-tuple rows.
      const data = (mod as unknown as { default: MeshcoreIataCatalogFile }).default;
      cachedAirports = parseMeshcoreIataCatalog(data);
      return cachedAirports;
    })
    .catch((err: unknown) => {
      loadPromise = null;
      throw err;
    });
  return loadPromise;
}

/** Test helper: replace or clear the in-memory catalog cache. */
export function setMeshcoreIataAirportsForTests(airports: MeshcoreIataAirport[] | null): void {
  cachedAirports = airports;
  loadPromise = airports ? Promise.resolve(airports) : null;
}

/**
 * Nearest airport to (lat, lon) by great-circle distance.
 * Returns null when the catalog is empty or coords are non-finite.
 */
export function findNearestMeshcoreIata(
  airports: readonly MeshcoreIataAirport[],
  lat: number,
  lon: number,
): MeshcoreIataAirport | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || airports.length === 0) return null;
  let best: MeshcoreIataAirport | null = null;
  let bestKm = Infinity;
  for (const airport of airports) {
    const km = haversineDistanceKm(lat, lon, airport.lat, airport.lon);
    if (!Number.isFinite(km)) continue;
    if (km < bestKm) {
      bestKm = km;
      best = airport;
    }
  }
  return best;
}

/** Filter airports by code / name / city substring (case-insensitive). */
export function filterMeshcoreIataAirports(
  airports: readonly MeshcoreIataAirport[],
  query: string,
): MeshcoreIataAirport[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...airports];
  return airports.filter((a) => {
    return (
      a.code.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.city.toLowerCase().includes(q)
    );
  });
}

/** Display label: `DEN — Denver International Airport` (city when name is sparse). */
export function formatMeshcoreIataAirportLabel(airport: MeshcoreIataAirport): string {
  const detail = airport.city && airport.city !== airport.name ? airport.name : airport.name;
  return `${airport.code} — ${detail}`;
}

/** Build `meshcore/{CODE}` or `meshcore/test` from a picklist segment. */
export function meshcoreTopicPrefixFromIataSegment(segment: string): string {
  const s = segment.trim();
  if (s.toLowerCase() === MESHCORE_IATA_TEST_CODE) return 'meshcore/test';
  return `meshcore/${s.toUpperCase()}`;
}
