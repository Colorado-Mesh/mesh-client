import {
  isRendererStorageDeletionSetting,
  RENDERER_STORAGE_DELETION_SETTING_PREFIX,
} from '../shared/rendererOrigin';
import {
  hasAppliedRendererStorageIntent,
  parseRendererStorageDeletionState,
  parseRendererStorageIntent,
  type PendingRendererStorageIntent,
} from '../shared/rendererStorageIntent';
import type { NodeSqliteDB } from './db-compat';

/** Receipt ACKs and migration completion files must never outrun their SQLite commits. */
function withFullSync<T>(db: NodeSqliteDB, operation: () => T): T {
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

export function writeRendererStorageDeletionState(
  db: NodeSqliteDB,
  key: string,
  value: string,
): { changes: number | bigint } {
  if (!isRendererStorageDeletionSetting(key))
    throw new TypeError('Invalid renderer storage deletion key');
  const proposed = parseRendererStorageDeletionState(value);
  return withFullSync(db, () =>
    db.transaction(() => {
      const row = db.prepareOnce('SELECT value FROM app_settings WHERE key = ?').get(key) as
        { value: string } | undefined;
      const previous = parseRendererStorageDeletionState(row?.value);
      // Only the initial main-process importer may pin/replace copied source receipts.
      const next = JSON.stringify({ ...proposed, imported: previous.imported });
      parseRendererStorageDeletionState(next);
      return db
        .prepareOnce('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)')
        .run(key, next);
    })(),
  );
}

/** Pin the live source journal before its first copy can reach an application renderer. */
export function commitImportedRendererStorageIntents(
  db: NodeSqliteDB,
  intents: Readonly<Record<string, PendingRendererStorageIntent>>,
): void {
  if (Object.keys(intents).length === 0) return;
  withFullSync(db, () => {
    db.transaction(() => {
      const read = db.prepareOnce('SELECT value FROM app_settings WHERE key = ?');
      const write = db.prepareOnce('INSERT OR REPLACE INTO app_settings(key, value) VALUES (?, ?)');
      for (const [original, pending] of Object.entries(intents)) {
        const key = `${RENDERER_STORAGE_DELETION_SETTING_PREFIX}${original}`;
        if (!isRendererStorageDeletionSetting(key))
          throw new TypeError('Invalid imported renderer storage key');
        const intent = parseRendererStorageIntent(JSON.stringify(pending));
        const row = read.get(key) as { value: string } | undefined;
        const previous = parseRendererStorageDeletionState(row?.value);
        const consumed = hasAppliedRendererStorageIntent(previous, intent);
        const next = {
          deleted: consumed ? previous.deleted : intent.deleted,
          applied: consumed
            ? previous.applied
            : { ...previous.applied, [intent.origin]: intent.id },
          imported: { ...previous.imported, [intent.origin]: intent.id },
        };
        const value = JSON.stringify(next);
        parseRendererStorageDeletionState(value);
        write.run(key, value);
      }
    })();
  });
}
