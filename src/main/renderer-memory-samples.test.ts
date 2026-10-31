import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import {
  exportRendererMemorySamples,
  insertRendererMemorySample,
  listRendererMemorySamples,
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
        session_id TEXT,
        js_heap_bytes INTEGER,
        total_js_heap_bytes INTEGER,
        dom_nodes INTEGER
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
      js_heap_bytes: 5,
      total_js_heap_bytes: 8,
      dom_nodes: 100,
    });
    expect(summarizeRendererMemorySamples(db)).toEqual({
      count: 2,
      firstAt: base,
      lastAt: base + 1_000,
      minBytes: 10,
      maxBytes: 30,
      spanMs: 1_000,
    });
    expect(listRendererMemorySamples(db)).toEqual([
      {
        capturedAt: base,
        bytes: 10,
        source: 'user-agent',
        appVersion: '1.0.0',
        sessionId: 's1',
        jsHeapBytes: null,
        totalJsHeapBytes: null,
        domNodes: null,
      },
      {
        capturedAt: base + 1_000,
        bytes: 30,
        source: 'user-agent',
        appVersion: '1.0.0',
        sessionId: 's1',
        jsHeapBytes: 5,
        totalJsHeapBytes: 8,
        domNodes: 100,
      },
    ]);
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

  it('lists newest rows oldest-first and includes them in export', () => {
    openDb();
    const base = Date.now();
    for (let i = 0; i < 5; i += 1) {
      insertRendererMemorySample(db, {
        captured_at: base + i,
        bytes: 100 + i,
        source: 'renderer-process',
        app_version: '2.0.0',
        session_id: 's',
      });
    }
    expect(listRendererMemorySamples(db, { limit: 3 })).toEqual([
      {
        capturedAt: base + 2,
        bytes: 102,
        source: 'renderer-process',
        appVersion: '2.0.0',
        sessionId: 's',
        jsHeapBytes: null,
        totalJsHeapBytes: null,
        domNodes: null,
      },
      {
        capturedAt: base + 3,
        bytes: 103,
        source: 'renderer-process',
        appVersion: '2.0.0',
        sessionId: 's',
        jsHeapBytes: null,
        totalJsHeapBytes: null,
        domNodes: null,
      },
      {
        capturedAt: base + 4,
        bytes: 104,
        source: 'renderer-process',
        appVersion: '2.0.0',
        sessionId: 's',
        jsHeapBytes: null,
        totalJsHeapBytes: null,
        domNodes: null,
      },
    ]);
    const exported = exportRendererMemorySamples(db);
    expect(exported.count).toBe(5);
    expect(exported.samples).toHaveLength(5);
    expect(exported.samples[0]?.bytes).toBe(100);
    expect(exported.samples.at(-1)?.bytes).toBe(104);
  });
});
