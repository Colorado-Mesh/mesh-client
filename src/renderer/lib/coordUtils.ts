import { forward as mgrsForward } from 'mgrs';

export type CoordinateFormat = 'decimal' | 'mgrs';

export function formatCoordPair(lat: number, lon: number, format: CoordinateFormat): string {
  if (format === 'mgrs') {
    try {
      return mgrsForward([lon, lat]); // mgrs API takes [lon, lat]
    } catch {
      // catch-no-log-ok polar coords and UPS zone not representable in MGRS; fall back to decimal
    }
  }
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function formatCoordColumns(
  lat: number | null | undefined,
  lon: number | null | undefined,
  format: CoordinateFormat,
): { latCell: string; lonCell: string } {
  if (lat == null || lon == null || (lat === 0 && lon === 0)) {
    return { latCell: '-', lonCell: '-' };
  }
  if (format === 'mgrs') {
    try {
      return { latCell: mgrsForward([lon, lat]), lonCell: '-' };
    } catch {
      // catch-no-log-ok polar coords and UPS zone not representable in MGRS; fall back to decimal
    }
  }
  return { latCell: lat.toFixed(4), lonCell: lon.toFixed(4) };
}

export interface CoordValidation {
  valid: boolean;
  warning?: string;
}

export function validateCoords(lat: number, lon: number): CoordValidation {
  if (lat === 0 && lon === 0) return { valid: false, warning: 'No GPS fix (0°, 0°)' };
  if (lat < -90 || lat > 90)
    return { valid: false, warning: `Latitude out of range: ${lat.toFixed(4)}°` };
  if (lon < -180 || lon > 180)
    return { valid: false, warning: `Longitude out of range: ${lon.toFixed(4)}°` };
  if (lat === 90 && lon === 0) return { valid: false, warning: 'GPS no fix (reports North Pole)' };
  return { valid: true };
}
