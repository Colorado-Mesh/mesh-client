import { createRequire } from 'node:module';
import path from 'node:path';

import type { MeshcoreMqttAdapter } from './meshcore-mqtt-adapter';
import type * as MeshcoreMqttPoolMod from './meshcore-mqtt-pool';

const requireFromHere = createRequire(__filename);

export type MeshcoreMqttPoolCtor = (typeof MeshcoreMqttPoolMod)['MeshcoreMqttPool'];
export type MeshcoreMqttAdapterCtor = typeof MeshcoreMqttAdapter;

let cachedPool: MeshcoreMqttPoolCtor | undefined;
let cachedAdapter: MeshcoreMqttAdapterCtor | undefined;

/**
 * Resolve the pool module. Production uses sibling `meshcore-mqtt-pool.js` (out of measured
 * index.js budget). Vitest uses extensionless createRequire of the TypeScript sources (same
 * pattern as `loadTrayUnreadDot`) so this loader never holds a value import that would pull the
 * adapter into measured `index.js`.
 */
function loadMeshcoreMqttPoolModule(): typeof MeshcoreMqttPoolMod {
  if (process.env.VITEST) {
    return requireFromHere('./meshcore-mqtt-pool') as typeof MeshcoreMqttPoolMod;
  }
  return requireFromHere(
    path.join(__dirname, 'meshcore-mqtt-pool.js'),
  ) as typeof MeshcoreMqttPoolMod;
}

/** Production loads sibling `meshcore-mqtt-pool.js` (out of measured index.js budget). */
export function loadMeshcoreMqttPoolClass(): MeshcoreMqttPoolCtor {
  if (cachedPool) return cachedPool;
  cachedPool = loadMeshcoreMqttPoolModule().MeshcoreMqttPool;
  return cachedPool;
}

/**
 * Same sibling chunk as the pool — MeshCom constructs an adapter without a static import of
 * `meshcore-mqtt-adapter` in index.ts (that was pulling the whole adapter into the budget).
 */
export function loadMeshcoreMqttAdapterClass(): MeshcoreMqttAdapterCtor {
  if (cachedAdapter) return cachedAdapter;
  cachedAdapter = loadMeshcoreMqttPoolModule().MeshcoreMqttAdapter;
  return cachedAdapter;
}

/** @internal */
export function resetMeshcoreMqttPoolLoaderForTests(): void {
  cachedPool = undefined;
  cachedAdapter = undefined;
}
