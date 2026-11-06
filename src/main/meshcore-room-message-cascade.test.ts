// @vitest-environment node
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MESHCORE_CONTACT_TYPE_ROOM,
  MESHCORE_ROOM_MESSAGE_CHANNEL,
} from '../shared/meshcoreContactHwLabels';
import { MESHCORE_DM_MESSAGE_CHANNEL } from '../shared/meshcoreMessageChannel';
import {
  deleteMeshcoreContactOn,
  deleteMeshcoreContactsByAgeOn,
  deleteMeshcoreContactsNeverAdvertisedOn,
  deleteMeshcoreMessagesForRoomServerIds,
  deleteOrphanMeshcoreRoomMessagesOn,
  pruneMeshcoreContactsByCountOn,
} from './database';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';

const ROOM_PUBKEY = 'aa'.repeat(32);
const OTHER_PUBKEY = 'bb'.repeat(32);

describe('meshcore room message cascade SQL', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
    dir = undefined;
  });

  it('deletes room BBS rows for pruned room server ids and orphans', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-mc-room-cascade-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    db.prepareOnce(
      `INSERT INTO meshcore_contacts (node_id, public_key, contact_type, last_advert, favorited, on_radio)
       VALUES (?, ?, ?, ?, 0, 0)`,
    ).run(0x1001, ROOM_PUBKEY, MESHCORE_CONTACT_TYPE_ROOM, 1_700_000_000);
    db.prepareOnce(
      `INSERT INTO meshcore_contacts (node_id, public_key, contact_type, last_advert, favorited, on_radio)
       VALUES (?, ?, ?, ?, 0, 0)`,
    ).run(0x2002, OTHER_PUBKEY, 1, 1_700_000_000);

    const insertMsg = db.prepareOnce(
      `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, status, room_server_id)
       VALUES (?, ?, ?, ?, ?, 'acked', ?)`,
    );
    insertMsg.run(
      0x3003,
      'Alice',
      'hi room',
      MESHCORE_ROOM_MESSAGE_CHANNEL,
      1_700_000_100_000,
      0x1001,
    );
    insertMsg.run(
      0x3003,
      'Alice',
      'orphan',
      MESHCORE_ROOM_MESSAGE_CHANNEL,
      1_700_000_200_000,
      0x9999,
    );
    insertMsg.run(0x3003, 'Alice', 'channel', 0, 1_700_000_300_000, null);

    expect(deleteMeshcoreMessagesForRoomServerIds(db, [0x1001])).toBe(1);
    expect(
      (
        db
          .prepareOnce('SELECT COUNT(*) as c FROM meshcore_messages WHERE room_server_id = 0x1001')
          .get() as { c: number }
      ).c,
    ).toBe(0);

    db.prepareOnce('DELETE FROM meshcore_contacts WHERE node_id = 0x1001').run();
    expect(deleteOrphanMeshcoreRoomMessagesOn(db)).toBe(1);
    expect(
      (db.prepareOnce('SELECT COUNT(*) as c FROM meshcore_messages').get() as { c: number }).c,
    ).toBe(1);

    db.close();
  });

  it('deleteMeshcoreContactOn cascades room messages in one transaction', () => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-mc-contact-on-'));
    const db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);

    db.prepareOnce(
      `INSERT INTO meshcore_contacts (node_id, public_key, contact_type, last_advert, favorited, on_radio)
       VALUES (?, ?, ?, ?, 0, 0)`,
    ).run(0x1001, ROOM_PUBKEY, MESHCORE_CONTACT_TYPE_ROOM, 1_700_000_000);
    db.prepareOnce(
      `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, status, room_server_id)
       VALUES (?, ?, ?, ?, ?, 'acked', ?)`,
    ).run(0x3003, 'Alice', 'hi room', MESHCORE_ROOM_MESSAGE_CHANNEL, 1_700_000_100_000, 0x1001);

    expect(deleteMeshcoreContactOn(db, 0x1001).changes).toBe(1);
    expect(
      (db.prepareOnce('SELECT COUNT(*) as c FROM meshcore_contacts').get() as { c: number }).c,
    ).toBe(0);
    expect(
      (db.prepareOnce('SELECT COUNT(*) as c FROM meshcore_messages').get() as { c: number }).c,
    ).toBe(0);

    db.close();
  });

  describe('automatic prunes keep rooms that hold posts', () => {
    const ROOM_WITH_POSTS = 0x1001;
    const ROOM_WITHOUT_POSTS = 0x1002;
    // Older builds stored some room traffic the DM way: room_server_id NULL, the room as
    // to_node (our post) or sender_id (the room's post).
    const ROOM_WITH_DM_SHAPED_SEND = 0x1003;
    const ROOM_WITH_DM_SHAPED_RECEIVE = 0x1004;
    const CHAT_CONTACT = 0x2002;
    const CHAT_CONTACT_WITH_DM = 0x2003;
    const SELF_NODE = 0x3003;
    const KEPT = [ROOM_WITH_POSTS, ROOM_WITH_DM_SHAPED_SEND, ROOM_WITH_DM_SHAPED_RECEIVE];
    const PRUNED_COUNT = 3;
    const nowSec = Math.floor(Date.now() / 1000);
    const sixtyDaysAgo = nowSec - 60 * 86_400;

    function openDb(prefix: string, lastAdvert: number | null): NodeSqliteDB {
      dir = mkdtempSync(join(tmpdir(), prefix));
      const db = new NodeSqliteDB(join(dir, 'test.db'));
      db.pragma('journal_mode = WAL');
      runSchemaUpgrade(db);
      const insertContact = db.prepareOnce(
        `INSERT INTO meshcore_contacts (node_id, public_key, contact_type, last_advert, favorited, on_radio)
         VALUES (?, ?, ?, ?, 0, 0)`,
      );
      insertContact.run(ROOM_WITH_POSTS, ROOM_PUBKEY, MESHCORE_CONTACT_TYPE_ROOM, lastAdvert);
      insertContact.run(
        ROOM_WITHOUT_POSTS,
        'cc'.repeat(32),
        MESHCORE_CONTACT_TYPE_ROOM,
        lastAdvert,
      );
      insertContact.run(
        ROOM_WITH_DM_SHAPED_SEND,
        'dd'.repeat(32),
        MESHCORE_CONTACT_TYPE_ROOM,
        lastAdvert,
      );
      insertContact.run(
        ROOM_WITH_DM_SHAPED_RECEIVE,
        'ee'.repeat(32),
        MESHCORE_CONTACT_TYPE_ROOM,
        lastAdvert,
      );
      insertContact.run(CHAT_CONTACT, OTHER_PUBKEY, 1, lastAdvert);
      insertContact.run(CHAT_CONTACT_WITH_DM, 'ff'.repeat(32), 1, lastAdvert);
      const insertMessage = db.prepareOnce(
        `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, status, room_server_id, to_node)
         VALUES (?, ?, ?, ?, ?, 'acked', ?, ?)`,
      );
      insertMessage.run(
        SELF_NODE,
        'Alice',
        'hi room',
        MESHCORE_ROOM_MESSAGE_CHANNEL,
        1_700_000_100_000,
        ROOM_WITH_POSTS,
        null,
      );
      insertMessage.run(
        SELF_NODE,
        'Alice',
        'old post',
        MESHCORE_DM_MESSAGE_CHANNEL,
        1_700_000_200_000,
        null,
        ROOM_WITH_DM_SHAPED_SEND,
      );
      insertMessage.run(
        ROOM_WITH_DM_SHAPED_RECEIVE,
        'Bot',
        'old room stats',
        MESHCORE_DM_MESSAGE_CHANNEL,
        1_700_000_300_000,
        null,
        SELF_NODE,
      );
      insertMessage.run(
        CHAT_CONTACT_WITH_DM,
        'Bob',
        'hello',
        MESHCORE_DM_MESSAGE_CHANNEL,
        1_700_000_400_000,
        null,
        SELF_NODE,
      );
      return db;
    }

    function dmShapedRowCount(db: NodeSqliteDB): number {
      return (
        db
          .prepareOnce('SELECT COUNT(*) as c FROM meshcore_messages WHERE room_server_id IS NULL')
          .get() as { c: number }
      ).c;
    }

    function contactIds(db: NodeSqliteDB): number[] {
      return (
        db.prepareOnce('SELECT node_id FROM meshcore_contacts ORDER BY node_id').all() as {
          node_id: number;
        }[]
      ).map((r) => r.node_id);
    }

    function roomPostCount(db: NodeSqliteDB): number {
      return (
        db
          .prepareOnce('SELECT COUNT(*) as c FROM meshcore_messages WHERE room_server_id = ?')
          .get(ROOM_WITH_POSTS) as { c: number }
      ).c;
    }

    it('never-advertised prune', () => {
      const db = openDb('mesh-mc-prune-never-', null);
      expect(deleteMeshcoreContactsNeverAdvertisedOn(db)).toBe(PRUNED_COUNT);
      expect(contactIds(db)).toEqual(KEPT);
      expect(roomPostCount(db)).toBe(1);
      expect(dmShapedRowCount(db)).toBe(3);
      db.close();
    });

    it('age prune', () => {
      const db = openDb('mesh-mc-prune-age-', sixtyDaysAgo);
      expect(deleteMeshcoreContactsByAgeOn(db, 30)).toBe(PRUNED_COUNT);
      expect(contactIds(db)).toEqual(KEPT);
      expect(roomPostCount(db)).toBe(1);
      expect(dmShapedRowCount(db)).toBe(3);
      db.close();
    });

    it('count cap prune', () => {
      const db = openDb('mesh-mc-prune-cap-', sixtyDaysAgo);
      expect(pruneMeshcoreContactsByCountOn(db, 1)).toBe(PRUNED_COUNT);
      expect(contactIds(db)).toEqual(KEPT);
      expect(roomPostCount(db)).toBe(1);
      expect(dmShapedRowCount(db)).toBe(3);
      db.close();
    });
  });
});
