import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { routeNodeSqliteToShim } from '../../testing/routeNodeSqlite';
// Loading the fs shim registers its snapshot sink (exports folder -> share sheet).
import { placeImportedFile, readFileSync, setExportSink, statSync } from './fs';
import * as sqliteShim from './sqlite';
import {
  DatabaseSyncShim,
  importSqliteFile,
  listSqliteFiles,
  setSqliteRuntime,
  sqliteFileExists,
  unlinkSqliteFile,
} from './sqlite';

// The desktop db-compat layer (Export / Import Database) runs unmodified on the mobile shims.
vi.mock('fs', async () => await import('./fs'));
vi.mock('node:fs', async () => await import('./fs'));
let restoreSqlite: () => void = () => undefined;

beforeAll(async () => {
  const sqlite3 = await (sqlite3InitModule as unknown as (o?: unknown) => Promise<unknown>)({
    print: () => {},
    printErr: () => {},
  });
  setSqliteRuntime({ sqlite3, pool: null });
  restoreSqlite = routeNodeSqliteToShim(sqliteShim);
});
afterAll(() => {
  restoreSqlite();
});

it('db-compat runs on the mobile shim in these tests', async () => {
  const { NodeSqliteDB } = await import('@/main/db-compat');
  const db = new NodeSqliteDB(':memory:') as unknown as { db: unknown; close(): void };
  expect(db.db).toBeInstanceOf(DatabaseSyncShim);
  db.close();
});

/** A small database image with one known row. */
function databaseBytes(marker: string): Uint8Array {
  const db = new DatabaseSyncShim(':memory:');
  db.exec('CREATE TABLE t (v TEXT)');
  db.prepare('INSERT INTO t (v) VALUES (?)').run(marker);
  const bytes = db.serialize();
  db.close();
  return bytes;
}

function readMarker(path: string): unknown {
  const db = new DatabaseSyncShim(path, { readOnly: true });
  const row = db.prepare('SELECT v FROM t').get() as { v?: unknown } | undefined;
  db.close();
  return row?.v;
}

describe('Export Database (VACUUM INTO) on mobile', () => {
  it('delivers a readable snapshot to the share sheet and leaves nothing in the SQLite store', async () => {
    const sent: { path: string; bytes: Uint8Array }[] = [];
    setExportSink((path, bytes) => {
      sent.push({ path, bytes });
      return Promise.resolve();
    });
    const { NodeSqliteDB } = await import('@/main/db-compat');
    const db = new NodeSqliteDB(':memory:');
    db.execScript("CREATE TABLE t (v TEXT); INSERT INTO t (v) VALUES ('exported')");
    db.backup("/exports/mesh client's backup.db");
    db.close();

    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0].path).toBe("/exports/mesh client's backup.db");
    expect(sqliteFileExists("/exports/mesh client's backup.db")).toBe(false);
    importSqliteFile('/check/export.db', sent[0].bytes);
    expect(readMarker('/check/export.db')).toBe('exported');
    unlinkSqliteFile('/check/export.db');
  });

  it('puts a snapshot for any other path into the SQLite store', async () => {
    const { NodeSqliteDB } = await import('@/main/db-compat');
    const db = new NodeSqliteDB(':memory:');
    db.execScript("CREATE TABLE t (v TEXT); INSERT INTO t (v) VALUES ('kept')");
    db.backup('/data/userData/backups/copy.db');
    db.close();
    expect(readMarker('/data/userData/backups/copy.db')).toBe('kept');
    unlinkSqliteFile('/data/userData/backups/copy.db');
  });
});

describe('Import Database (a picked file) on mobile', () => {
  it('stores a picked database where DatabaseSync and fs both find it', () => {
    const bytes = databaseBytes('picked');
    const path = placeImportedFile('backup.db', bytes);
    expect(path).toMatch(/^\/imports\/[0-9a-f-]{36}\/backup\.db$/);
    expect((statSync(path) as { size: number }).size).toBe(bytes.byteLength);
    expect(readMarker(path)).toBe('picked');
  });

  it('gives a database picked without a .db name one, and keeps one import in the store', () => {
    placeImportedFile('first.db', databaseBytes('one'));
    const path = placeImportedFile('backup from phone', databaseBytes('two'));
    expect(path.endsWith('/backup from phone.db')).toBe(true);
    expect(readMarker(path)).toBe('two');
    expect(listSqliteFiles().filter((p) => p.startsWith('/imports/'))).toEqual([path]);
  });

  it('leaves any other picked file as a plain file', () => {
    const before = listSqliteFiles().length;
    const path = placeImportedFile('notes.txt', new TextEncoder().encode('hello'));
    expect(new TextDecoder().decode(readFileSync(path) as Uint8Array)).toBe('hello');
    expect(listSqliteFiles()).toHaveLength(before);
  });
});
