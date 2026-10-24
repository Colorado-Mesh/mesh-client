import type { NodeSqliteDB } from './db-compat';

/** Complete critical writes before acknowledging them or fsyncing a migration/reset receipt. */
export function withFullSqliteSync<T>(db: NodeSqliteDB, operation: () => T): T {
  const previous = db.pragma('synchronous', { simple: true });
  const modes = new Map<unknown, string>([
    [0, 'OFF'],
    [1, 'NORMAL'],
    [2, 'FULL'],
    [3, 'EXTRA'],
  ]);
  const restore = modes.get(previous);
  if (restore === undefined) throw new Error('Cannot determine SQLite synchronous mode');
  db.pragma('synchronous = FULL');
  try {
    return operation();
  } finally {
    db.pragma(`synchronous = ${restore}`);
  }
}
