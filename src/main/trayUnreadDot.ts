/** Unread dot colour (#EF4444). Must stand out against the navy app icon. */
export const UNREAD_DOT_RGB = { r: 0xef, g: 0x44, b: 0x44 } as const;

/** Light halo so the dot separates from the navy icon on dark panels. */
export const UNREAD_DOT_RING_RGB = { r: 0xe2, g: 0xe8, b: 0xf0 } as const;

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function writePremulBgra(
  bitmap: Buffer,
  idx: number,
  colour: { readonly r: number; readonly g: number; readonly b: number },
  alpha: number,
): void {
  const a = Math.round(clamp01(alpha) * 255);
  // Electron's nativeImage.toBitmap() / createFromBitmap() use Skia
  // SkImageInfo::MakeN32Premul, which is BGRA on macOS/Windows/Linux. Writing RGBA here
  // showed a blue dot on Linux (#1455).
  bitmap[idx] = Math.round((colour.b * a) / 255);
  bitmap[idx + 1] = Math.round((colour.g * a) / 255);
  bitmap[idx + 2] = Math.round((colour.r * a) / 255);
  bitmap[idx + 3] = a;
}

/**
 * Paint exactly one unread-dot + light halo into a tray icon bitmap.
 * Writes BGRA, premultiplied. Safe no-op when dims/buffer are invalid.
 */
export function paintTrayUnreadDot(bitmap: Buffer, width: number, height: number): void {
  if (width <= 0 || height <= 0) return;
  if (bitmap.length < width * height * 4) return;

  const dotR = Math.max(2, Math.round(width / 8));
  const cx = width - dotR - 2;
  const cy = dotR + 2;
  const haloR = dotR + 1;

  const minX = Math.max(0, Math.floor(cx - haloR - 1));
  const maxX = Math.min(width - 1, Math.ceil(cx + haloR + 1));
  const minY = Math.max(0, Math.floor(cy - haloR - 1));
  const maxY = Math.min(height - 1, Math.ceil(cy + haloR + 1));

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const dx = px - cx;
      const dy = py - cy;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const dotCoverage = clamp01(dotR + 0.5 - distance);
      const haloCoverage = clamp01(haloR + 0.5 - distance);
      if (dotCoverage <= 0 && haloCoverage <= 0) continue;

      const idx = (py * width + px) * 4;
      if (dotCoverage > 0) {
        writePremulBgra(bitmap, idx, UNREAD_DOT_RGB, dotCoverage);
      } else {
        writePremulBgra(bitmap, idx, UNREAD_DOT_RING_RGB, haloCoverage);
      }
    }
  }
}
