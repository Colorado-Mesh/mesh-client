/** True when latitude/longitude are within WGS84 ranges (non-null pair). */
export function isValidLatLon(
  lat: number | null | undefined,
  lon: number | null | undefined,
): boolean {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lon === 'number' &&
    Number.isFinite(lon) &&
    lon >= -180 &&
    lon <= 180
  );
}
