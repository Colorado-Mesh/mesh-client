import type { NodeSqliteDB } from './db-compat';

const FTS_TABLES = [
  {
    fts: 'messages_fts',
    source: 'messages',
    rowid: 'id',
    column: 'payload',
    triggers: ['messages_fts_ai', 'messages_fts_ad', 'messages_fts_au'],
  },
  {
    fts: 'meshcore_messages_fts',
    source: 'meshcore_messages',
    rowid: 'id',
    column: 'payload',
    triggers: ['meshcore_messages_fts_ai', 'meshcore_messages_fts_ad', 'meshcore_messages_fts_au'],
  },
  {
    fts: 'reticulum_messages_fts',
    source: 'reticulum_messages',
    rowid: 'id',
    column: 'payload',
    triggers: [
      'reticulum_messages_fts_ai',
      'reticulum_messages_fts_ad',
      'reticulum_messages_fts_au',
    ],
  },
] as const;

function ftsTableExists(db: NodeSqliteDB, name: string): boolean {
  const row = db
    .prepareOnce(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
    .get(name) as { 1: number } | undefined;
  return row != null;
}

/** Build an FTS5 MATCH query from user input (prefix match per token). */
export function buildFtsMatchQuery(raw: string): string | null {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["*]/g, '').trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

function createFtsForTable(
  db: NodeSqliteDB,
  fts: string,
  source: string,
  rowid: string,
  column: string,
  triggers: readonly [string, string, string],
): void {
  if (ftsTableExists(db, fts)) return;

  db.execScript(
    `CREATE VIRTUAL TABLE ${fts} USING fts5(${column}, content='${source}', content_rowid='${rowid}')`,
  );

  const [ai, ad, au] = triggers;
  db.execScript(`
    CREATE TRIGGER ${ai} AFTER INSERT ON ${source} BEGIN
      INSERT INTO ${fts}(rowid, ${column}) VALUES (new.${rowid}, new.${column});
    END;
    CREATE TRIGGER ${ad} AFTER DELETE ON ${source} BEGIN
      INSERT INTO ${fts}(${fts}, rowid, ${column}) VALUES('delete', old.${rowid}, old.${column});
    END;
    CREATE TRIGGER ${au} AFTER UPDATE ON ${source} BEGIN
      INSERT INTO ${fts}(${fts}, rowid, ${column}) VALUES('delete', old.${rowid}, old.${column});
      INSERT INTO ${fts}(rowid, ${column}) VALUES (new.${rowid}, new.${column});
    END;
  `);

  db.execScript(`INSERT INTO ${fts}(rowid, ${column}) SELECT ${rowid}, ${column} FROM ${source}`);
}

/** Idempotent FTS5 virtual tables + sync triggers for message search. */
export function ensureMessageFtsTables(db: NodeSqliteDB): void {
  for (const spec of FTS_TABLES) {
    createFtsForTable(db, spec.fts, spec.source, spec.rowid, spec.column, spec.triggers);
  }
}

export function isMessageFtsReady(db: NodeSqliteDB): boolean {
  return ftsTableExists(db, 'messages_fts');
}
