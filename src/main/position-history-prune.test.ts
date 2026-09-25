// @vitest-environment node
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { MS_PER_DAY } from '../shared/timeConstants';
import {
  MAX_POSITION_PRUNE_EXEMPT_IDS,
  normalizePositionPruneExemptNodeIds,
  prunePositionHistoryOn,
  prunePositionHistoryPerNodeOn,
  sanitizeExemptNodeIdsArg,
} from './database';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';

const NODE_A = 0xabcd1234;
const NODE_B = 0x0000beef;

function openDb(dir: string): NodeSqliteDB {
  const db = new NodeSqliteDB(join(dir, 'test.db'));
  db.pragma('journal_mode = WAL');
  runSchemaUpgrade(db);
  return db;
}

function insertPositions(db: NodeSqliteDB, nodeId: number, recordedAt: number[]): void {
  const stmt = db.prepareOnce(
    'INSERT INTO position_history (node_id, latitude, longitude, recorded_at) VALUES (?, 39.7, -105.0, ?)',
  );
  for (const ts of recordedAt) stmt.run(nodeId, ts);
}

function countFor(db: NodeSqliteDB, nodeId: number): number {
  return (
    db
      .prepareOnce('SELECT COUNT(*) AS cnt FROM position_history WHERE node_id = ?')
      .get(nodeId) as { cnt: number }
  ).cnt;
}

describe('normalizePositionPruneExemptNodeIds', () => {
  it('parses !hex, 0x hex, decimal strings, and numbers; drops invalid', () => {
    expect(
      normalizePositionPruneExemptNodeIds([
        '!abcd1234',
        '!ABCD1234',
        '0xbeef',
        '48879',
        12,
        '',
        'nope',
        '!123456789',
        -1,
        1.5,
        0,
      ]).sort((a, b) => a - b),
    ).toEqual([12, 0xbeef, NODE_A]);
  });

  it('accepts sets and returns [] for nullish input', () => {
    expect(normalizePositionPruneExemptNodeIds(new Set(['!0000beef']))).toEqual([NODE_B]);
    expect(normalizePositionPruneExemptNodeIds(undefined)).toEqual([]);
    expect(normalizePositionPruneExemptNodeIds(null)).toEqual([]);
  });
});

describe('sanitizeExemptNodeIdsArg', () => {
  it('rejects non-arrays and filters non string/number entries', () => {
    expect(sanitizeExemptNodeIdsArg(undefined)).toBeUndefined();
    expect(sanitizeExemptNodeIdsArg('!abcd1234')).toBeUndefined();
    expect(sanitizeExemptNodeIdsArg(['!a', 1, {}, null, true])).toEqual(['!a', 1]);
  });

  it('caps the array length', () => {
    const big = Array.from({ length: MAX_POSITION_PRUNE_EXEMPT_IDS + 5 }, (_, i) => i + 1);
    expect(sanitizeExemptNodeIdsArg(big)).toHaveLength(MAX_POSITION_PRUNE_EXEMPT_IDS);
  });
});

describe('position history prune exemptions', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('age prune skips exempt node ids and keeps existing behavior without them', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-pos-prune-age-'));
    const db = openDb(dir);
    const old = Date.now() - 40 * MS_PER_DAY;
    const fresh = Date.now();
    insertPositions(db, NODE_A, [old, fresh]);
    insertPositions(db, NODE_B, [old, fresh]);

    expect(prunePositionHistoryOn(db, 30, new Set(['!abcd1234']))).toBe(1);
    expect(countFor(db, NODE_A)).toBe(2);
    expect(countFor(db, NODE_B)).toBe(1);

    expect(prunePositionHistoryOn(db, 30)).toBe(1);
    expect(countFor(db, NODE_A)).toBe(1);
    db.close();
  });

  it('per-node cap skips exempt node ids', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-pos-prune-cap-'));
    const db = openDb(dir);
    const base = Date.now();
    insertPositions(db, NODE_A, [base - 3000, base - 2000, base - 1000]);
    insertPositions(db, NODE_B, [base - 3000, base - 2000, base - 1000]);

    expect(prunePositionHistoryPerNodeOn(db, 1, [String(NODE_B)])).toBe(2);
    expect(countFor(db, NODE_A)).toBe(1);
    expect(countFor(db, NODE_B)).toBe(3);

    expect(prunePositionHistoryPerNodeOn(db, 1, [])).toBe(2);
    expect(countFor(db, NODE_B)).toBe(1);
    db.close();
  });
});
