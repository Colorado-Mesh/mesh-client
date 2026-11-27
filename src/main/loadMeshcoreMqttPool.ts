import { createRequire } from 'node:module';
import path from 'node:path';

import type * as MeshcoreMqttPoolMod from './meshcore-mqtt-pool';
import { MeshcoreMqttPool as MeshcoreMqttPoolImpl } from './meshcore-mqtt-pool';

const requireFromHere = createRequire(__filename);

let cached: typeof MeshcoreMqttPoolImpl | undefined;

/**
 * Production loads sibling `meshcore-mqtt-pool.js` (out of measured index.js budget).
 * Vitest uses the TypeScript binding; `process.env.VITEST` is defined away in prod esbuild so the
 * static import is tree-shaken out of measured `index.js`.
 */
export function loadMeshcoreMqttPoolClass(): typeof MeshcoreMqttPoolImpl {
  if (cached) return cached;
  if (process.env.VITEST) {
    cached = MeshcoreMqttPoolImpl;
    return cached;
  }
  const mod = requireFromHere(
    path.join(__dirname, 'meshcore-mqtt-pool.js'),
  ) as typeof MeshcoreMqttPoolMod;
  cached = mod.MeshcoreMqttPool;
  return cached;
}

/** @internal */
export function resetMeshcoreMqttPoolLoaderForTests(): void {
  cached = undefined;
}
