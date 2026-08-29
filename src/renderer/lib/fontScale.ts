/**
 * Root font-size scaling for the main UI.
 * Applied via document.documentElement inline font-size; Tailwind's rem-based
 * sizing makes text and its containers grow together.
 */

export const FONT_SCALE_STORAGE_KEY = 'mesh-client:fontScale';
export const DEFAULT_FONT_SCALE = 1;
export const FONT_SCALE_MIN = 0.85;
export const FONT_SCALE_MAX = 1.5;
export const FONT_SCALE_STEP = 0.05;

/** Snap to the nearest step and clamp; NaN/Infinity fall back to the default. */
export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FONT_SCALE;
  const snapped = Math.round(value / FONT_SCALE_STEP) * FONT_SCALE_STEP;
  const bounded = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, snapped));
  // Step multiplication drifts (0.9000000000000001); keep stored/slider values exact.
  return Number(bounded.toFixed(2));
}

export function loadFontScale(): number {
  const raw = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
  if (raw === null) return DEFAULT_FONT_SCALE;
  return clampFontScale(Number.parseFloat(raw));
}

export function persistFontScale(scale: number): void {
  localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(scale));
}

/** Percentage rather than px so any OS/Chromium base font size is preserved. */
export function applyFontScale(scale: number): void {
  document.documentElement.style.fontSize = `${scale * 100}%`;
}

export function resetFontScale(): void {
  localStorage.removeItem(FONT_SCALE_STORAGE_KEY);
  applyFontScale(DEFAULT_FONT_SCALE);
}
