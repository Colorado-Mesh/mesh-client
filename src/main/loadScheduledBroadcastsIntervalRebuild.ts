import { createRequire } from 'node:module';
import path from 'node:path';

import type { NodeSqliteDB } from './db-compat';
import type * as RebuildMod from './scheduledBroadcastsIntervalRebuild';
import {
  ensureScheduledBroadcastsTable as ensureTableImpl,
  rebuildScheduledBroadcastsIntervalCheckIfNeeded as rebuildImpl,
} from './scheduledBroadcastsIntervalRebuild';

const requireFromHere = createRequire(__filename);

interface Mod {
  ensureScheduledBroadcastsTable: typeof RebuildMod.ensureScheduledBroadcastsTable;
  rebuildScheduledBroadcastsIntervalCheckIfNeeded: typeof RebuildMod.rebuildScheduledBroadcastsIntervalCheckIfNeeded;
}

let cached: Mod | undefined;

/**
 * Production loads sibling `scheduled-broadcasts-interval-rebuild.js` (out of measured index.js).
 * Vitest uses the TypeScript bindings; `process.env.VITEST` is defined away in prod esbuild so
 * the static imports are tree-shaken out of measured `index.js`.
 */
function loadScheduledBroadcastsSchemaMod(): Mod {
  if (cached) return cached;
  if (process.env.VITEST) {
    cached = {
      ensureScheduledBroadcastsTable: ensureTableImpl,
      rebuildScheduledBroadcastsIntervalCheckIfNeeded: rebuildImpl,
    };
    return cached;
  }
  cached = requireFromHere(path.join(__dirname, 'scheduled-broadcasts-interval-rebuild.js')) as Mod;
  return cached;
}

/** @internal */
export function resetScheduledBroadcastsSchemaEnsureCacheForTests(): void {
  cached = undefined;
}

/** Create table if missing (call from ensureTablesOnly). */
export function ensureScheduledBroadcastsTableViaSibling(db: NodeSqliteDB): void {
  loadScheduledBroadcastsSchemaMod().ensureScheduledBroadcastsTable(db);
}

/**
 * Strip legacy interval IN (...) CHECK after ensureColumns so ALTER-added columns exist
 * before the table-copy rebuild.
 */
export function rebuildScheduledBroadcastsIntervalCheckViaSibling(
  db: NodeSqliteDB,
  tableExists: (db: NodeSqliteDB, name: string) => boolean,
): void {
  loadScheduledBroadcastsSchemaMod().rebuildScheduledBroadcastsIntervalCheckIfNeeded(
    db,
    tableExists,
  );
}
