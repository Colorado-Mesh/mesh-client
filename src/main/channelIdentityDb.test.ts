// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { backfillChannelKeys, clearChannelMessagesByKey } from './channelIdentityDb';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import { persistMeshcoreMessage } from './meshcoreMessageChannel';

const KEY_EMERGENCY = 'aaaaaaaaaaaaaaaa';
const KEY_REACH = 'bbbbbbbbbbbbbbbb';
const RADIO_OLD = 111;
const RADIO_NEW = 222;

function openDb(): NodeSqliteDB {
  const db = new NodeSqliteDB(':memory:');
  runSchemaUpgrade(db);
  return db;
}

interface McRow {
  payload: string;
  channel: number;
  radio: number | null;
  key?: string | null;
  to?: number | null;
}

function insertMeshcore(db: NodeSqliteDB, rows: McRow[]): void {
  for (const r of rows) {
    db.prepareOnce(
      'INSERT INTO meshcore_messages (sender_id, payload, channel_idx, to_node, timestamp, radio_node_id, channel_key) VALUES (1, ?, ?, ?, 1, ?, ?)',
    ).run(r.payload, r.channel, r.to ?? null, r.radio, r.key ?? null);
  }
}

function meshcoreKeys(
  db: NodeSqliteDB,
): Record<string, { key: string | null; radio: number | null }> {
  const rows = db
    .prepareOnce('SELECT payload, channel_key, radio_node_id FROM meshcore_messages')
    .all() as { payload: string; channel_key: string | null; radio_node_id: number | null }[];
  return Object.fromEntries(
    rows.map((r) => [r.payload, { key: r.channel_key, radio: r.radio_node_id }]),
  );
}

describe.each(['linux', 'darwin', 'win32'])('channel identity DB helpers on %s', () => {
  it('adds channel_key to both message tables and radio_node_id to Meshtastic messages', () => {
    const db = openDb();
    try {
      const cols = (table: string) =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      expect(cols('messages')).toEqual(expect.arrayContaining(['radio_node_id', 'channel_key']));
      expect(cols('meshcore_messages')).toEqual(
        expect.arrayContaining(['radio_node_id', 'channel_key']),
      );
    } finally {
      db.close();
    }
  });

  it('backfills only this radio’s unkeyed group rows, leaving other radios and DMs alone', () => {
    const db = openDb();
    try {
      insertMeshcore(db, [
        { payload: 'old radio slot 1', channel: 1, radio: RADIO_OLD },
        { payload: 'new radio slot 1', channel: 1, radio: RADIO_NEW },
        { payload: 'new radio slot 2', channel: 2, radio: RADIO_NEW },
        { payload: 'already keyed', channel: 1, radio: RADIO_NEW, key: KEY_REACH },
        { payload: 'dm', channel: -1, radio: RADIO_NEW, to: 5 },
        { payload: 'legacy', channel: 1, radio: null },
      ]);
      const result = backfillChannelKeys(db, 'meshcore', RADIO_NEW, [
        { index: 1, key: KEY_EMERGENCY },
        { index: 2, key: KEY_REACH },
      ]);
      expect(result.changes).toBe(2);
      const keys = meshcoreKeys(db);
      expect(keys['old radio slot 1']).toEqual({ key: null, radio: RADIO_OLD });
      expect(keys['new radio slot 1']).toEqual({ key: KEY_EMERGENCY, radio: RADIO_NEW });
      expect(keys['new radio slot 2']).toEqual({ key: KEY_REACH, radio: RADIO_NEW });
      expect(keys['already keyed']).toEqual({ key: KEY_REACH, radio: RADIO_NEW });
      expect(keys.dm).toEqual({ key: null, radio: RADIO_NEW });
      expect(keys.legacy).toEqual({ key: null, radio: null });
    } finally {
      db.close();
    }
  });

  it('attributes pre-tracking rows to the first tracked radio, not to whichever radio connects', () => {
    const db = openDb();
    try {
      insertMeshcore(db, [
        { payload: 'legacy reach slot 1', channel: 1, radio: null },
        { payload: 'legacy dm', channel: -1, radio: null, to: 5 },
        { payload: 'first tracked', channel: 1, radio: RADIO_OLD },
        { payload: 'mqtt later', channel: 1, radio: null },
      ]);

      backfillChannelKeys(db, 'meshcore', RADIO_NEW, [{ index: 1, key: KEY_EMERGENCY }]);
      let keys = meshcoreKeys(db);
      expect(keys['legacy reach slot 1']).toEqual({ key: null, radio: RADIO_OLD });
      expect(keys['legacy dm']).toEqual({ key: null, radio: null });
      expect(keys['mqtt later']).toEqual({ key: null, radio: null });

      backfillChannelKeys(db, 'meshcore', RADIO_OLD, [{ index: 1, key: KEY_REACH }]);
      keys = meshcoreKeys(db);
      expect(keys['legacy reach slot 1']).toEqual({ key: KEY_REACH, radio: RADIO_OLD });
      expect(keys['first tracked']).toEqual({ key: KEY_REACH, radio: RADIO_OLD });
    } finally {
      db.close();
    }
  });

  it('leaves pre-tracking rows alone until some radio has saved a tracked row', () => {
    const db = openDb();
    try {
      insertMeshcore(db, [{ payload: 'legacy', channel: 1, radio: null }]);
      expect(
        backfillChannelKeys(db, 'meshcore', RADIO_NEW, [{ index: 1, key: KEY_EMERGENCY }]).changes,
      ).toBe(0);
      expect(meshcoreKeys(db).legacy).toEqual({ key: null, radio: null });
    } finally {
      db.close();
    }
  });

  it('adopts and backfills Meshtastic broadcast rows but never DMs', () => {
    const db = openDb();
    try {
      const insert = db.prepareOnce(
        'INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, to_node, radio_node_id) VALUES (1, ?, ?, ?, 1, ?, ?)',
      );
      insert.run('a', 'broadcast', 1, null, null);
      insert.run('a', 'broadcast sentinel', 1, 0xffffffff, null);
      insert.run('a', 'dm', 1, 42, null);
      insert.run('a', 'first tracked', 1, null, RADIO_NEW);
      backfillChannelKeys(db, 'meshtastic', RADIO_NEW, [{ index: 1, key: KEY_EMERGENCY }]);
      const rows = db
        .prepareOnce('SELECT payload, channel_key, radio_node_id FROM messages ORDER BY id')
        .all();
      expect(rows).toEqual([
        { payload: 'broadcast', channel_key: KEY_EMERGENCY, radio_node_id: RADIO_NEW },
        { payload: 'broadcast sentinel', channel_key: KEY_EMERGENCY, radio_node_id: RADIO_NEW },
        { payload: 'dm', channel_key: null, radio_node_id: null },
        { payload: 'first tracked', channel_key: KEY_EMERGENCY, radio_node_id: RADIO_NEW },
      ]);
    } finally {
      db.close();
    }
  });

  it('clears a channel by key across slots, keeping other channels in the same slot', () => {
    const db = openDb();
    try {
      insertMeshcore(db, [
        {
          payload: 'emergency on old radio slot 3',
          channel: 3,
          radio: RADIO_OLD,
          key: KEY_EMERGENCY,
        },
        {
          payload: 'emergency on new radio slot 1',
          channel: 1,
          radio: RADIO_NEW,
          key: KEY_EMERGENCY,
        },
        { payload: 'reach on old radio slot 1', channel: 1, radio: RADIO_OLD, key: KEY_REACH },
        { payload: 'unkeyed new radio slot 1', channel: 1, radio: RADIO_NEW },
        { payload: 'unkeyed old radio slot 1', channel: 1, radio: RADIO_OLD },
      ]);
      const result = clearChannelMessagesByKey(db, 'meshcore', 1, RADIO_NEW, KEY_EMERGENCY);
      expect(result.changes).toBe(3);
      expect(Object.keys(meshcoreKeys(db)).sort()).toEqual([
        'reach on old radio slot 1',
        'unkeyed old radio slot 1',
      ]);
    } finally {
      db.close();
    }
  });

  it('persists and later fills channel_key through persistMeshcoreMessage', () => {
    const db = openDb();
    try {
      const base = {
        sender_id: 7,
        sender_name: 'n',
        payload: 'hello',
        channel_idx: 1,
        timestamp: 1000,
        local_order: null,
        status: 'acked',
        packet_id: null,
        emoji: null,
        reply_id: null,
        to_node: null,
        received_via: 'rf',
        rx_packet_fingerprint: null,
        reply_preview_text: null,
        reply_preview_sender: null,
        rx_hops: null,
        room_server_id: null,
        radio_node_id: RADIO_NEW,
      };
      persistMeshcoreMessage(db, base);
      expect(meshcoreKeys(db).hello).toEqual({ key: null, radio: RADIO_NEW });
      persistMeshcoreMessage(db, { ...base, channel_key: KEY_EMERGENCY });
      expect(meshcoreKeys(db).hello).toEqual({ key: KEY_EMERGENCY, radio: RADIO_NEW });
      persistMeshcoreMessage(db, { ...base, channel_key: KEY_REACH });
      expect(meshcoreKeys(db).hello).toEqual({ key: KEY_EMERGENCY, radio: RADIO_NEW });
    } finally {
      db.close();
    }
  });
});
