/** WCAG 2.x relative luminance and contrast ratio for #rrggbb hex colors. */

function hexChannelToLinear(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function parseHex6(hex: string): [number, number, number] {
  const normalized = hex.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    throw new Error(`expected #rrggbb hex, got ${hex}`);
  }
  return [
    parseInt(normalized.slice(1, 3), 16),
    parseInt(normalized.slice(3, 5), 16),
    parseInt(normalized.slice(5, 7), 16),
  ];
}

/** Relative luminance per WCAG 2.1 (0–1). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex6(hex);
  const rl = hexChannelToLinear(r);
  const gl = hexChannelToLinear(g);
  const bl = hexChannelToLinear(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** Contrast ratio between two #rrggbb colors (1–21). */
export function contrastRatio(foregroundHex: string, backgroundHex: string): number {
  const l1 = relativeLuminance(foregroundHex);
  const l2 = relativeLuminance(backgroundHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
