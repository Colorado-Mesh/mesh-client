import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import {
  insertRendererMemorySample,
  pruneRendererMemorySamples,
  RENDERER_MEMORY_SAMPLE_MAX_ROWS,
  summarizeRendererMemorySamples,
} from './renderer-memory-samples';

describe('renderer-memory-samples', () => {
  let db: NodeSqliteDB;
  let dir: string;

  afterEach(() => {
    db.close();
  });

  function openDb(): NodeSqliteDB {
    dir = mkdtempSync(path.join(tmpdir(), 'mesh-mem-'));
    db = new NodeSqliteDB(path.join(dir, 't.db'));
    db.execScript(`
      CREATE TABLE renderer_memory_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        captured_at INTEGER NOT NULL,
        bytes INTEGER NOT NULL,
        source TEXT NOT NULL,
        app_version TEXT,
        session_id TEXT
      );
    `);
    return db;
  }

  it('round-trips inserts and summarizes', () => {
    openDb();
    const base = Date.now() - 60_000;
    insertRendererMemorySample(db, {
      captured_at: base,
      bytes: 10,
      source: 'user-agent',
      app_version: '1.0.0',
      session_id: 's1',
    });
    insertRendererMemorySample(db, {
      captured_at: base + 1_000,
      bytes: 30,
      source: 'user-agent',
      app_version: '1.0.0',
      session_id: 's1',
    });
    expect(summarizeRendererMemorySamples(db)).toEqual({
      count: 2,
      firstAt: base,
      lastAt: base + 1_000,
      minBytes: 10,
      maxBytes: 30,
      spanMs: 1_000,
    });
  });

  it('prunes by row count keeping newest', () => {
    openDb();
    const now = Date.now();
    for (let i = 0; i < RENDERER_MEMORY_SAMPLE_MAX_ROWS + 5; i += 1) {
      insertRendererMemorySample(db, {
        captured_at: now + i,
        bytes: i,
        source: 'renderer-process',
        app_version: null,
        session_id: null,
      });
    }
    const summary = summarizeRendererMemorySamples(db);
    expect(summary.count).toBe(RENDERER_MEMORY_SAMPLE_MAX_ROWS);
    expect(summary.minBytes).toBe(5);
  });

  it('prunes by age', () => {
    openDb();
    const now = Date.now();
    db.prepare(
      `INSERT INTO renderer_memory_samples (captured_at, bytes, source) VALUES (?, ?, ?)`,
    ).run(now - 40 * 24 * 60 * 60 * 1000, 1, 'user-agent');
    db.prepare(
      `INSERT INTO renderer_memory_samples (captured_at, bytes, source) VALUES (?, ?, ?)`,
    ).run(now - 1000, 2, 'user-agent');
    pruneRendererMemorySamples(db, now);
    expect(summarizeRendererMemorySamples(db).count).toBe(1);
    expect(summarizeRendererMemorySamples(db).maxBytes).toBe(2);
  });
});
