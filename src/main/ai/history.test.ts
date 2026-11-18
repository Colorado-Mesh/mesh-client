import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AiHistoryQuery } from '../../shared/ai-history';
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
    ).toEqual([{ at: 100, id: 1, sender: 'Unknown', senderId: null, body: 'WX: Morning report' }]);
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
    db.prepareOnce(
      'INSERT INTO rrc_messages (message_id,hub_hash,room,kind,body,timestamp,react_to) VALUES (?, ?, ?, ?, ?, 100, ?)',
    ).run('reaction', hub, 'lobby', 'msg', '👍', '1111111111111111');
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
      {
        protocol: 'meshcore',
        surface: 'channel',
        sinceMs: 0,
        untilMs: 1,
        channel: 0,
        byArrival: 1,
      },
    ])
      expect(() => validateHistoryQuery(value)).toThrow();
  });
});

// "Since last read" compares a read mark taken from arrival times, so the history it reads is
// bounded, ordered and paged by arrival too: a sender's clock can run behind or ahead of this one.
describe('AI history by arrival', () => {
  const peer = 'aa'.repeat(16);
  const hub = 'ab'.repeat(16);
  const surfaces: {
    name: string;
    insert: (body: string, timestamp: number, receivedAt: number | null) => void;
    query: Omit<AiHistoryQuery, 'sinceMs' | 'untilMs'>;
  }[] = [
    {
      name: 'Meshtastic channel',
      insert: (body, timestamp, receivedAt) =>
        db
          .prepareOnce(
            "INSERT INTO messages (sender_id,sender_name,payload,channel,timestamp,to_node,received_at) VALUES (2,'peer',?,0,?,4294967295,?)",
          )
          .run(body, timestamp, receivedAt),
      query: { protocol: 'meshtastic', surface: 'channel', channel: 0 },
    },
    {
      name: 'MeshCore channel',
      insert: (body, timestamp, receivedAt) =>
        db
          .prepareOnce(
            "INSERT INTO meshcore_messages (sender_id,sender_name,payload,channel_idx,timestamp,to_node,received_at) VALUES (2,'peer',?,0,?,4294967295,?)",
          )
          .run(body, timestamp, receivedAt),
      query: { protocol: 'meshcore', surface: 'channel', channel: 0 },
    },
    {
      name: 'Reticulum DM',
      insert: (body, timestamp, receivedAt) =>
        db
          .prepareOnce(
            "INSERT INTO reticulum_messages (identity_id,sender_id,to_hash,payload,timestamp,received_at) VALUES ('self',?,'own',?,?,?)",
          )
          .run(peer, body, timestamp, receivedAt),
      query: { protocol: 'reticulum', surface: 'dm', identityId: 'self', peerHash: peer },
    },
    {
      name: 'RRC room',
      insert: (body, timestamp, receivedAt) =>
        db
          .prepareOnce(
            "INSERT INTO rrc_messages (message_id,hub_hash,room,kind,body,timestamp,received_at) VALUES (?,?,'lobby','msg',?,?,?)",
          )
          .run(body, hub, body, timestamp, receivedAt),
      query: { protocol: 'reticulum', surface: 'rrc', hubHash: hub, room: 'lobby' },
    },
  ];

  it.each(surfaces)('bounds, orders and pages $name history by arrival', ({ insert, query }) => {
    insert('read, sender clock ahead', 900, 100);
    insert('saved before receipt times', 250, null);
    insert('unread, sender clock behind', 50, 300);
    const range = { ...query, sinceMs: 200, untilMs: 1_000 };

    expect(
      querySummaryHistory(db, { ...range, byArrival: true }, 1_000).map((m) => [
        m.body,
        m.at,
        m.order,
      ]),
    ).toEqual([
      ['saved before receipt times', 250, 250],
      ['unread, sender clock behind', 50, 300],
    ]);
    // Without the flag the range and order stay on the senders' clocks.
    expect(querySummaryHistory(db, range, 1_000).map((m) => m.body)).toEqual([
      'saved before receipt times',
      'read, sender clock ahead',
    ]);

    // A one-row page returns one extra row; the cursor then takes the arrival key.
    const page = querySummaryHistory(db, { ...range, byArrival: true, limit: 1 }, 1_000);
    expect(page.map((m) => m.body)).toEqual([
      'saved before receipt times',
      'unread, sender clock behind',
    ]);
    const newest = page[1];
    expect(
      querySummaryHistory(
        db,
        { ...range, byArrival: true, limit: 1, beforeAt: newest.order!, beforeId: newest.id! },
        1_000,
      ).map((m) => m.body),
    ).toEqual(['saved before receipt times']);
  });

  it('pages rows that share an arrival key by row id', () => {
    const meshcore = surfaces[1];
    meshcore.insert('first', 10, 400);
    meshcore.insert('second', 20, 400);
    const range = { ...meshcore.query, sinceMs: 0, untilMs: 1_000, byArrival: true, limit: 1 };
    const page = querySummaryHistory(db, range, 1_000);
    expect(page.map((m) => m.body)).toEqual(['first', 'second']);
    expect(
      querySummaryHistory(
        db,
        { ...range, beforeAt: page[1].order!, beforeId: page[1].id! },
        1_000,
      ).map((m) => m.body),
    ).toEqual(['first']);
  });
});
