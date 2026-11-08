/** Approximate geographic bounds for a center+zoom (Web Mercator viewport). */
export function boundsFromViewport(
  center: [number, number],
  zoom: number,
): { north: number; south: number; east: number; west: number } {
  const z = Math.max(0, Math.floor(zoom));
  const latSpan = 360 / 2 ** z;
  const lonSpan = 360 / 2 ** z;
  const [lat, lon] = center;
  return {
    north: Math.min(85.05, lat + latSpan / 2),
    south: Math.max(-85.05, lat - latSpan / 2),
    east: lon + lonSpan / 2,
    west: lon - lonSpan / 2,
  };
}
