// @vitest-environment node
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import {
  CURRENT_SCHEMA_VERSION,
  DatabaseSchemaTooNewError,
  runSchemaUpgrade,
} from './db-schema-sync';

// Schema sync walks every migration; default 5s Vitest timeout flakes on busy CI runners.
describe('runSchemaUpgrade', { timeout: 30_000 }, () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('brings a new database to CURRENT_SCHEMA_VERSION with retention defaults', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-test-'));
    const dbPath = join(dir, 'test.db');
    const db = new NodeSqliteDB(dbPath);
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    const rows = db.prepare('SELECT key FROM app_settings ORDER BY key').all() as { key: string }[];
    expect(rows.map((r) => r.key)).toEqual([
      'meshcoreMessageRetentionCount',
      'meshcoreMessageRetentionEnabled',
      'meshtasticMessageRetentionCount',
      'meshtasticMessageRetentionEnabled',
    ]);
    db.close();
  });

  it('upgrades a legacy minimal schema and stamps CURRENT_SCHEMA_VERSION', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-test-'));
    const dbPath = join(dir, 'legacy.db');
    const db = new NodeSqliteDB(dbPath);
    db.execScript('CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT);');
    db.pragma('user_version = 3');
    runSchemaUpgrade(db);
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    const mcCols = db.prepare('PRAGMA table_info(meshcore_contacts)').all() as { name: string }[];
    expect(mcCols.some((c) => c.name === 'public_key')).toBe(true);
    db.close();
  });

  it('repairs corrupt repeater last_advert from hop history and invalid GPS', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-repair-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    db.prepareOnce(
      `INSERT INTO meshcore_contacts (node_id, public_key, contact_type, last_advert, adv_lat, adv_lon, on_radio)
       VALUES (?, ?, 2, 6, 34.0, 2147.48, 1)`,
    ).run(0xabc, 'aa'.repeat(32));
    db.prepareOnce(
      `INSERT INTO meshcore_hop_history (node_id, timestamp, hops, snr, rssi)
       VALUES (?, ?, 3, 1.0, -90)`,
    ).run(0xabc, 1_781_401_113_001);

    runSchemaUpgrade(db);

    const row = db
      .prepareOnce('SELECT last_advert, adv_lon FROM meshcore_contacts WHERE node_id = ?')
      .get(0xabc) as { last_advert: number | null; adv_lon: number | null };
    expect(row.last_advert).toBe(1_781_401_113);
    expect(row.adv_lon).toBeNull();
    db.close();
  });

  it('converts millisecond nodes.last_heard to Unix seconds (v36)', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-last-heard-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    db.prepareOnce(
      `INSERT INTO nodes (node_id, last_heard, source) VALUES (1, ?, 'rf'), (2, ?, 'rf')`,
    ).run(1_781_468_253_215, 1_781_468_200);

    runSchemaUpgrade(db);

    const rows = db.prepareOnce('SELECT node_id, last_heard FROM nodes ORDER BY node_id').all() as {
      node_id: number;
      last_heard: number;
    }[];
    expect(rows[0].last_heard).toBe(1_781_468_253);
    expect(rows[1].last_heard).toBe(1_781_468_200);
    db.close();
  });

  it('dedupes meshcore_messages with null sender_id', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-mc-null-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);
    db.execScript('DROP INDEX IF EXISTS idx_mc_msg_dedup_null_sender');

    const insert = db.prepareOnce(
      `INSERT INTO meshcore_messages (sender_id, payload, channel_idx, timestamp)
       VALUES (NULL, ?, 0, ?)`,
    );
    insert.run('hello', 1_774_000_000_000);
    insert.run('hello', 1_774_000_000_000);

    runSchemaUpgrade(db);

    const count = (
      db.prepareOnce('SELECT COUNT(*) as cnt FROM meshcore_messages').get() as { cnt: number }
    ).cnt;
    expect(count).toBe(1);
    db.close();
  });

  it('removes orphan meshtastic sending rows when acked twin exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-orphan-send-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    const ts = Date.now() - 60_000;
    db.prepareOnce(
      `INSERT INTO messages (sender_id, payload, channel, timestamp, packet_id, status)
       VALUES (100, 'test', 1, ?, 111, 'sending'), (100, 'test', 1, ?, 222, 'acked')`,
    ).run(ts, ts + 1000);

    runSchemaUpgrade(db);

    const rows = db.prepareOnce('SELECT status FROM messages ORDER BY packet_id').all() as {
      status: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('acked');
    db.close();
  });

  it('clamps future meshcore last_advert beyond RTC skew', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-future-advert-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    const futureSec = Math.floor(Date.now() / 1000) + 86_400;
    db.prepareOnce(
      `INSERT INTO meshcore_contacts (node_id, public_key, last_advert, on_radio)
       VALUES (?, ?, ?, 1)`,
    ).run(0xabc, 'bb'.repeat(32), futureSec);

    runSchemaUpgrade(db);

    const row = db
      .prepareOnce('SELECT last_advert FROM meshcore_contacts WHERE node_id = ?')
      .get(0xabc) as { last_advert: number };
    expect(row.last_advert).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    db.close();
  });

  it('deletes orphan meshcore_hop_history rows without contacts', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-orphan-hop-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    db.prepareOnce(
      `INSERT INTO meshcore_hop_history (node_id, timestamp, hops, snr, rssi)
       VALUES (999, ?, 1, 0, -90)`,
    ).run(Date.now());

    runSchemaUpgrade(db);

    const count = (
      db.prepareOnce('SELECT COUNT(*) as cnt FROM meshcore_hop_history').get() as { cnt: number }
    ).cnt;
    expect(count).toBe(0);
    db.close();
  });

  it('rejects database newer than CURRENT_SCHEMA_VERSION without mutating schema', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-too-new-'));
    const db = new NodeSqliteDB(join(dir, 'too-new.db'));
    db.execScript('CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT);');
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION + 1}`);

    expect(() => {
      runSchemaUpgrade(db);
    }).toThrow(DatabaseSchemaTooNewError);
    expect(db.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION + 1);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'")
      .all();
    expect(tables).toHaveLength(0);
    db.close();
  });

  it('promotes stale meshcore room sending rows to acked', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-mc-room-send-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    const staleTs = Date.now() - 60_000;
    db.prepareOnce(
      `INSERT INTO meshcore_messages (sender_id, payload, channel_idx, timestamp, status, room_server_id)
       VALUES (?, ?, -2, ?, 'sending', ?)`,
    ).run(0xabc, 'test post', staleTs, 0xdef);

    runSchemaUpgrade(db);

    const row = db
      .prepareOnce('SELECT status FROM meshcore_messages WHERE sender_id = ?')
      .get(0xabc) as { status: string };
    expect(row.status).toBe('acked');
    db.close();
  });

  it('removes orphan meshcore sending rows when acked twin exists', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-mc-orphan-send-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    const ts = Date.now() - 60_000;
    db.prepareOnce(
      `INSERT INTO meshcore_messages (sender_id, payload, channel_idx, timestamp, status)
       VALUES (?, ?, 0, ?, 'sending'), (?, ?, 0, ?, 'acked')`,
    ).run(100, 'hello', ts, 100, 'hello', ts + 1000);

    runSchemaUpgrade(db);

    const count = (
      db.prepareOnce('SELECT COUNT(*) as cnt FROM meshcore_messages').get() as { cnt: number }
    ).cnt;
    expect(count).toBe(1);
    const row = db.prepareOnce('SELECT status FROM meshcore_messages').get() as { status: string };
    expect(row.status).toBe('acked');
    db.close();
  });

  it('purges MeshCore contact hw_model rows from meshtastic nodes table', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-purge-mc-nodes-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    db.prepareOnce(
      `INSERT INTO nodes (node_id, hw_model, source) VALUES (1, 'RAK4631', 'rf'), (2, 'Repeater', 'rf')`,
    ).run();

    runSchemaUpgrade(db);

    const rows = db.prepareOnce('SELECT node_id FROM nodes ORDER BY node_id').all() as {
      node_id: number;
    }[];
    expect(rows).toEqual([{ node_id: 1 }]);
    db.close();
  });

  it('repairs meshtastic inbound messages with NULL status to acked', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-schema-null-status-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    db.prepareOnce(
      `INSERT INTO messages (sender_id, payload, channel, timestamp, packet_id, status, received_via)
       VALUES (100, 'hi', 0, ?, 999, NULL, 'rf')`,
    ).run(Date.now());

    runSchemaUpgrade(db);

    const row = db.prepareOnce('SELECT status FROM messages').get() as { status: string };
    expect(row.status).toBe('acked');
    db.close();
  });
});
