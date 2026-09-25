import { haversineDistanceKm } from '../nodeStatus';

export type LatLon = readonly [lat: number, lon: number];

/** Per-segment great-circle lengths in km; invalid segments count as 0. */
export function polylineSegmentsKm(points: readonly LatLon[]): number[] {
  const segments: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const [lat1, lon1] = points[i - 1];
    const [lat2, lon2] = points[i];
    const km = haversineDistanceKm(lat1, lon1, lat2, lon2);
    segments.push(Number.isFinite(km) ? km : 0);
  }
  return segments;
}

export function polylineLengthKm(points: readonly LatLon[]): number {
  return polylineSegmentsKm(points).reduce((sum, km) => sum + km, 0);
}
