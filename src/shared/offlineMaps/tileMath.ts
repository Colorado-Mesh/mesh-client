import { MS_PER_SECOND } from '@/shared/timeConstants';

/** Web Mercator latitude clamp (tile math singularity at poles). */
export const WEB_MERCATOR_MAX_LAT = 85.05112878;

/** Default LRU budget for on-disk tile cache (~1 GiB). */
export const TILE_CACHE_MAX_BYTES = 1024 * 1024 * 1024;

/** Average PNG tile size used only for UI estimates. */
export const OFFLINE_MAP_AVG_TILE_BYTES = 10 * 1024;

/**
 * Soft size estimate cap for one download job.
 * Kept well under {@link TILE_CACHE_MAX_BYTES} so a completed region is not immediately
 * LRU-evicted by the same job (headroom remains for viewed tiles).
 */
export const OFFLINE_MAP_MAX_ESTIMATE_BYTES = Math.floor(TILE_CACHE_MAX_BYTES * 0.5);

/** Hard tile-count cap derived from the estimate budget. */
export const OFFLINE_MAP_MAX_TILES = Math.floor(
  OFFLINE_MAP_MAX_ESTIMATE_BYTES / OFFLINE_MAP_AVG_TILE_BYTES,
);

export const OFFLINE_MAP_DOWNLOAD_CONCURRENCY = 4;

export const OFFLINE_MAP_TILE_FETCH_TIMEOUT_MS = 15 * MS_PER_SECOND;

export const OFFLINE_MAP_MAX_ZOOM = 17;

export interface LatLonBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface WebMercatorTile {
  z: number;
  x: number;
  y: number;
}

export function clampLat(lat: number): number {
  return Math.max(-WEB_MERCATOR_MAX_LAT, Math.min(WEB_MERCATOR_MAX_LAT, lat));
}

/** Normalize longitude into [-180, 180] without a loop (safe for extreme inputs). */
export function normalizeLon(lon: number): number {
  if (!Number.isFinite(lon)) return NaN;
  const m = ((((lon + 180) % 360) + 360) % 360) - 180;
  // Modulo collapses ±180 to -180; preserve the caller's sign at the antimeridian.
  if (m === -180) return lon < 0 ? -180 : 180;
  return m;
}

/** Standard Web Mercator tiling math. */
export function latLonToTile(lat: number, lon: number, zoom: number): WebMercatorTile {
  const z = Math.max(0, Math.min(22, Math.floor(zoom)));
  const latRad = (clampLat(lat) * Math.PI) / 180;
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return {
    x: Math.max(0, Math.min(n - 1, x)),
    y: Math.max(0, Math.min(n - 1, y)),
    z,
  };
}

/** Tile count for a bbox at one zoom without allocating tile objects. */
export function tileCountForBoundsAtZoom(bounds: LatLonBounds, zoom: number): number {
  const z = Math.max(0, Math.min(22, Math.floor(zoom)));
  const north = clampLat(bounds.north);
  const south = clampLat(bounds.south);
  if (!(north >= south)) return 0;

  const west = normalizeLon(bounds.west);
  const east = normalizeLon(bounds.east);
  if (!Number.isFinite(west) || !Number.isFinite(east)) return 0;

  const nw = latLonToTile(north, west, z);
  const se = latLonToTile(south, east, z);
  const height = se.y - nw.y + 1;
  if (height <= 0) return 0;

  const n = 2 ** z;
  if (west <= east) {
    const width = se.x - nw.x + 1;
    return width > 0 ? width * height : 0;
  }
  // Antimeridian wrap: west..180 and -180..east
  const widthWest = n - nw.x;
  const widthEast = se.x + 1;
  return (widthWest + widthEast) * height;
}

/** Inclusive tile range covering a geographic bbox at one zoom. */
export function tilesForBoundsAtZoom(bounds: LatLonBounds, zoom: number): WebMercatorTile[] {
  const z = Math.max(0, Math.min(22, Math.floor(zoom)));
  const north = clampLat(bounds.north);
  const south = clampLat(bounds.south);
  if (!(north >= south)) return [];

  const west = normalizeLon(bounds.west);
  const east = normalizeLon(bounds.east);
  if (!Number.isFinite(west) || !Number.isFinite(east)) return [];

  const nw = latLonToTile(north, west, z);
  const se = latLonToTile(south, east, z);

  const tiles: WebMercatorTile[] = [];
  const n = 2 ** z;

  if (west <= east) {
    for (let x = nw.x; x <= se.x; x++) {
      for (let y = nw.y; y <= se.y; y++) {
        tiles.push({ z, x, y });
      }
    }
  } else {
    // Antimeridian wrap: west..180 and -180..east
    for (let x = nw.x; x < n; x++) {
      for (let y = nw.y; y <= se.y; y++) {
        tiles.push({ z, x, y });
      }
    }
    for (let x = 0; x <= se.x; x++) {
      for (let y = nw.y; y <= se.y; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  return tiles;
}

export function estimateTileCount(bounds: LatLonBounds, minZoom: number, maxZoom: number): number {
  const minZ = Math.max(0, Math.floor(minZoom));
  const maxZ = Math.max(minZ, Math.floor(maxZoom));
  let total = 0;
  for (let z = minZ; z <= maxZ; z++) {
    total += tileCountForBoundsAtZoom(bounds, z);
  }
  return total;
}

export function estimateRegionBytes(tileCount: number): number {
  return tileCount * OFFLINE_MAP_AVG_TILE_BYTES;
}

export function isRegionWithinCaps(tileCount: number): boolean {
  return (
    tileCount > 0 &&
    tileCount <= OFFLINE_MAP_MAX_TILES &&
    estimateRegionBytes(tileCount) <= OFFLINE_MAP_MAX_ESTIMATE_BYTES
  );
}

export function enumerateRegionTiles(
  bounds: LatLonBounds,
  minZoom: number,
  maxZoom: number,
): WebMercatorTile[] {
  const minZ = Math.max(0, Math.floor(minZoom));
  const maxZ = Math.max(minZ, Math.floor(maxZoom));
  const out: WebMercatorTile[] = [];
  for (let z = minZ; z <= maxZ; z++) {
    out.push(...tilesForBoundsAtZoom(bounds, z));
  }
  return out;
}
