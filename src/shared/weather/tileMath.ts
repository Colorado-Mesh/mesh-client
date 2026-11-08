import type { LatLonBounds } from './validation';

export const WEB_MERCATOR_RADIUS_M = 6_378_137;
export const WEB_MERCATOR_WORLD_M = 2 * Math.PI * WEB_MERCATOR_RADIUS_M;

export interface MercatorBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function lonLatToWebMercator(lon: number, lat: number): { x: number; y: number } {
  const latClamped = Math.min(85.05112878, Math.max(-85.05112878, lat));
  const latRad = (latClamped * Math.PI) / 180;
  return {
    x: (lon * Math.PI * WEB_MERCATOR_RADIUS_M) / 180,
    y: Math.log(Math.tan(Math.PI / 4 + latRad / 2)) * WEB_MERCATOR_RADIUS_M,
  };
}

export function webMercatorTileBounds(z: number, x: number, y: number): MercatorBounds {
  const world = WEB_MERCATOR_WORLD_M;
  const tileSize = world / 2 ** z;
  return {
    minX: x * tileSize - world / 2,
    maxX: (x + 1) * tileSize - world / 2,
    maxY: world / 2 - y * tileSize,
    minY: world / 2 - (y + 1) * tileSize,
  };
}

export function tileToBounds(z: number, x: number, y: number): LatLonBounds {
  const { minX, minY, maxX, maxY } = webMercatorTileBounds(z, x, y);
  const R = WEB_MERCATOR_RADIUS_M;
  const west = (minX / R) * (180 / Math.PI);
  const east = (maxX / R) * (180 / Math.PI);
  const north = (Math.atan(Math.sinh(maxY / R)) * 180) / Math.PI;
  const south = (Math.atan(Math.sinh(minY / R)) * 180) / Math.PI;
  return { north, south, east, west };
}
