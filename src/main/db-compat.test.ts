// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';

describe('NodeSqliteDB.backup (export snapshot pattern)', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('copies a WAL database via read-only connection backup()', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-db-compat-wal-'));
    const dbPath = join(dir, 'live.db');
    const destPath = join(dir, 'export.db');

    const live = new NodeSqliteDB(dbPath);
    live.execScript('CREATE TABLE t (x INTEGER NOT NULL);');
    live.pragma('journal_mode = WAL');
    live.prepare('INSERT INTO t (x) VALUES (?)').run(42);

    const snapshot = new NodeSqliteDB(dbPath, { readonly: true });
    try {
      snapshot.backup(destPath);
    } finally {
      snapshot.close();
    }
    live.close();

    expect(existsSync(destPath)).toBe(true);
    const verify = new NodeSqliteDB(destPath, { readonly: true });
    try {
      const row = verify.prepare('SELECT x FROM t LIMIT 1').get() as { x: number };
      expect(row.x).toBe(42);
    } finally {
      verify.close();
    }
  });

  it('allows read-only backup while another connection has an open transaction', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-db-compat-txn-'));
    const dbPath = join(dir, 'live.db');
    const destPath = join(dir, 'export.db');

    const live = new NodeSqliteDB(dbPath);
    live.execScript('CREATE TABLE t (x INTEGER NOT NULL);');
    live.pragma('journal_mode = WAL');
    live.prepare('INSERT INTO t (x) VALUES (?)').run(1);
    live.execScript('BEGIN');
    live.prepare('INSERT INTO t (x) VALUES (?)').run(99);

    expect(() => {
      live.backup(destPath);
    }).toThrow(/cannot VACUUM from within a transaction/i);

    const snapshot = new NodeSqliteDB(dbPath, { readonly: true });
    try {
      snapshot.backup(destPath);
    } finally {
      snapshot.close();
    }

    expect(existsSync(destPath)).toBe(true);
    live.execScript('ROLLBACK');
    live.close();

    const verify = new NodeSqliteDB(destPath, { readonly: true });
    try {
      const rows = verify.prepare('SELECT COUNT(*) as c FROM t').get() as { c: number };
      expect(rows.c).toBe(1);
    } finally {
      verify.close();
    }
  });
});
