export interface CoordValidation {
  valid: boolean;
  warning?: string;
}

export function validateCoords(lat: number, lon: number): CoordValidation {
  if (lat === 0 && lon === 0)
    return { valid: false, warning: "No GPS fix (0°, 0°)" };
  if (lat < -90 || lat > 90)
    return { valid: false, warning: `Latitude out of range: ${lat.toFixed(4)}°` };
  if (lon < -180 || lon > 180)
    return { valid: false, warning: `Longitude out of range: ${lon.toFixed(4)}°` };
  if (lat === 90 && lon === 0)
    return { valid: false, warning: "GPS no fix (reports North Pole)" };
  return { valid: true };
}
