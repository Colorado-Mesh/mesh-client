/**
 * Pure math helpers for route-weight map visualization.
 * Exported separately so they can be unit-tested without rendering.
 */

/** Maps a routeWeight value to a stroke width in pixels (range 1–8). */
export function routeWeightToStroke(weight: number, maxWeight: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(maxWeight) || maxWeight <= 0) return 1;
  const t = Math.max(0, Math.min(1, weight / maxWeight));
  return 1 + t * 7;
}

/**
 * Maps a routeWeight value to a color string.
 * Interpolates from gray (#71717a) at weight=0 to brand green (#22c55e) at weight=max.
 */
export function routeWeightToColor(weight: number, maxWeight: number): string {
  if (!Number.isFinite(weight) || !Number.isFinite(maxWeight) || maxWeight <= 0) {
    return 'rgb(107,114,128)';
  }
  const t = Math.max(0, Math.min(1, weight / maxWeight));
  const r = Math.round(107 + t * (34 - 107));
  const g = Math.round(114 + t * (197 - 114));
  const b = Math.round(128 + t * (94 - 128));
  return `rgb(${r},${g},${b})`;
}
