// @vitest-environment node
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  MESHCORE_CONTACT_TYPE_ROOM,
  MESHCORE_ROOM_MESSAGE_CHANNEL,
} from '../shared/meshcoreContactHwLabels';
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
    const CHAT_CONTACT = 0x2002;
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
      insertContact.run(CHAT_CONTACT, OTHER_PUBKEY, 1, lastAdvert);
      db.prepareOnce(
        `INSERT INTO meshcore_messages (sender_id, sender_name, payload, channel_idx, timestamp, status, room_server_id)
         VALUES (?, ?, ?, ?, ?, 'acked', ?)`,
      ).run(
        0x3003,
        'Alice',
        'hi room',
        MESHCORE_ROOM_MESSAGE_CHANNEL,
        1_700_000_100_000,
        ROOM_WITH_POSTS,
      );
      return db;
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
      expect(deleteMeshcoreContactsNeverAdvertisedOn(db)).toBe(2);
      expect(contactIds(db)).toEqual([ROOM_WITH_POSTS]);
      expect(roomPostCount(db)).toBe(1);
      db.close();
    });

    it('age prune', () => {
      const db = openDb('mesh-mc-prune-age-', sixtyDaysAgo);
      expect(deleteMeshcoreContactsByAgeOn(db, 30)).toBe(2);
      expect(contactIds(db)).toEqual([ROOM_WITH_POSTS]);
      expect(roomPostCount(db)).toBe(1);
      db.close();
    });

    it('count cap prune', () => {
      const db = openDb('mesh-mc-prune-cap-', sixtyDaysAgo);
      expect(pruneMeshcoreContactsByCountOn(db, 1)).toBe(2);
      expect(contactIds(db)).toEqual([ROOM_WITH_POSTS]);
      expect(roomPostCount(db)).toBe(1);
      db.close();
    });
  });
});
