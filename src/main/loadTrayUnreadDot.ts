import { createRequire } from 'node:module';
import path from 'node:path';

import type { paintTrayUnreadDot as PaintTrayUnreadDot } from './trayUnreadDot';

const requireFromHere = createRequire(__filename);

type PaintFn = typeof PaintTrayUnreadDot;

let cached: PaintFn | undefined;

/**
 * Production loads sibling `tray-unread-dot.js` (out of measured index.js budget).
 * Vitest loads the TypeScript source; `process.env.VITEST` is defined away in prod esbuild.
 */
export function loadPaintTrayUnreadDot(): PaintFn {
  if (cached) return cached;
  const mod = (
    process.env.VITEST
      ? requireFromHere('./trayUnreadDot')
      : requireFromHere(path.join(__dirname, 'tray-unread-dot.js'))
  ) as { paintTrayUnreadDot: PaintFn };
  cached = mod.paintTrayUnreadDot;
  return cached;
}

/** @internal */
export function resetPaintTrayUnreadDotCacheForTests(): void {
  cached = undefined;
}
