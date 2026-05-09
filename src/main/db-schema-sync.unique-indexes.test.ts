// @vitest-environment node
/**
 * Contract + regression tests for CREATE UNIQUE INDEX in schema sync.
 *
 * When adding a new UNIQUE index to INDEX_DDLS, you must:
 * 1. Add dedupe (or equivalent) in structuralUpgrades before that index can be created on dirty DBs.
 * 2. Append the index name to UNIQUE_INDEX_NAMES_WITH_DEDUPE_PATH below (contract test).
 * 3. Add a regression test that drops the index, inserts duplicates on the indexed key, and
 *    asserts runSchemaUpgrade() succeeds (see existing examples).
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import { INDEX_DDLS, runSchemaUpgrade } from './db-schema-sync';

/** Must stay in sync with every `CREATE UNIQUE INDEX` in INDEX_DDLS — contract test enforces this. */
const UNIQUE_INDEX_NAMES_WITH_DEDUPE_PATH = new Set([
  'idx_reaction_dedup',
  'idx_msg_packet_dedup',
  'idx_mc_msg_dedup',
]);

function parseUniqueIndexNamesFromDdls(ddls: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const ddl of ddls) {
    const oneLine = ddl.replace(/\s+/g, ' ').trim();
    const m = /CREATE UNIQUE INDEX IF NOT EXISTS\s+(\w+)/i.exec(oneLine);
    if (m) names.add(m[1]);
  }
  return names;
}

describe('unique index contract (INDEX_DDLS vs dedupe coverage)', () => {
  it('every CREATE UNIQUE INDEX has a registered dedupe path name', () => {
    const fromDdl = parseUniqueIndexNamesFromDdls(INDEX_DDLS);
    expect(fromDdl).toEqual(UNIQUE_INDEX_NAMES_WITH_DEDUPE_PATH);
  });
});

describe('runSchemaUpgrade tolerates missing unique indexes + duplicate keys', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  function openFreshUpgradedDb(name: string): NodeSqliteDB {
    dir = mkdtempSync(join(tmpdir(), 'mesh-uniq-test-'));
    const dbPath = join(dir, name);
    const db = new NodeSqliteDB(dbPath);
    runSchemaUpgrade(db);
    return db;
  }

  it('idx_msg_packet_dedup: dedupes duplicate (sender_id, packet_id) rows', () => {
    const db = openFreshUpgradedDb('packet.db');
    db.execScript('DROP INDEX IF EXISTS idx_msg_packet_dedup');
    db.prepare(
      `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, packet_id)
       VALUES (42, 'n', 'p1', 0, 1000, 999)`,
    ).run();
    db.prepare(
      `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, packet_id)
       VALUES (42, 'n', 'p2', 0, 1001, 999)`,
    ).run();
    runSchemaUpgrade(db);
    const n = (
      db
        .prepare('SELECT COUNT(*) as c FROM messages WHERE sender_id = 42 AND packet_id = 999')
        .get() as {
        c: number;
      }
    ).c;
    expect(n).toBe(1);
    expect(
      db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_msg_packet_dedup' LIMIT 1`,
        )
        .get(),
    ).toBeDefined();
    db.close();
  });

  it('idx_reaction_dedup: dedupes duplicate (sender_id, reply_id, emoji) rows', () => {
    const db = openFreshUpgradedDb('reaction.db');
    db.execScript('DROP INDEX IF EXISTS idx_reaction_dedup');
    db.prepare(
      `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, reply_id, emoji)
       VALUES (1, 'a', 'x', 0, 100, 5, 10)`,
    ).run();
    db.prepare(
      `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, reply_id, emoji)
       VALUES (1, 'a', 'x2', 0, 101, 5, 10)`,
    ).run();
    runSchemaUpgrade(db);
    const n = (
      db.prepare('SELECT COUNT(*) as c FROM messages WHERE reply_id = 5 AND emoji = 10').get() as {
        c: number;
      }
    ).c;
    expect(n).toBe(1);
    expect(
      db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_reaction_dedup' LIMIT 1`,
        )
        .get(),
    ).toBeDefined();
    db.close();
  });

  it('idx_mc_msg_dedup: dedupes duplicate (sender_id, timestamp, channel_idx, payload) rows', () => {
    const db = openFreshUpgradedDb('mc.db');
    db.execScript('DROP INDEX IF EXISTS idx_mc_msg_dedup');
    db.prepare(
      `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp)
       VALUES (7, 'u', 'same', 2, 5000)`,
    ).run();
    db.prepare(
      `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp)
       VALUES (7, 'u', 'same', 2, 5000)`,
    ).run();
    runSchemaUpgrade(db);
    const n = (
      db
        .prepare(
          'SELECT COUNT(*) as c FROM meshcore_messages WHERE sender_id = 7 AND channel_idx = 2 AND payload = ?',
        )
        .get('same') as { c: number }
    ).c;
    expect(n).toBe(1);
    expect(
      db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_mc_msg_dedup' LIMIT 1`,
        )
        .get(),
    ).toBeDefined();
    db.close();
  });
});
