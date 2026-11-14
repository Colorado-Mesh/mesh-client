/** Unread dot colour (#EF4444). Must stand out against the navy app icon. */
export const UNREAD_DOT_RGB = { r: 0xef, g: 0x44, b: 0x44 } as const;

/** Light halo so the dot separates from the navy icon on dark panels. */
export const UNREAD_DOT_RING_RGB = { r: 0xe2, g: 0xe8, b: 0xf0 } as const;

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Premultiplied source-over into an existing BGRA pixel. */
function blendPremulOver(
  bitmap: Buffer,
  idx: number,
  colour: { readonly r: number; readonly g: number; readonly b: number },
  coverage: number,
): void {
  const sa = clamp01(coverage);
  if (sa <= 0) return;
  const srcA = Math.round(sa * 255);
  const srcB = Math.round((colour.b * srcA) / 255);
  const srcG = Math.round((colour.g * srcA) / 255);
  const srcR = Math.round((colour.r * srcA) / 255);
  const invA = 255 - srcA;
  bitmap[idx] = srcB + Math.round((bitmap[idx] * invA) / 255);
  bitmap[idx + 1] = srcG + Math.round((bitmap[idx + 1] * invA) / 255);
  bitmap[idx + 2] = srcR + Math.round((bitmap[idx + 2] * invA) / 255);
  bitmap[idx + 3] = srcA + Math.round((bitmap[idx + 3] * invA) / 255);
}

/**
 * Paint one unread-dot + light halo into a tray icon bitmap.
 * Halo is composited over the existing pixel, then the dot over the halo (BGRA,
 * premultiplied). Electron `toBitmap`/`createFromBitmap` use Skia N32Premul (#1455).
 */
export function paintTrayUnreadDot(bitmap: Buffer, width: number, height: number): void {
  if (width <= 0 || height <= 0 || bitmap.length < width * height * 4) return;

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
      // Halo first, then dot — do not replace the halo with a partial-alpha dot.
      if (haloCoverage > 0) blendPremulOver(bitmap, idx, UNREAD_DOT_RING_RGB, haloCoverage);
      if (dotCoverage > 0) blendPremulOver(bitmap, idx, UNREAD_DOT_RGB, dotCoverage);
    }
  }
}
