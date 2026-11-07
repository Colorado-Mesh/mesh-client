import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ensureMlxHelper } from './os/ensureMlxHelper';
import type { MlxAiHelper } from './os/mlxAiHelper';
import type { OsAiHelper } from './os/osAiHelper';

export interface NativeAiRuntime {
  ensureMlxHelper: typeof ensureMlxHelper;
  MlxAiHelper: typeof MlxAiHelper;
  OsAiHelper: typeof OsAiHelper;
}

let cached: Promise<NativeAiRuntime> | undefined;

/**
 * Production main ships `ai-native-runtime.js` next to `index.js`.
 * Vitest loads TypeScript sources; `process.env.VITEST` is defined away in production esbuild.
 */
export async function loadNativeAiRuntime(): Promise<NativeAiRuntime> {
  cached ??= (async () => {
    if (process.env.VITEST) {
      return await import('./nativeRuntime');
    }
    const sibling = path.join(__dirname, 'ai-native-runtime.js');
    return (await import(pathToFileURL(sibling).href)) as NativeAiRuntime;
  })();
  return cached;
}

/** @internal */
export function resetNativeAiRuntimeCacheForTests(): void {
  cached = undefined;
}
