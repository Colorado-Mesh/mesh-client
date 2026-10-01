// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { meshcoreMessageChannelIndex } from '../shared/meshcoreMessageChannel';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import {
  clearMeshcoreMessagesByChannel,
  MESHCORE_MESSAGE_CHANNEL_SQL,
  type MeshcoreMessageRowParams,
  persistMeshcoreMessage,
  validateMeshcoreMessageLocalOrder,
} from './meshcoreMessageChannel';

describe.each(['linux', 'darwin', 'win32'])('MeshCore message clearing on %s', () => {
  it('accepts absent legacy order or a safe integer and rejects invalid IPC order values', () => {
    for (const order of [undefined, null, 0, 1700000000576001, Number.MAX_SAFE_INTEGER]) {
      expect(() => {
        validateMeshcoreMessageLocalOrder(order);
      }).not.toThrow();
    }
    for (const order of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', {}]) {
      expect(() => {
        validateMeshcoreMessageLocalOrder(order);
      }).toThrow('local_order must be a non-negative safe integer');
    }
  });

  function fixture() {
    const db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    const rows = [
      { payload: 'incoming DM', channel: -1, to: 1, room: null },
      { payload: 'legacy sent DM', channel: 0, to: 2, room: null },
      { payload: 'other selected channel DM', channel: 7, to: 3, room: null },
      { payload: 'new sent DM', channel: -1, to: 4, room: null },
      { payload: 'inbound unknown recipient', channel: -1, to: 0, room: null },
      { payload: 'public channel', channel: 0, to: null, room: null },
      { payload: 'broadcast sentinel', channel: 0, to: 0xffffffff, room: null },
      { payload: 'unknown channel recipient', channel: 0, to: 0, room: null },
      { payload: 'another group', channel: 7, to: null, room: null },
      { payload: 'room post', channel: -2, to: 5, room: null },
      { payload: 'room metadata', channel: 0, to: 5, room: 5 },
    ];
    for (const row of rows) {
      db.prepareOnce(
        'INSERT INTO meshcore_messages (sender_id,payload,channel_idx,to_node,room_server_id,timestamp) VALUES (1,?,?,?,?,1)',
      ).run(row.payload, row.channel, row.to, row.room);
    }
    return { db, rows };
  }

  it('clears both directions of all DMs, including legacy group-channel sends, preserving groups and rooms', () => {
    const { db } = fixture();
    try {
      expect(clearMeshcoreMessagesByChannel(db, -1).changes).toBe(5);
      const remaining = db.prepareOnce('SELECT payload FROM meshcore_messages ORDER BY id').all();
      expect(remaining).toEqual([
        { payload: 'public channel' },
        { payload: 'broadcast sentinel' },
        { payload: 'unknown channel recipient' },
        { payload: 'another group' },
        { payload: 'room post' },
        { payload: 'room metadata' },
      ]);
    } finally {
      db.close();
    }
  });

  it('clearing public history preserves DMs and room rows stored under that old channel', () => {
    const { db } = fixture();
    try {
      expect(clearMeshcoreMessagesByChannel(db, 0).changes).toBe(3);
      expect(db.prepareOnce('SELECT COUNT(*) AS n FROM meshcore_messages').get()).toEqual({ n: 8 });
      expect(
        db
          .prepareOnce("SELECT payload FROM meshcore_messages WHERE payload = 'legacy sent DM'")
          .get(),
      ).toEqual({ payload: 'legacy sent DM' });
    } finally {
      db.close();
    }
  });

  it('re-saves a legacy DM in place and retains its first local order through ACK updates', () => {
    const db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    const row: MeshcoreMessageRowParams = {
      sender_id: 1,
      sender_name: null,
      payload: 'command',
      channel_idx: -1,
      timestamp: 1700000000576,
      local_order: 1700000000576000,
      status: 'pending',
      packet_id: 10,
      emoji: null,
      reply_id: null,
      to_node: 2,
      received_via: null,
      rx_packet_fingerprint: null,
      reply_preview_text: null,
      reply_preview_sender: null,
      rx_hops: null,
      room_server_id: null,
    };
    try {
      const legacy = db
        .prepareOnce(
          'INSERT INTO meshcore_messages (sender_id,payload,channel_idx,to_node,timestamp,status) VALUES (1,?,0,2,?,?)',
        )
        .run(row.payload, row.timestamp, 'pending');
      expect(persistMeshcoreMessage(db, row).changes).toBe(1);
      expect(
        persistMeshcoreMessage(db, {
          ...row,
          local_order: row.local_order! + 1000,
          status: 'acked',
          packet_id: 11,
        }).changes,
      ).toBe(1);
      expect(
        db
          .prepareOnce('SELECT id,channel_idx,local_order,status,packet_id FROM meshcore_messages')
          .all(),
      ).toEqual([
        {
          id: Number(legacy.lastInsertRowid),
          channel_idx: 0,
          local_order: row.local_order,
          status: 'acked',
          packet_id: 11,
        },
      ]);
      expect(clearMeshcoreMessagesByChannel(db, -1).changes).toBe(1);

      const anonymousLegacy = db
        .prepareOnce(
          'INSERT INTO meshcore_messages (sender_id,payload,channel_idx,to_node,timestamp,status) VALUES (NULL,?,0,2,?,?)',
        )
        .run(row.payload, row.timestamp, 'pending');
      const anonymousRow = {
        ...row,
        sender_id: null,
        local_order: Number(anonymousLegacy.lastInsertRowid),
      };
      expect(persistMeshcoreMessage(db, anonymousRow).changes).toBe(1);
      expect(persistMeshcoreMessage(db, { ...anonymousRow, status: 'acked' }).changes).toBe(1);
      expect(
        db.prepareOnce('SELECT id,channel_idx,local_order,status FROM meshcore_messages').all(),
      ).toEqual([
        {
          id: Number(anonymousLegacy.lastInsertRowid),
          channel_idx: 0,
          local_order: anonymousRow.local_order,
          status: 'acked',
        },
      ]);
    } finally {
      db.close();
    }
  });

  it('persists a new DM once and preserves its first local order when replayed', () => {
    const db = new NodeSqliteDB(':memory:');
    runSchemaUpgrade(db);
    const row: MeshcoreMessageRowParams = {
      sender_id: 2,
      sender_name: null,
      payload: 'response',
      channel_idx: -1,
      timestamp: 1700000000000,
      local_order: 1700000000576001,
      status: 'acked',
      packet_id: null,
      emoji: null,
      reply_id: null,
      to_node: 1,
      received_via: 'rf',
      rx_packet_fingerprint: null,
      reply_preview_text: null,
      reply_preview_sender: null,
      rx_hops: null,
      room_server_id: null,
    };
    try {
      expect(persistMeshcoreMessage(db, row).changes).toBe(1);
      expect(
        persistMeshcoreMessage(db, { ...row, local_order: row.local_order! + 1 }).changes,
      ).toBe(1);
      expect(db.prepareOnce('SELECT channel_idx,local_order FROM meshcore_messages').all()).toEqual(
        [{ channel_idx: -1, local_order: row.local_order }],
      );
      const anonymousRow = { ...row, sender_id: null };
      expect(persistMeshcoreMessage(db, anonymousRow).changes).toBe(1);
      expect(persistMeshcoreMessage(db, { ...anonymousRow, rx_hops: 2 }).changes).toBe(1);
      expect(
        persistMeshcoreMessage(db, {
          ...anonymousRow,
          local_order: row.local_order! + 1,
          rx_hops: 3,
        }).changes,
      ).toBe(0);
      expect(
        db
          .prepareOnce('SELECT local_order,rx_hops FROM meshcore_messages WHERE sender_id IS NULL')
          .all(),
      ).toEqual([{ local_order: row.local_order, rx_hops: 2 }]);
    } finally {
      db.close();
    }
  });

  it('channel choices and channel loads use the same classification as persistence and clearing', () => {
    const { db, rows } = fixture();
    try {
      const classified = db
        .prepareOnce(
          `SELECT ${MESHCORE_MESSAGE_CHANNEL_SQL} AS channel FROM meshcore_messages ORDER BY id`,
        )
        .all() as { channel: number }[];
      expect(classified.map((row) => row.channel)).toEqual(
        rows.map((row) => meshcoreMessageChannelIndex(row.channel, row.to, row.room)),
      );
      expect(
        db
          .prepareOnce(
            `SELECT DISTINCT ${MESHCORE_MESSAGE_CHANNEL_SQL} AS channel FROM meshcore_messages ORDER BY channel`,
          )
          .all(),
      ).toEqual([{ channel: -2 }, { channel: -1 }, { channel: 0 }, { channel: 7 }]);
      expect(
        db
          .prepareOnce(
            `SELECT COUNT(*) AS n FROM meshcore_messages WHERE ${MESHCORE_MESSAGE_CHANNEL_SQL} = -1`,
          )
          .get(),
      ).toEqual({ n: 5 });
    } finally {
      db.close();
    }
  });
});
