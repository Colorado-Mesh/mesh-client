import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import {
  ensureScheduledBroadcastsSchema,
  rebuildScheduledBroadcastsIntervalCheckIfNeeded,
  withScheduledBroadcastsSavepoint,
} from './scheduledBroadcastsIntervalRebuild';

const LEGACY_TABLE_DDL = `
  CREATE TABLE scheduled_broadcasts (
    slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 12),
    label TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 0,
    interval TEXT NOT NULL DEFAULT 'weekly'
      CHECK (interval IN ('daily','weekly','biweekly','monthly','every4h','every8h','every12h')),
    time_of_day_min INTEGER NOT NULL DEFAULT 540 CHECK (time_of_day_min BETWEEN 0 AND 1439),
    weekday INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
    day_of_month INTEGER CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
    anchor_ymd TEXT,
    next_due_at INTEGER,
    last_attempt_at INTEGER,
    last_result_json TEXT,
    targets_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );
`;

const NEW_TABLE_DDL = `
  CREATE TABLE scheduled_broadcasts_new (
    slot INTEGER PRIMARY KEY CHECK (slot BETWEEN 1 AND 12),
    label TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 0,
    interval TEXT NOT NULL DEFAULT 'weekly',
    time_of_day_min INTEGER NOT NULL DEFAULT 540 CHECK (time_of_day_min BETWEEN 0 AND 1439),
    weekday INTEGER CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
    day_of_month INTEGER CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31),
    anchor_ymd TEXT,
    next_due_at INTEGER,
    last_attempt_at INTEGER,
    last_result_json TEXT,
    targets_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );
`;

function tableExists(db: NodeSqliteDB, name: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`)
    .get(name);
  return row !== undefined;
}

describe('scheduledBroadcastsIntervalRebuild', () => {
  let dbPath = '';
  let db: NodeSqliteDB | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (dbPath) fs.rmSync(dbPath, { force: true });
    dbPath = '';
  });

  function openTempDb(): NodeSqliteDB {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-sb-rebuild-')), 'test.sqlite');
    db = new NodeSqliteDB(dbPath);
    return db;
  }

  it('creates scheduled_broadcasts without an interval IN CHECK', () => {
    const d = openTempDb();
    ensureScheduledBroadcastsSchema(d, tableExists);
    const row = d
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_broadcasts'`)
      .get() as { sql: string };
    expect(row.sql).toContain('CREATE TABLE');
    expect(row.sql).not.toMatch(/interval\s+IN\s*\(/i);
    expect(tableExists(d, 'scheduled_broadcasts')).toBe(true);
  });

  it('rebuilds legacy tables that still have interval IN CHECK', () => {
    const d = openTempDb();
    d.execScript(`
      ${LEGACY_TABLE_DDL}
      INSERT INTO scheduled_broadcasts (slot, label, text, enabled, interval, updated_at)
      VALUES (1, 'Test', 'hello', 1, 'every4h', 1);
    `);

    rebuildScheduledBroadcastsIntervalCheckIfNeeded(d, tableExists);

    const row = d
      .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_broadcasts'`)
      .get() as { sql: string };
    expect(row.sql).not.toMatch(/interval\s+IN\s*\(/i);
    const saved = d
      .prepare(`SELECT interval, text FROM scheduled_broadcasts WHERE slot = 1`)
      .get() as {
      interval: string;
      text: string;
    };
    expect(saved).toEqual({ interval: 'every4h', text: 'hello' });
  });

  it('runs rebuild inside database.ts outer transaction via savepoints', () => {
    const d = openTempDb();
    d.execScript(`
      ${LEGACY_TABLE_DDL}
      INSERT INTO scheduled_broadcasts (slot, text, enabled, interval, updated_at)
      VALUES (1, 'nested', 1, 'every4h', 1);
    `);
    const setup = d.transaction(() => {
      rebuildScheduledBroadcastsIntervalCheckIfNeeded(d, tableExists);
    });
    expect(() => {
      setup();
    }).not.toThrow();
    const saved = d.prepare(`SELECT text FROM scheduled_broadcasts WHERE slot = 1`).get() as {
      text: string;
    };
    expect(saved.text).toBe('nested');
  });

  it('rolls back savepoint on failure without losing legacy rows', () => {
    const d = openTempDb();
    d.execScript(`
      ${LEGACY_TABLE_DDL}
      INSERT INTO scheduled_broadcasts (slot, text, enabled, interval, updated_at)
      VALUES (1, 'keep-me', 1, 'every4h', 1);
    `);
    expect(() => {
      withScheduledBroadcastsSavepoint(d, () => {
        d.execScript('DROP TABLE scheduled_broadcasts');
        throw new Error('simulated interrupt');
      });
    }).toThrow('simulated interrupt');
    expect(tableExists(d, 'scheduled_broadcasts')).toBe(true);
    const saved = d.prepare(`SELECT text FROM scheduled_broadcasts WHERE slot = 1`).get() as {
      text: string;
    };
    expect(saved.text).toBe('keep-me');
  });

  it('resumes when only scheduled_broadcasts_new remains after DROP', () => {
    const d = openTempDb();
    d.execScript(`
      ${NEW_TABLE_DDL}
      INSERT INTO scheduled_broadcasts_new (slot, label, text, enabled, interval, updated_at)
      VALUES (2, 'Resume', 'data', 1, 'every8h', 2);
    `);
    expect(tableExists(d, 'scheduled_broadcasts')).toBe(false);

    rebuildScheduledBroadcastsIntervalCheckIfNeeded(d, tableExists);

    expect(tableExists(d, 'scheduled_broadcasts_new')).toBe(false);
    expect(tableExists(d, 'scheduled_broadcasts')).toBe(true);
    const saved = d.prepare(`SELECT slot, text FROM scheduled_broadcasts WHERE slot = 2`).get() as {
      slot: number;
      text: string;
    };
    expect(saved).toEqual({ slot: 2, text: 'data' });
  });

  it('re-copies from legacy when interrupted before INSERT (empty scheduled_broadcasts_new)', () => {
    const d = openTempDb();
    d.execScript(`
      ${LEGACY_TABLE_DDL}
      INSERT INTO scheduled_broadcasts (slot, text, enabled, interval, updated_at)
      VALUES (1, 'authoritative', 1, 'every4h', 1);
      ${NEW_TABLE_DDL}
    `);

    rebuildScheduledBroadcastsIntervalCheckIfNeeded(d, tableExists);

    const saved = d.prepare(`SELECT text FROM scheduled_broadcasts WHERE slot = 1`).get() as {
      text: string;
    };
    expect(saved.text).toBe('authoritative');
    expect(tableExists(d, 'scheduled_broadcasts_new')).toBe(false);
  });

  it('re-copies from legacy instead of promoting a partial scheduled_broadcasts_new', () => {
    const d = openTempDb();
    d.execScript(`
      ${LEGACY_TABLE_DDL}
      INSERT INTO scheduled_broadcasts (slot, text, enabled, interval, updated_at)
      VALUES (1, 'authoritative', 1, 'every4h', 1);
      ${NEW_TABLE_DDL}
      INSERT INTO scheduled_broadcasts_new (slot, text, enabled, interval, updated_at)
      VALUES (1, 'partial-copy', 1, 'every4h', 1);
    `);

    rebuildScheduledBroadcastsIntervalCheckIfNeeded(d, tableExists);

    const saved = d.prepare(`SELECT text FROM scheduled_broadcasts WHERE slot = 1`).get() as {
      text: string;
    };
    expect(saved.text).toBe('authoritative');
  });

  it('ensureScheduledBroadcastsSchema promotes populated _new before creating empty main', () => {
    const d = openTempDb();
    d.execScript(`
      ${NEW_TABLE_DDL}
      INSERT INTO scheduled_broadcasts_new (slot, text, enabled, interval, updated_at)
      VALUES (3, 'only-new', 1, 'daily', 3);
    `);
    expect(tableExists(d, 'scheduled_broadcasts')).toBe(false);

    ensureScheduledBroadcastsSchema(d, tableExists);

    expect(tableExists(d, 'scheduled_broadcasts_new')).toBe(false);
    const saved = d.prepare(`SELECT text FROM scheduled_broadcasts WHERE slot = 3`).get() as {
      text: string;
    };
    expect(saved.text).toBe('only-new');
  });

  it('is a no-op when interval CHECK is already absent', () => {
    const d = openTempDb();
    ensureScheduledBroadcastsSchema(d, tableExists);
    const before = (
      d
        .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_broadcasts'`)
        .get() as { sql: string }
    ).sql;
    rebuildScheduledBroadcastsIntervalCheckIfNeeded(d, tableExists);
    const after = (
      d
        .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_broadcasts'`)
        .get() as { sql: string }
    ).sql;
    expect(after).toBe(before);
  });
});
