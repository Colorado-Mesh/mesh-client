/**
 * `module` shim. The mobile host bundle has no runtime `require`; the two main-process loaders
 * that `require()` a sibling source under `process.env.VITEST` (defined in the mobile bundle so
 * siblings are inlined) resolve to these statically bundled modules instead.
 */
import * as notificationSoundPlayWav from '../../../../main/notificationSoundPlayWav';
import * as trayUnreadDot from '../../../../main/trayUnreadDot';

const BUNDLED: Record<string, unknown> = {
  './notificationSoundPlayWav': notificationSoundPlayWav,
  './trayUnreadDot': trayUnreadDot,
};

export function createRequire(): (id: string) => unknown {
  return (id: string) => {
    if (Object.prototype.hasOwnProperty.call(BUNDLED, id)) return BUNDLED[id];
    throw new Error(`require('${id}') is not available in the mobile host`);
  };
}
export const builtinModules: string[] = [];
export function isBuiltin(): boolean {
  return false;
}
export default { createRequire, builtinModules, isBuiltin };
