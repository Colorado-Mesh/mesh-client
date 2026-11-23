/**
 * Production ships this as sibling `scheduled-broadcasts-interval-rebuild.js`
 * so scheduled_broadcasts DDL stays out of the measured main `index.js` budget.
 */
import type { NodeSqliteDB } from './db-compat';
import { sanitizeLogMessage } from './sanitize-log-message';

const TABLE_COLS =
  'slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 12),' +
  "label TEXT NOT NULL DEFAULT ''," +
  "text TEXT NOT NULL DEFAULT ''," +
  'enabled INTEGER NOT NULL DEFAULT 0,' +
  "interval TEXT NOT NULL DEFAULT 'weekly'," +
  'time_of_day_min INTEGER NOT NULL DEFAULT 540 CHECK (time_of_day_min BETWEEN 0 AND 1439),' +
  'weekday INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),' +
  'day_of_month INTEGER CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),' +
  'anchor_ymd TEXT,' +
  'next_due_at INTEGER,' +
  'last_attempt_at INTEGER,' +
  'last_result_json TEXT,' +
  "targets_json TEXT NOT NULL DEFAULT '[]'," +
  'updated_at INTEGER NOT NULL';

const NEW_TABLE = 'scheduled_broadcasts_new';
const REBUILD_SAVEPOINT = 'mesh_sb_interval_rebuild';

function scheduledBroadcastsHasLegacyIntervalCheck(rowSql: string | null | undefined): boolean {
  return /interval\s+IN\s*\(/i.test(rowSql ?? '');
}

function readScheduledBroadcastsMasterSql(db: NodeSqliteDB): string | null {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_broadcasts'`)
    .get() as { sql: string | null } | undefined;
  return row?.sql ?? null;
}

/** Runs fn inside a SAVEPOINT so it can nest under database.ts setup transactions. */
export function withScheduledBroadcastsSavepoint(db: NodeSqliteDB, fn: () => void): void {
  db.execScript(`SAVEPOINT ${REBUILD_SAVEPOINT}`);
  try {
    fn();
    db.execScript(`RELEASE SAVEPOINT ${REBUILD_SAVEPOINT}`);
  } catch (err) {
    try {
      db.execScript(`ROLLBACK TO SAVEPOINT ${REBUILD_SAVEPOINT}`);
      db.execScript(`RELEASE SAVEPOINT ${REBUILD_SAVEPOINT}`);
    } catch (e: unknown) {
      console.debug(
        '[main/scheduledBroadcastsIntervalRebuild] catch:',
        sanitizeLogMessage(e instanceof Error ? e.message : String(e)),
      );
    }
    throw err;
  }
}

/** Promote a populated orphan `_new` before CREATE TABLE would add an empty `scheduled_broadcasts`. */
export function promoteOrDropOrphanNewTable(
  db: NodeSqliteDB,
  tableExists: (db: NodeSqliteDB, name: string) => boolean,
): void {
  if (!tableExists(db, NEW_TABLE) || tableExists(db, 'scheduled_broadcasts')) return;
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${NEW_TABLE}`).get() as { n: number };
  if (row.n > 0) {
    db.execScript(`ALTER TABLE ${NEW_TABLE} RENAME TO scheduled_broadcasts`);
  } else {
    db.execScript(`DROP TABLE ${NEW_TABLE}`);
  }
}

/** Drop a leftover `_new` when legacy/main still exists — never promote partial copies. */
function discardLeftoverNewTableWhenMainExists(
  db: NodeSqliteDB,
  tableExists: (db: NodeSqliteDB, name: string) => boolean,
): void {
  if (!tableExists(db, NEW_TABLE) || !tableExists(db, 'scheduled_broadcasts')) return;
  db.execScript(`DROP TABLE ${NEW_TABLE}`);
}

/** Create table if missing. Interval values are validated in IPC (no SQLite interval CHECK). */
export function ensureScheduledBroadcastsTable(db: NodeSqliteDB): void {
  db.execScript(`CREATE TABLE IF NOT EXISTS scheduled_broadcasts (${TABLE_COLS});`);
}

/**
 * Drop legacy interval IN (...) CHECK (SQLite cannot ALTER CHECK).
 * Call after {@link ensureScheduledBroadcastsTable}.
 */
export function rebuildScheduledBroadcastsIntervalCheckIfNeeded(
  db: NodeSqliteDB,
  tableExists: (db: NodeSqliteDB, name: string) => boolean,
): void {
  promoteOrDropOrphanNewTable(db, tableExists);
  discardLeftoverNewTableWhenMainExists(db, tableExists);

  if (!tableExists(db, 'scheduled_broadcasts')) return;
  const mainSql = readScheduledBroadcastsMasterSql(db);
  // Legacy installs used CHECK (interval IN (...)); IPC validates intervals now.
  if (!scheduledBroadcastsHasLegacyIntervalCheck(mainSql)) return;

  withScheduledBroadcastsSavepoint(db, () => {
    db.execScript(
      `CREATE TABLE ${NEW_TABLE}(${TABLE_COLS});` +
        `INSERT INTO ${NEW_TABLE} SELECT * FROM scheduled_broadcasts;` +
        'DROP TABLE scheduled_broadcasts;' +
        `ALTER TABLE ${NEW_TABLE} RENAME TO scheduled_broadcasts;`,
    );
  });
}

/** Ensure create + strip legacy interval CHECK. */
export function ensureScheduledBroadcastsSchema(
  db: NodeSqliteDB,
  tableExists: (db: NodeSqliteDB, name: string) => boolean,
): void {
  promoteOrDropOrphanNewTable(db, tableExists);
  ensureScheduledBroadcastsTable(db);
  discardLeftoverNewTableWhenMainExists(db, tableExists);
  rebuildScheduledBroadcastsIntervalCheckIfNeeded(db, tableExists);
}
