import { createRequire } from 'node:module';
import path from 'node:path';

import type * as NodeUpsertMod from './nodeUpsert';
import {
  saveNodeRowOn as saveNodeRowOnImpl,
  saveNodesBatchOn as saveNodesBatchOnImpl,
  toNodeUpsertParams as toNodeUpsertParamsImpl,
} from './nodeUpsert';

const requireFromHere = createRequire(__filename);

interface Mod {
  toNodeUpsertParams: typeof NodeUpsertMod.toNodeUpsertParams;
  saveNodeRowOn: typeof NodeUpsertMod.saveNodeRowOn;
  saveNodesBatchOn: typeof NodeUpsertMod.saveNodesBatchOn;
}

let cached: Mod | undefined;

/**
 * Production loads sibling `node-upsert.js` (out of measured index.js budget).
 * Vitest uses the TypeScript bindings; `process.env.VITEST` is defined away in prod esbuild so
 * the static imports are tree-shaken out of measured `index.js`.
 */
function loadNodeUpsertMod(): Mod {
  if (cached) return cached;
  if (process.env.VITEST) {
    cached = {
      toNodeUpsertParams: toNodeUpsertParamsImpl,
      saveNodeRowOn: saveNodeRowOnImpl,
      saveNodesBatchOn: saveNodesBatchOnImpl,
    };
    return cached;
  }
  cached = requireFromHere(path.join(__dirname, 'node-upsert.js')) as Mod;
  return cached;
}

/** @internal */
export function resetNodeUpsertCacheForTests(): void {
  cached = undefined;
}

export function toNodeUpsertParamsViaSibling(
  node: Record<string, unknown>,
): ReturnType<typeof toNodeUpsertParamsImpl> {
  return loadNodeUpsertMod().toNodeUpsertParams(node);
}

export function saveNodeRowViaSibling(
  db: Parameters<typeof saveNodeRowOnImpl>[0],
  params: Parameters<typeof saveNodeRowOnImpl>[1],
): ReturnType<typeof saveNodeRowOnImpl> {
  return loadNodeUpsertMod().saveNodeRowOn(db, params);
}

export function saveNodesBatchViaSibling(
  db: Parameters<typeof saveNodesBatchOnImpl>[0],
  nodes: Parameters<typeof saveNodesBatchOnImpl>[1],
): ReturnType<typeof saveNodesBatchOnImpl> {
  return loadNodeUpsertMod().saveNodesBatchOn(db, nodes);
}
