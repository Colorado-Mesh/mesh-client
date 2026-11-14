import { createRequire } from 'node:module';
import path from 'node:path';

import type { NodeSqliteDB } from './db-compat';
import {
  type ensureScheduledBroadcastsSchema as EnsureFn,
  ensureScheduledBroadcastsSchema as ensureScheduledBroadcastsSchemaImpl,
} from './scheduledBroadcastsIntervalRebuild';

const requireFromHere = createRequire(__filename);

type Ensure = typeof EnsureFn;

let cached: Ensure | undefined;

/**
 * Production loads sibling `scheduled-broadcasts-interval-rebuild.js` (out of measured index.js).
 * Vitest uses the TypeScript binding; `process.env.VITEST` is defined away in prod esbuild so
 * the static import is tree-shaken out of measured `index.js` (only the sibling require remains).
 */
export function loadScheduledBroadcastsSchemaEnsure(): Ensure {
  if (cached) return cached;
  if (process.env.VITEST) {
    cached = ensureScheduledBroadcastsSchemaImpl;
    return cached;
  }
  const mod = requireFromHere(path.join(__dirname, 'scheduled-broadcasts-interval-rebuild.js')) as {
    ensureScheduledBroadcastsSchema: Ensure;
  };
  cached = mod.ensureScheduledBroadcastsSchema;
  return cached;
}

/** @internal */
export function resetScheduledBroadcastsSchemaEnsureCacheForTests(): void {
  cached = undefined;
}

export function ensureScheduledBroadcastsSchemaViaSibling(
  db: NodeSqliteDB,
  tableExists: (db: NodeSqliteDB, name: string) => boolean,
): void {
  loadScheduledBroadcastsSchemaEnsure()(db, tableExists);
}
