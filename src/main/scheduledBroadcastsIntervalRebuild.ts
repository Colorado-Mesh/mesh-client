/**
 * Production ships this as sibling `scheduled-broadcasts-interval-rebuild.js`
 * so scheduled_broadcasts DDL stays out of the measured main `index.js` budget.
 */
import type { NodeSqliteDB } from './db-compat';

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

function scheduledBroadcastsCreateSql(rowSql: string | null | undefined): boolean {
  return /CREATE\s+TABLE/i.test(rowSql ?? '');
}

function scheduledBroadcastsHasLegacyIntervalCheck(rowSql: string | null | undefined): boolean {
  return /interval\s+IN\s*\(/i.test(rowSql ?? '');
}

function readScheduledBroadcastsMasterSql(db: NodeSqliteDB): string | null {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_broadcasts'`)
    .get() as { sql: string | null } | undefined;
  return row?.sql ?? null;
}

/** Finish or discard a leftover `scheduled_broadcasts_new` from an interrupted swap. */
function resumeScheduledBroadcastsIntervalRebuildIfNeeded(
  db: NodeSqliteDB,
  tableExists: (db: NodeSqliteDB, name: string) => boolean,
): void {
  if (!tableExists(db, NEW_TABLE)) return;

  const mainExists = tableExists(db, 'scheduled_broadcasts');
  if (!mainExists) {
    db.execScript(`ALTER TABLE ${NEW_TABLE} RENAME TO scheduled_broadcasts;`);
    return;
  }

  const mainSql = readScheduledBroadcastsMasterSql(db);
  if (scheduledBroadcastsHasLegacyIntervalCheck(mainSql)) {
    db.transaction(() => {
      db.execScript(
        `DROP TABLE scheduled_broadcasts; ALTER TABLE ${NEW_TABLE} RENAME TO scheduled_broadcasts;`,
      );
    })();
    return;
  }

  if (scheduledBroadcastsCreateSql(mainSql)) {
    db.execScript(`DROP TABLE ${NEW_TABLE};`);
  }
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
  resumeScheduledBroadcastsIntervalRebuildIfNeeded(db, tableExists);

  if (!tableExists(db, 'scheduled_broadcasts')) return;
  const mainSql = readScheduledBroadcastsMasterSql(db);
  // Legacy installs used CHECK (interval IN (...)); IPC validates intervals now.
  if (!scheduledBroadcastsHasLegacyIntervalCheck(mainSql)) return;

  db.transaction(() => {
    db.execScript(
      `CREATE TABLE ${NEW_TABLE}(${TABLE_COLS});` +
        `INSERT INTO ${NEW_TABLE} SELECT * FROM scheduled_broadcasts;` +
        'DROP TABLE scheduled_broadcasts;' +
        `ALTER TABLE ${NEW_TABLE} RENAME TO scheduled_broadcasts;`,
    );
  })();
}

/** Ensure create + strip legacy interval CHECK. */
export function ensureScheduledBroadcastsSchema(
  db: NodeSqliteDB,
  tableExists: (db: NodeSqliteDB, name: string) => boolean,
): void {
  ensureScheduledBroadcastsTable(db);
  rebuildScheduledBroadcastsIntervalCheckIfNeeded(db, tableExists);
}
