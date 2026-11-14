/** Unread dot (#EF4444). */
export const UNREAD_DOT_RGB = { r: 0xef, g: 0x44, b: 0x44 } as const;

/**
 * Test oracle for the tray unread overlay inlined in `buildTrayIcon` (`index.ts`).
 * Kept out of the production import graph so the measured main bundle stays under budget.
 * Writes opaque BGRA — Electron `toBitmap`/`createFromBitmap` use Skia N32Premul (#1455).
 */
export function paintTrayUnreadDot(bitmap: Buffer, width: number, height: number): void {
  if (width <= 0 || height <= 0 || bitmap.length < width * height * 4) return;
  const r = Math.max(2, Math.round(width / 8));
  const cx = width - r - 2;
  const cy = r + 2;
  const r2 = r * r;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * width + x) * 4;
      bitmap[i] = UNREAD_DOT_RGB.b;
      bitmap[i + 1] = UNREAD_DOT_RGB.g;
      bitmap[i + 2] = UNREAD_DOT_RGB.r;
      bitmap[i + 3] = 255;
    }
  }
}
