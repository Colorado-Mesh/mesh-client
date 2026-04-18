/**
 * Pure math helpers for route-weight map visualization.
 * Exported separately so they can be unit-tested without rendering.
 */

/** Maps a routeWeight value to a stroke width in pixels (range 1–8). */
export function routeWeightToStroke(weight: number, maxWeight: number): number {
  return 1 + (weight / maxWeight) * 7;
}

/**
 * Maps a routeWeight value to a color string.
 * Interpolates from gray (#6b7280) at weight=0 to brand green (#22c55e) at weight=max.
 */
export function routeWeightToColor(weight: number, maxWeight: number): string {
  const t = weight / maxWeight;
  const r = Math.round(107 + t * (34 - 107));
  const g = Math.round(114 + t * (197 - 114));
  const b = Math.round(128 + t * (94 - 128));
  return `rgb(${r},${g},${b})`;
}
