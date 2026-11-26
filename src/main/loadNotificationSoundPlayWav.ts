import { createRequire } from 'node:module';
import path from 'node:path';

import type { registerNotificationSoundPlayWavIpc as RegisterFn } from './notificationSoundPlayWav';

const requireFromHere = createRequire(__filename);

export type Register = typeof RegisterFn;

let cached: Register | undefined;

/**
 * Production loads sibling `notification-sound-play-wav.js` (out of measured index.js budget).
 * Vitest loads the TypeScript source; `process.env.VITEST` is defined away in prod esbuild.
 */
export function loadRegisterNotificationSoundPlayWavIpc(): Register {
  if (cached) return cached;
  const mod = (
    process.env.VITEST
      ? requireFromHere('./notificationSoundPlayWav')
      : requireFromHere(path.join(__dirname, 'notification-sound-play-wav.js'))
  ) as { registerNotificationSoundPlayWavIpc: Register };
  cached = mod.registerNotificationSoundPlayWavIpc;
  return cached;
}

/** @internal */
export function resetPlayNotificationSoundWavCacheForTests(): void {
  cached = undefined;
}
