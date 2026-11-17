// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import {
  readMeshcoreIdentityHydration,
  readMeshtasticIdentityHydration,
  readMeshtasticMessages,
} from './identityHydrationSnapshot';

describe('identityHydrationSnapshot', () => {
  let db: NodeSqliteDB | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  function openDb(): NodeSqliteDB {
    db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    return db;
  }

  it('reads Meshtastic nodes + contacts + messages in one snapshot', () => {
    const d = openDb();
    d.prepareOnce(
      `INSERT INTO nodes (node_id, long_name, short_name, hw_model, battery, snr, last_heard, favorited, source)
       VALUES (1, 'A', 'A1', 'T', 50, 0, 1, 0, 'rf')`,
    ).run();
    d.prepareOnce(
      `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp)
       VALUES (1, 'A', 'hi', 0, 100)`,
    ).run();
    d.prepareOnce(
      `INSERT INTO meshcore_contacts (node_id, public_key, adv_name, contact_type, last_advert, hops_away)
       VALUES (2, 'aa', 'MC', 1, 1, 1)`,
    ).run();
    const snap = readMeshtasticIdentityHydration(d, 10);
    expect(snap.nodes).toHaveLength(1);
    expect(snap.meshcoreContacts).toHaveLength(1);
    expect(snap.messages).toHaveLength(1);
  });

  it('loads the most recently stored Meshtastic rows with their receipt, whatever their radio time', () => {
    const d = openDb();
    const insert = d.prepareOnce(
      `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, received_at)
       VALUES (1, 'A', ?, 0, ?, ?)`,
    );
    insert.run('first in', 1_700_000_000_000, 1_700_000_000_000);
    insert.run('second in', 1_700_000_060_000, 1_700_000_060_000);
    // A Store & Forward replay heard by another radio two hours earlier, stored last.
    insert.run('replayed', 1_699_992_800_000, 1_700_000_120_000);
    const snap = readMeshtasticIdentityHydration(d, 2);
    const rows = snap.messages as { payload: string; receivedAt: number }[];
    expect(rows.map((row) => [row.payload, row.receivedAt]).sort()).toEqual([
      ['replayed', 1_700_000_120_000],
      ['second in', 1_700_000_060_000],
    ]);
  });

  it('keeps rows copied in by a database merge out of the newest window', () => {
    const d = openDb();
    d.prepareOnce(
      `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, received_at)
       VALUES (1, 'A', 'received today', 0, ?, ?)`,
    ).run(1_700_000_000_000, 1_700_000_000_000);
    // A merge inserts old rows without receipts after newer ones (`mergeDatabase`).
    d.prepareOnce(
      `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp)
       VALUES (2, 'B', 'merged from last year', 0, ?)`,
    ).run(1_670_000_000_000);
    const rows = readMeshtasticMessages(d, undefined, 1) as { payload: string }[];
    expect(rows.map((row) => row.payload)).toEqual(['received today']);
  });

  it('reads MeshCore contacts + hops + messages in one snapshot', () => {
    const d = openDb();
    d.prepareOnce(
      `INSERT INTO meshcore_contacts (node_id, public_key, adv_name, contact_type, last_advert, hops_away)
       VALUES (3, 'bb', 'R', 2, 1, 0)`,
    ).run();
    d.prepareOnce(
      `INSERT INTO meshcore_hop_history (node_id, timestamp, hops, snr, rssi) VALUES (3, 1, 2, 1, -70)`,
    ).run();
    d.prepareOnce(
      `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, status)
       VALUES (3, 'R', 'ping', 0, 50, 'acked')`,
    ).run();
    const snap = readMeshcoreIdentityHydration(d);
    expect(snap.contacts).toHaveLength(1);
    expect(snap.hopHistory).toHaveLength(1);
    expect(snap.messages.length).toBeGreaterThanOrEqual(1);
  });
});
