// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import {
  readMeshcoreIdentityHydration,
  readMeshtasticIdentityHydration,
  readReticulumIdentityHydration,
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

  it('reads Reticulum destinations + messages in one snapshot', () => {
    const d = openDb();
    const hash = 'a'.repeat(32);
    d.prepareOnce(
      `INSERT INTO reticulum_destinations (destination_hash, display_name, last_heard, favorited)
       VALUES (?, 'Peer', 1, 0)`,
    ).run(hash);
    d.prepareOnce(
      `INSERT INTO reticulum_messages (identity_id, sender_id, sender_name, payload, timestamp)
       VALUES ('id-1', ?, 'Peer', 'hi', 10)`,
    ).run(hash);
    const snap = readReticulumIdentityHydration(d, 'id-1', 50);
    expect(snap.destinations).toHaveLength(1);
    expect(snap.messages).toHaveLength(1);
  });
});
