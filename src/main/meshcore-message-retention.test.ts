// @vitest-environment node
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { MESHCORE_ROOM_MESSAGE_CHANNEL } from '../shared/meshcoreContactHwLabels';
import { MESHCORE_DM_MESSAGE_CHANNEL } from '../shared/meshcoreMessageChannel';
import { pruneMeshcoreMessagesByCountOn } from './database';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';

const SELF = 0x3003;
const ROOM = 0x1001;
const PEER = 0x2002;

interface Row {
  payload: string;
  timestamp: number;
  channelIdx: number | null;
  senderId?: number;
  toNode?: number | null;
  roomServerId?: number | null;
}

// Room posts are all older than every chat row: with one shared pool they would go first.
const ROWS: Row[] = [
  {
    payload: 'room 1',
    timestamp: 100,
    channelIdx: MESHCORE_ROOM_MESSAGE_CHANNEL,
    roomServerId: ROOM,
  },
  {
    payload: 'room 2',
    timestamp: 110,
    channelIdx: MESHCORE_ROOM_MESSAGE_CHANNEL,
    roomServerId: ROOM,
  },
  // Room channel with no room id: still a room post, as the Rooms view loads it.
  {
    payload: 'room 3',
    timestamp: 120,
    channelIdx: MESHCORE_ROOM_MESSAGE_CHANNEL,
    roomServerId: null,
  },
  {
    payload: 'room 4',
    timestamp: 130,
    channelIdx: MESHCORE_ROOM_MESSAGE_CHANNEL,
    roomServerId: ROOM,
  },
  {
    payload: 'room 5',
    timestamp: 140,
    channelIdx: MESHCORE_ROOM_MESSAGE_CHANNEL,
    roomServerId: ROOM,
  },
  // NULL channel_idx and no room id: a chat row, and the oldest one, so it must be pruned.
  { payload: 'null channel', timestamp: 200, channelIdx: null },
  // Stored the DM way by an older build: hydration loads it through the chat window.
  {
    payload: 'old room stats',
    timestamp: 210,
    channelIdx: MESHCORE_DM_MESSAGE_CHANNEL,
    senderId: ROOM,
    toNode: SELF,
  },
  { payload: 'dm in', timestamp: 220, channelIdx: MESHCORE_DM_MESSAGE_CHANNEL, toNode: SELF },
  { payload: 'public 1', timestamp: 230, channelIdx: 0 },
  { payload: 'public 2', timestamp: 240, channelIdx: 0 },
  {
    payload: 'dm out',
    timestamp: 250,
    channelIdx: MESHCORE_DM_MESSAGE_CHANNEL,
    senderId: SELF,
    toNode: PEER,
  },
  { payload: 'public 3', timestamp: 260, channelIdx: 0 },
];

describe('MeshCore message retention', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function openDb(prefix: string): NodeSqliteDB {
    dir = mkdtempSync(join(tmpdir(), prefix));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);
    const insert = db.prepareOnce(
      `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, status, to_node, room_server_id)
       VALUES (?, 'x', ?, ?, ?, 'acked', ?, ?)`,
    );
    for (const row of ROWS) {
      insert.run(
        row.senderId ?? PEER,
        row.payload,
        row.channelIdx,
        row.timestamp,
        row.toNode ?? null,
        row.roomServerId ?? null,
      );
    }
    return db;
  }

  function payloads(db: NodeSqliteDB): string[] {
    return (
      db.prepareOnce('SELECT payload FROM meshcore_messages ORDER BY timestamp').all() as {
        payload: string;
      }[]
    ).map((r) => r.payload);
  }

  it('keeps the newest rows of chat messages and of room posts separately', () => {
    const db = openDb('mesh-mc-retention-split-');
    expect(pruneMeshcoreMessagesByCountOn(db, 3)).toEqual({ chat: 4, room: 2 });
    expect(payloads(db)).toEqual(['room 3', 'room 4', 'room 5', 'public 2', 'dm out', 'public 3']);
    db.close();
  });

  it('prunes the row with no channel index and the DM-shaped room row as chat', () => {
    const db = openDb('mesh-mc-retention-null-');
    pruneMeshcoreMessagesByCountOn(db, 5);
    const kept = payloads(db);
    expect(kept).not.toContain('null channel');
    expect(kept).not.toContain('old room stats');
    expect(kept).toContain('dm in');
    expect(kept.filter((p) => p.startsWith('room '))).toHaveLength(5);
    db.close();
  });

  it('deletes nothing when both pools are under the cap', () => {
    const db = openDb('mesh-mc-retention-under-');
    expect(pruneMeshcoreMessagesByCountOn(db, 100)).toEqual({ chat: 0, room: 0 });
    expect(payloads(db)).toHaveLength(ROWS.length);
    db.close();
  });
});
