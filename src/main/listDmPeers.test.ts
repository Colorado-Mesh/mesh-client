import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import {
  clampDmPeerLimit,
  listMeshcoreDmPeersFromDb,
  listMeshtasticDmPeersFromDb,
} from './listDmPeers';

describe('listDmPeers', () => {
  let dir: string | undefined;
  let db: NodeSqliteDB | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-dm-peers-'));
    db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);
  });

  afterEach(() => {
    db?.close();
    db = undefined;
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('clampDmPeerLimit bounds values', () => {
    expect(clampDmPeerLimit(undefined)).toBe(2000);
    expect(clampDmPeerLimit(0)).toBe(1);
    expect(clampDmPeerLimit(99999)).toBe(5000);
  });

  it('list helpers tolerate empty tables', () => {
    expect(listMeshtasticDmPeersFromDb(db!, Number.NaN)).toEqual([]);
    expect(listMeshcoreDmPeersFromDb(db!, 1)).toEqual([]);
  });

  it('listMeshtasticDmPeersFromDb returns distinct DM peers ordered by latest', () => {
    const own = 1;
    db!
      .prepareOnce(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node)
         VALUES (?, 'a', 'hi', 0, ?, ?)`,
      )
      .run(2, 1000, own);
    db!
      .prepareOnce(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node)
         VALUES (?, 'me', 'yo', 0, ?, ?)`,
      )
      .run(own, 3000, 2);
    db!
      .prepareOnce(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node)
         VALUES (?, 'me', 'bye', 0, ?, ?)`,
      )
      .run(own, 2000, 4);
    // channel broadcast — ignored
    db!
      .prepareOnce(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node)
         VALUES (?, 'c', 'ch', 0, ?, NULL)`,
      )
      .run(5, 9000);
    // broadcast dest — ignored
    db!
      .prepareOnce(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node)
         VALUES (?, 'me', 'all', 0, ?, ?)`,
      )
      .run(own, 8000, 0xffffffff);

    const rows = listMeshtasticDmPeersFromDb(db!, own);
    expect(rows.map((r) => r.node_id)).toEqual([2, 4]);
    expect(rows[0]?.last_message_at).toBe(3000);
    expect(rows[1]?.last_message_at).toBe(2000);
  });

  it('listMeshcoreDmPeersFromDb uses channel_idx = -1 only', () => {
    const own = 1;
    db!
      .prepareOnce(
        `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, to_node)
         VALUES (?, 'a', 'hi', -1, ?, ?)`,
      )
      .run(9, 1000, own);
    db!
      .prepareOnce(
        `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, to_node)
         VALUES (?, 'me', 'yo', -1, ?, ?)`,
      )
      .run(own, 2000, 10);
    // room channel — ignored
    db!
      .prepareOnce(
        `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, to_node)
         VALUES (?, 'room', 'post', -2, ?, ?)`,
      )
      .run(11, 9000, own);

    const rows = listMeshcoreDmPeersFromDb(db!, own);
    expect(rows.map((r) => r.node_id).sort((a, b) => a - b)).toEqual([9, 10]);
  });

  it('listMeshtasticDmPeersFromDb excludes self and respects limit', () => {
    const own = 1;
    db!
      .prepareOnce(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node)
         VALUES (?, 'me', 'loop', 0, ?, ?)`,
      )
      .run(own, 9000, own);
    db!
      .prepareOnce(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node)
         VALUES (?, 'a', 'hi', 0, ?, ?)`,
      )
      .run(2, 1000, own);
    db!
      .prepareOnce(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node)
         VALUES (?, 'b', 'hi', 0, ?, ?)`,
      )
      .run(3, 2000, own);
    db!
      .prepareOnce(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node)
         VALUES (?, 'c', 'hi', 0, ?, ?)`,
      )
      .run(4, 3000, own);

    const rows = listMeshtasticDmPeersFromDb(db!, own, 2);
    expect(rows.map((r) => r.node_id)).toEqual([4, 3]);
    expect(rows.every((r) => r.node_id !== own)).toBe(true);
  });

  it('listMeshcoreDmPeersFromDb includes null to_node inbound and orders by latest', () => {
    const own = 1;
    db!
      .prepareOnce(
        `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, to_node)
         VALUES (?, 'a', 'hi', -1, ?, NULL)`,
      )
      .run(9, 1000);
    db!
      .prepareOnce(
        `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, to_node)
         VALUES (?, 'b', 'hi', -1, ?, ?)`,
      )
      .run(10, 3000, own);
    db!
      .prepareOnce(
        `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, to_node)
         VALUES (?, 'me', 'loop', -1, ?, ?)`,
      )
      .run(own, 9000, own);

    const rows = listMeshcoreDmPeersFromDb(db!, own);
    expect(rows.map((r) => r.node_id)).toEqual([10, 9]);
    expect(rows.every((r) => r.node_id !== own)).toBe(true);
  });

  it('listMeshtasticDmPeersFromDb orders peers by their latest arrival', () => {
    const own = 1;
    const insert = db!.prepareOnce(
      `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node, received_at)
       VALUES (?, 'p', 'hi', 0, ?, ?, ?)`,
    );
    // Peer 2's clock runs two hours behind, and its DM arrived last.
    insert.run(2, 1_699_992_800_000, own, 1_700_000_120_000);
    // Peer 3 stamped later but arrived earlier.
    insert.run(3, 1_700_000_060_000, own, 1_700_000_060_000);
    // Peer 4 was saved before arrival times were kept, so its stamp stands in.
    insert.run(4, 1_700_000_090_000, own, null);

    expect(listMeshtasticDmPeersFromDb(db!, own)).toEqual([
      { node_id: 2, last_message_at: 1_700_000_120_000 },
      { node_id: 4, last_message_at: 1_700_000_090_000 },
      { node_id: 3, last_message_at: 1_700_000_060_000 },
    ]);
  });

  it('listMeshcoreDmPeersFromDb orders peers by their latest arrival', () => {
    const own = 1;
    const insert = db!.prepareOnce(
      `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, to_node, received_at)
       VALUES (?, 'p', 'hi', -1, ?, ?, ?)`,
    );
    insert.run(9, 1_699_992_800_000, own, 1_700_000_120_000);
    insert.run(10, 1_700_000_060_000, own, 1_700_000_060_000);
    insert.run(11, 1_700_000_090_000, own, null);

    expect(listMeshcoreDmPeersFromDb(db!, own)).toEqual([
      { node_id: 9, last_message_at: 1_700_000_120_000 },
      { node_id: 11, last_message_at: 1_700_000_090_000 },
      { node_id: 10, last_message_at: 1_700_000_060_000 },
    ]);
  });
});
