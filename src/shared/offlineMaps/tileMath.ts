import { MS_PER_SECOND } from '@/shared/timeConstants';

/** Web Mercator latitude clamp (tile math singularity at poles). */
export const WEB_MERCATOR_MAX_LAT = 85.05112878;

/** Default LRU budget for on-disk tile cache (~1 GiB). */
export const TILE_CACHE_MAX_BYTES = 1024 * 1024 * 1024;

/** Hard cap for a single offline region download job. */
export const OFFLINE_MAP_MAX_TILES = 200_000;

/** Soft size estimate cap (~2 GiB at ~10 KiB/tile average). */
export const OFFLINE_MAP_MAX_ESTIMATE_BYTES = 2 * 1024 * 1024 * 1024;

/** Average PNG tile size used only for UI estimates. */
export const OFFLINE_MAP_AVG_TILE_BYTES = 10 * 1024;

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

function normalizeLon(lon: number): number {
  let x = lon;
  while (x < -180) x += 360;
  while (x > 180) x -= 360;
  return x;
}

/** Inclusive tile range covering a geographic bbox at one zoom. */
export function tilesForBoundsAtZoom(bounds: LatLonBounds, zoom: number): WebMercatorTile[] {
  const z = Math.max(0, Math.min(22, Math.floor(zoom)));
  const north = clampLat(bounds.north);
  const south = clampLat(bounds.south);
  if (!(north >= south)) return [];

  const west = normalizeLon(bounds.west);
  const east = normalizeLon(bounds.east);
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
    total += tilesForBoundsAtZoom(bounds, z).length;
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
