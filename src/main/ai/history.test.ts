import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeSqliteDB } from '../db-compat';
import { runSchemaUpgrade } from '../db-schema-sync';
import { querySummaryHistory, validateHistoryQuery } from './history';

let db: NodeSqliteDB;
beforeEach(() => {
  db = new NodeSqliteDB(':memory:');
  runSchemaUpgrade(db);
});
afterEach(() => {
  db.close();
});
describe('AI history conversation boundaries', () => {
  it('retains missing MeshCore sender identity for renderer display normalization', () => {
    db.prepareOnce(
      "INSERT INTO meshcore_messages (sender_id,sender_name,payload,channel_idx,timestamp) VALUES (NULL,NULL,'WX: Morning report',0,100)",
    ).run();
    expect(
      querySummaryHistory(db, {
        protocol: 'meshcore',
        surface: 'channel',
        channel: 0,
        sinceMs: 0,
        untilMs: 200,
      }),
    ).toEqual([{ at: 100, sender: 'Unknown', senderId: null, body: 'WX: Morning report' }]);
  });

  it.each(['meshtastic', 'meshcore'] as const)(
    'filters %s peer/channel/room before capping with inclusive range',
    (protocol) => {
      const table = protocol === 'meshtastic' ? 'messages' : 'meshcore_messages';
      const channel = protocol === 'meshtastic' ? 'channel' : 'channel_idx';
      for (const [sender, to, at, text] of [
        [1, 2, 100, 'out'],
        [2, 1, 200, 'in'],
        [3, 1, 200, 'unrelated'],
        [2, 1, 300, 'outside'],
      ] as const)
        db.prepareOnce(
          `INSERT INTO ${table} (sender_id,sender_name,payload,${channel},timestamp,to_node) VALUES (?, 'peer', ?, 0, ?, ?)`,
        ).run(sender, text, at, to);
      const rows = querySummaryHistory(db, {
        protocol,
        surface: 'dm',
        sinceMs: 100,
        untilMs: 200,
        peerId: 2,
        ownNodeIds: [1],
      });
      expect(rows.map((m) => m.body)).toEqual(['out', 'in']);
      expect(rows.map((m) => m.senderId)).toEqual([1, 2]);
      expect(
        querySummaryHistory(db, {
          protocol,
          surface: 'channel',
          channel: 0,
          sinceMs: 0,
          untilMs: 400,
        }),
      ).toEqual([]);
      expect(() =>
        querySummaryHistory(db, { protocol, surface: 'dm', peerId: 2, sinceMs: 0, untilMs: 400 }),
      ).toThrow();
    },
  );
  it.each(['meshtastic', 'meshcore'] as const)(
    'includes %s broadcasts, remapped channel keys and only matching legacy radio rows',
    (protocol) => {
      const table = protocol === 'meshtastic' ? 'messages' : 'meshcore_messages';
      const column = protocol === 'meshtastic' ? 'channel' : 'channel_idx';
      for (const [slot, key, radio, to, text] of [
        [3, 'same', 99, 4294967295, 'keyed old slot'],
        [0, null, 1, 4294967295, 'legacy same radio'],
        [0, null, 2, 0, 'wrong radio'],
        [0, 'different', 1, 0, 'different key'],
        [0, null, null, 0, 'legacy null'],
      ] as const)
        db.prepareOnce(
          `INSERT INTO ${table} (payload,timestamp,${column},channel_key,radio_node_id,to_node) VALUES (?,100,?,?,?,?)`,
        ).run(text, slot, key, radio, to);
      expect(
        querySummaryHistory(db, {
          protocol,
          surface: 'channel',
          channel: 0,
          channelKey: 'same',
          radioNodeId: 1,
          sinceMs: 0,
          untilMs: 200,
        }).map((m) => m.body),
      ).toEqual(['keyed old slot', 'legacy same radio', 'legacy null']);
    },
  );
  it('scopes MeshCore rooms and normalizes skew before filtering', () => {
    db.prepareOnce(
      'INSERT INTO meshcore_messages (payload,timestamp,room_server_id) VALUES (?, ?, ?)',
    ).run('room', 9999999999999, 5);
    db.prepareOnce(
      'INSERT INTO meshcore_messages (payload,timestamp,room_server_id) VALUES (?, ?, ?)',
    ).run('other', 100, 6);
    expect(
      querySummaryHistory(
        db,
        { protocol: 'meshcore', surface: 'room', roomServerId: 5, sinceMs: 100, untilMs: 200 },
        150,
      ),
    ).toMatchObject([{ body: 'room', at: 150 }]);
    expect(
      db.prepareOnce("SELECT name FROM sqlite_master WHERE name='idx_mc_msgs_room_ts'").get(),
    ).toBeTruthy();
  });
  it('includes legacy MeshCore inbound DM sentinels and room peer rows', () => {
    db.prepareOnce(
      "INSERT INTO meshcore_messages (sender_id,to_node,channel_idx,payload,timestamp) VALUES (2,0,-1,'legacy DM',100)",
    ).run();
    db.prepareOnce(
      "INSERT INTO meshcore_messages (sender_id,to_node,channel_idx,payload,timestamp) VALUES (5,1,-1,'legacy room',100)",
    ).run();
    expect(
      querySummaryHistory(db, {
        protocol: 'meshcore',
        surface: 'dm',
        peerId: 2,
        ownNodeIds: [1],
        sinceMs: 0,
        untilMs: 200,
      }),
    ).toMatchObject([{ body: 'legacy DM' }]);
    expect(
      querySummaryHistory(db, {
        protocol: 'meshcore',
        surface: 'room',
        roomServerId: 5,
        sinceMs: 0,
        untilMs: 200,
      }),
    ).toMatchObject([{ body: 'legacy room' }]);
  });
  it('scopes Reticulum identity and peer before limit', () => {
    const peer = 'aa'.repeat(16);
    for (const [identity, sender, to, body] of [
      ['self', peer, 'own', 'in'],
      ['self', 'own', peer, 'out'],
      ['other', peer, 'own', 'wrong identity'],
      ['self', 'bb'.repeat(16), 'own', 'other peer'],
    ])
      db.prepareOnce(
        'INSERT INTO reticulum_messages (identity_id,sender_id,to_hash,payload,timestamp) VALUES (?, ?, ?, ?, 100)',
      ).run(identity, sender, to, body);
    expect(
      querySummaryHistory(db, {
        protocol: 'reticulum',
        surface: 'dm',
        identityId: 'self',
        peerHash: peer,
        sinceMs: 100,
        untilMs: 100,
      }).map((m) => m.body),
    ).toEqual(['in', 'out']);
  });
  it('normalizes RRC rooms and excludes notices and other hubs', () => {
    const hub = 'ab'.repeat(16);
    for (const [room, kind, body] of [
      ['lobby', 'msg', 'chat'],
      ['lobby', 'notice', 'system'],
      ['other', 'msg', 'other'],
    ])
      db.prepareOnce(
        'INSERT INTO rrc_messages (message_id,hub_hash,room,kind,body,timestamp) VALUES (?, ?, ?, ?, ?, 100)',
      ).run(body, hub, room, kind, body);
    expect(
      querySummaryHistory(db, {
        protocol: 'reticulum',
        surface: 'rrc',
        hubHash: hub,
        room: '#Lobby',
        sinceMs: 100,
        untilMs: 100,
      }),
    ).toMatchObject([{ body: 'chat' }]);
  });
  it('validates malformed IPC arguments', () => {
    for (const value of [
      {},
      null,
      { protocol: 'meshcore', surface: 'dm', sinceMs: NaN, untilMs: 1 },
      { protocol: 'meshcore', surface: 'channel', sinceMs: 0, untilMs: 1, channel: -1 },
    ])
      expect(() => validateHistoryQuery(value)).toThrow();
  });
});
