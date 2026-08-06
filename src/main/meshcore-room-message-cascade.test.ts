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
  deleteMeshcoreMessagesForRoomServerIds,
  deleteOrphanMeshcoreRoomMessagesOn,
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
});
