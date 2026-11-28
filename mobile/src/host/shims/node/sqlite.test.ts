import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { routeNodeSqliteToShim } from '../../testing/routeNodeSqlite';
import * as sqliteShim from './sqlite';
import {
  DatabaseSyncShim,
  exportSqliteFile,
  flushMemoryDatabases,
  importSqliteFile,
  listSqliteFiles,
  seedMemorySnapshot,
  setMemorySnapshotWriter,
  setSqliteRuntime,
  sqliteFileExists,
  unlinkSqliteFile,
} from './sqlite';

// The desktop db-compat layer runs unmodified on top of the mobile node:sqlite shim. It loads
// SQLite with require(), which vi.mock does not reach, so the request is routed at the loader.
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

describe('node:sqlite shim (memory backend)', () => {
  it('binds named parameters by bare name and anonymous parameters positionally', () => {
    const db = new DatabaseSyncShim(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, note TEXT, data BLOB)');
    const ins = db.prepare('INSERT INTO t (id, name, note, data) VALUES (@id, :name, $note, ?)');
    const r = ins.run({ id: 7, name: 'alpha', note: null }, new Uint8Array([1, 2, 3]));
    expect(r.changes).toBe(1);
    expect(r.lastInsertRowid).toBe(7);
    const row = db.prepare('SELECT * FROM t WHERE id = ?').get(7);
    expect(row).toMatchObject({ id: 7, name: 'alpha', note: null });
    expect(Array.from(row?.data as Uint8Array)).toEqual([1, 2, 3]);
    db.prepare('INSERT INTO t (id, name) VALUES (?, ?)').run(8, 'beta');
    const all = db.prepare('SELECT id, name FROM t ORDER BY id').all();
    expect(all).toEqual([
      { id: 7, name: 'alpha' },
      { id: 8, name: 'beta' },
    ]);
    expect(db.prepare('SELECT * FROM t WHERE id = ?').get(99)).toBeUndefined();
    expect([...db.prepare('SELECT id FROM t ORDER BY id').iterate()].map((x) => x.id)).toEqual([
      7, 8,
    ]);
    db.close();
    expect(db.isOpen).toBe(false);
  });

  it('supports FTS5 (message search)', () => {
    const db = new DatabaseSyncShim(':memory:');
    db.exec(
      "CREATE VIRTUAL TABLE f USING fts5(body); INSERT INTO f(body) VALUES ('hello mesh'), ('other');",
    );
    expect(db.prepare('SELECT body FROM f WHERE f MATCH ?').all('mesh*')).toEqual([
      { body: 'hello mesh' },
    ]);
    db.close();
  });

  it('persists a file database through snapshots and reopens it', async () => {
    const writes = new Map<string, Uint8Array>();
    setMemorySnapshotWriter((path, bytes) => {
      writes.set(path, bytes);
      return Promise.resolve();
    });
    const path = '/data/user/test-persist.db';
    const db = new DatabaseSyncShim(path);
    db.exec('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT)');
    db.prepare('INSERT INTO kv VALUES (?, ?)').run('a', '1');
    await flushMemoryDatabases();
    const snap = writes.get(path);
    expect(snap?.byteLength).toBeGreaterThan(100);
    db.close();

    seedMemorySnapshot(path, snap ?? new Uint8Array());
    const reopened = new DatabaseSyncShim(path, { readOnly: true });
    expect(reopened.prepare('SELECT v FROM kv WHERE k = ?').get('a')).toEqual({ v: '1' });
    reopened.close();

    expect(sqliteFileExists(path)).toBe(true);
    expect(listSqliteFiles()).toContain(path);
    const exported = exportSqliteFile(path);
    importSqliteFile('/data/user/copy.db', exported);
    const copy = new DatabaseSyncShim('/data/user/copy.db');
    expect(copy.prepare('SELECT count(*) AS n FROM kv').get()).toEqual({ n: 1 });
    copy.close();
    expect(unlinkSqliteFile('/data/user/copy.db')).toBe(true);
    expect(sqliteFileExists('/data/user/copy.db')).toBe(false);
  });

  it('refuses to open a missing database read-only', () => {
    expect(() => new DatabaseSyncShim('/data/user/missing.db', { readOnly: true })).toThrow(
      /unable to open/,
    );
  });
});

describe('desktop db-compat on the mobile shim', () => {
  it('runs pragmas, transactions with rollback, and cached statements', async () => {
    const { NodeSqliteDB } = await import('@/main/db-compat');
    const db = new NodeSqliteDB(':memory:');
    expect((db as unknown as { db: unknown }).db).toBeInstanceOf(DatabaseSyncShim);
    // WAL is not available in the WASM VFS; the pragma must not throw (rollback journal stays).
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('user_version = 42');
    expect(db.pragma('user_version', { simple: true })).toBe(42);
    db.execScript('CREATE TABLE n (id INTEGER PRIMARY KEY, fav INTEGER, name TEXT)');
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO n (id, fav, name) VALUES (@id, @fav, @name)').run({
        id: 1,
        fav: true,
        name: 'x',
        extra: 'ignored',
      });
      throw new Error('boom');
    });
    expect(() => tx()).toThrow('boom');
    expect(db.prepareOnce('SELECT count(*) AS c FROM n').get()).toEqual({ c: 0 });
    db.transaction(() => {
      db.prepare('INSERT INTO n (id, fav, name) VALUES (@id, @fav, @name)').run({
        id: 2,
        fav: false,
        name: undefined,
      });
    })();
    expect(db.prepareOnce('SELECT id, fav, name FROM n').all()).toEqual([
      { id: 2, fav: 0, name: null },
    ]);
    db.close();
  });
});
