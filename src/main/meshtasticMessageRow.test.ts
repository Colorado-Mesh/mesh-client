// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import { type MeshtasticMessageRowParams, persistMeshtasticMessage } from './meshtasticMessageRow';

describe('persistMeshtasticMessage', () => {
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

  const row: MeshtasticMessageRowParams = {
    sender_id: 0xaaaa,
    sender_name: 'Peer',
    payload: 'replayed',
    channel: 0,
    timestamp: 1_699_992_800_000,
    packet_id: 4242,
    status: 'acked',
    error: null,
    emoji: null,
    reply_id: null,
    to_node: null,
    mqtt_status: null,
    received_via: 'rf',
    reply_preview_text: null,
    reply_preview_sender: null,
    rx_hops: null,
    via_store_forward: 0,
    radio_node_id: null,
    channel_key: null,
    received_at: 1_700_000_120_000,
  };

  it('stores the first receipt and keeps it when the same packet is saved again', () => {
    const d = openDb();
    expect(persistMeshtasticMessage(d, row).changes).toBe(1);
    expect(persistMeshtasticMessage(d, { ...row, received_at: 1_700_000_900_000 }).changes).toBe(0);
    expect(d.prepareOnce('SELECT payload, timestamp, received_at FROM messages').all()).toEqual([
      { payload: 'replayed', timestamp: 1_699_992_800_000, received_at: 1_700_000_120_000 },
    ]);
  });

  it('stores no receipt when the renderer sends none', () => {
    const d = openDb();
    expect(persistMeshtasticMessage(d, { ...row, received_at: null }).changes).toBe(1);
    expect(d.prepareOnce('SELECT received_at FROM messages').all()).toEqual([
      { received_at: null },
    ]);
  });
});
