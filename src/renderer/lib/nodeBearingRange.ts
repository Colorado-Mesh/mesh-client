import { latestPositionHistoryPoint, resolveNodeMapPosition } from './coordUtils';
import { formatDroneDistance } from './droneReportParse';
import type { OurPositionReference } from './locationTrust';
import { bearingBetween, formatBearing, haversineDistanceKm } from './nodeStatus';

export interface NodeBearingRange {
  bearing: string;
  distance: string;
}

/**
 * Bearing and distance from our position to a node. Null unless our position is `trusted`
 * (same gate as `homeNodeForDistanceChecks`) and the node has a displayable or tracked position.
 */
export function nodeBearingRange(
  origin: OurPositionReference | null,
  node: { latitude?: number | null; longitude?: number | null },
  trackedPoints: { t: number; lat: number; lon: number }[] | undefined,
  unit: 'miles' | 'km',
  locale?: string,
): NodeBearingRange | null {
  if (origin?.trust !== 'trusted') return null;
  const target = resolveNodeMapPosition(node, latestPositionHistoryPoint(trackedPoints));
  if (!target) return null;
  const km = haversineDistanceKm(origin.lat, origin.lon, target.lat, target.lon);
  const deg = bearingBetween(origin.lat, origin.lon, target.lat, target.lon);
  if (!Number.isFinite(km) || !Number.isFinite(deg)) return null;
  return {
    bearing: formatBearing(deg),
    distance: formatDroneDistance(km, unit, locale),
  };
}
