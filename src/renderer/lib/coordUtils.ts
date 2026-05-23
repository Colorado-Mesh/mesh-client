import { forward as mgrsForward } from 'mgrs';

export type CoordinateFormat = 'decimal' | 'mgrs';

/** True when lat/lon are present and not the null-island placeholder (0, 0). */
export function nodeHasDisplayablePosition(node: {
  latitude?: number | null;
  longitude?: number | null;
}): boolean {
  return (
    node.latitude != null &&
    node.longitude != null &&
    !(node.latitude === 0 && node.longitude === 0)
  );
}

/** Latest point from a position-history trail, or null when empty. */
export function latestPositionHistoryPoint(
  points: { t: number; lat: number; lon: number }[] | undefined,
): { lat: number; lon: number } | null {
  if (!points || points.length === 0) return null;
  let latest = points[0];
  for (let i = 1; i < points.length; i++) {
    if (points[i].t > latest.t) latest = points[i];
  }
  if (latest.lat === 0 && latest.lon === 0) return null;
  return { lat: latest.lat, lon: latest.lon };
}

/** NodeDB lat/lon when present, otherwise newest tracked point. */
export function resolveNodeMapPosition(
  node: { latitude?: number | null; longitude?: number | null },
  latestTracked?: { lat: number; lon: number } | null,
): { lat: number; lon: number } | null {
  if (nodeHasDisplayablePosition(node)) {
    return { lat: node.latitude!, lon: node.longitude! };
  }
  return latestTracked ?? null;
}

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
