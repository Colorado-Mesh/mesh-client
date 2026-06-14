// @vitest-environment node
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import { CURRENT_SCHEMA_VERSION, runSchemaUpgrade } from './db-schema-sync';

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
});
