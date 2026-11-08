/** Inverse-distance weighting (power 2) over nearby sample points. */
export function idwTemperature(
  lat: number,
  lon: number,
  points: readonly { lat: number; lon: number; value: number }[],
): number | null {
  if (points.length === 0) return null;
  let num = 0;
  let den = 0;
  const latScale = 111_320;
  const lonScale = 111_320 * Math.cos((lat * Math.PI) / 180);
  let considered = 0;
  for (const p of points) {
    const dx = (lon - p.lon) * lonScale;
    const dy = (lat - p.lat) * latScale;
    const d = Math.hypot(dx, dy);
    if (d < 1) return p.value;
    const w = 1 / d ** 2;
    num += w * p.value;
    den += w;
    considered += 1;
    if (considered >= 16) break;
  }
  return den > 0 ? num / den : null;
}

/**
 * Meteorological from-direction (degrees) → canvas arrow tip direction in radians.
 * Leaflet/canvas y grows downward, so north is −cos.
 */
export function windFromDirectionToArrowRad(fromDirectionDeg: number): number {
  return ((fromDirectionDeg + 180) * Math.PI) / 180;
}

/** Canvas delta for an arrow of length `len` pointing along `rotationRad`. */
export function windArrowDelta(rotationRad: number, len: number): { dx: number; dy: number } {
  return {
    dx: Math.sin(rotationRad) * len,
    dy: -Math.cos(rotationRad) * len,
  };
}
