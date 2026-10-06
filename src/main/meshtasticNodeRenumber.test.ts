import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { meshtasticNodeNumFromPublicKeyHex } from '../shared/meshtasticNodeNumFromPublicKey';
import { NodeSqliteDB } from './db-compat';
import { runSchemaUpgrade } from './db-schema-sync';
import {
  meshtasticNodePublicKeyHexOrNull,
  migrateMeshtasticNodeNumInDb,
} from './meshtasticNodeRenumber';

const KEY = 'ab'.repeat(32);
const OLD = 0x11111111;
const NEW = meshtasticNodeNumFromPublicKeyHex(KEY)!;
const PEER = 0x33333333;

describe('meshtasticNodePublicKeyHexOrNull', () => {
  it('normalizes valid keys and rejects malformed or zero keys', () => {
    expect(meshtasticNodePublicKeyHexOrNull(KEY.toUpperCase())).toBe(KEY);
    expect(meshtasticNodePublicKeyHexOrNull('0'.repeat(64))).toBeNull();
    expect(meshtasticNodePublicKeyHexOrNull('abc')).toBeNull();
    expect(meshtasticNodePublicKeyHexOrNull(undefined)).toBeNull();
  });
});

describe('migrateMeshtasticNodeNumInDb', () => {
  let dir: string | undefined;
  let db: NodeSqliteDB | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-renumber-'));
    db = new NodeSqliteDB(join(dir, 'test.db'));
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

  function insertNode(nodeId: number, opts: { publicKey?: string | null; favorited?: number }) {
    db!
      .prepare('INSERT INTO nodes (node_id, long_name, public_key, favorited) VALUES (?, ?, ?, ?)')
      .run(nodeId, `n${nodeId}`, opts.publicKey ?? null, opts.favorited ?? 0);
  }

  function insertMessage(senderId: number, toNode: number | null, packetId: number) {
    db!
      .prepare(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, packet_id, to_node)
         VALUES (?, 'x', 'hello', 0, ?, ?, ?)`,
      )
      .run(senderId, packetId, packetId, toNode);
  }

  it('rewrites radio_node_id so unkeyed channel rows stay with this radio', () => {
    insertNode(OLD, { publicKey: KEY });
    db!
      .prepare(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, packet_id, to_node, radio_node_id)
       VALUES (?, 'x', 'heard', 0, 1, 3, NULL, ?)`,
      )
      .run(PEER, OLD);
    db!
      .prepare(
        `INSERT INTO messages (sender_id, sender_name, payload, channel, timestamp, packet_id, to_node, radio_node_id)
       VALUES (?, 'x', 'other radio', 0, 2, 4, NULL, ?)`,
      )
      .run(PEER, PEER);

    expect(migrateMeshtasticNodeNumInDb(db!, OLD, NEW, KEY).migrated).toBe(true);
    expect(
      db!.prepare('SELECT payload, radio_node_id FROM messages ORDER BY packet_id').all(),
    ).toEqual([
      { payload: 'heard', radio_node_id: NEW },
      { payload: 'other radio', radio_node_id: PEER },
    ]);
  });

  it('moves DMs, favorite, and notes onto the new number and drops the old row', () => {
    insertNode(OLD, { publicKey: KEY, favorited: 1 });
    insertMessage(OLD, PEER, 1);
    insertMessage(PEER, OLD, 2);
    db!.prepare('INSERT INTO node_notes (node_id, notes) VALUES (?, ?)').run(OLD, 'note');
    db!
      .prepare(
        'INSERT INTO position_history (node_id, latitude, longitude, recorded_at) VALUES (?, ?, ?, ?)',
      )
      .run(OLD, 40, -105, 1);
    const groupId = Number(
      db!
        .prepare('INSERT INTO contact_groups (self_node_id, name) VALUES (?, ?)')
        .run(OLD, 'friends').lastInsertRowid,
    );
    db!
      .prepare('INSERT INTO contact_group_members (group_id, contact_node_id) VALUES (?, ?)')
      .run(groupId, OLD);

    const result = migrateMeshtasticNodeNumInDb(db!, OLD, NEW, KEY);

    expect(result).toEqual({ migrated: true, messagesUpdated: 2 });
    expect(db!.prepare('SELECT node_id, favorited FROM nodes').all()).toEqual([
      { node_id: NEW, favorited: 1 },
    ]);
    expect(db!.prepare('SELECT sender_id, to_node FROM messages ORDER BY packet_id').all()).toEqual(
      [
        { sender_id: NEW, to_node: PEER },
        { sender_id: PEER, to_node: NEW },
      ],
    );
    expect(db!.prepare('SELECT node_id FROM node_notes').all()).toEqual([{ node_id: NEW }]);
    expect(db!.prepare('SELECT node_id FROM position_history').all()).toEqual([{ node_id: NEW }]);
    expect(db!.prepare('SELECT self_node_id FROM contact_groups').all()).toEqual([
      { self_node_id: OLD },
    ]);
    expect(db!.prepare('SELECT contact_node_id FROM contact_group_members').all()).toEqual([
      { contact_node_id: OLD },
    ]);
  });

  it('leaves notes and positions when the node id is a MeshCore contact', () => {
    insertNode(OLD, { publicKey: KEY });
    db!
      .prepare('INSERT INTO meshcore_contacts (node_id, public_key) VALUES (?, ?)')
      .run(OLD, 'cd'.repeat(32));
    db!.prepare('INSERT INTO node_notes (node_id, notes) VALUES (?, ?)').run(OLD, 'shared');
    db!
      .prepare(
        'INSERT INTO position_history (node_id, latitude, longitude, recorded_at) VALUES (?, ?, ?, ?)',
      )
      .run(OLD, 1, 2, 3);

    expect(migrateMeshtasticNodeNumInDb(db!, OLD, NEW, KEY).migrated).toBe(true);
    expect(db!.prepare('SELECT node_id FROM node_notes').all()).toEqual([{ node_id: OLD }]);
    expect(db!.prepare('SELECT node_id FROM position_history').all()).toEqual([{ node_id: OLD }]);
    expect(db!.prepare('SELECT node_id FROM nodes').all()).toEqual([{ node_id: NEW }]);
  });

  it('does not retag notes or positions onto a MeshCore contact id', () => {
    insertNode(OLD, { publicKey: KEY });
    db!
      .prepare('INSERT INTO meshcore_contacts (node_id, public_key) VALUES (?, ?)')
      .run(NEW, 'ef'.repeat(32));
    db!.prepare('INSERT INTO node_notes (node_id, notes) VALUES (?, ?)').run(OLD, 'lora');
    db!
      .prepare(
        'INSERT INTO position_history (node_id, latitude, longitude, recorded_at) VALUES (?, ?, ?, ?)',
      )
      .run(OLD, 3, 4, 5);

    expect(migrateMeshtasticNodeNumInDb(db!, OLD, NEW, KEY).migrated).toBe(true);
    expect(db!.prepare('SELECT node_id FROM node_notes').all()).toEqual([{ node_id: OLD }]);
    expect(db!.prepare('SELECT node_id FROM position_history').all()).toEqual([{ node_id: OLD }]);
  });

  it('merges into an existing new-number row and drops duplicate packets', () => {
    insertNode(OLD, { publicKey: KEY, favorited: 1 });
    insertNode(NEW, { publicKey: null, favorited: 0 });
    insertMessage(OLD, PEER, 7);
    insertMessage(NEW, PEER, 7);

    expect(migrateMeshtasticNodeNumInDb(db!, OLD, NEW, KEY).migrated).toBe(true);
    expect(db!.prepare('SELECT node_id, favorited, public_key FROM nodes').all()).toEqual([
      { node_id: NEW, favorited: 1, public_key: KEY },
    ]);
    expect(db!.prepare('SELECT sender_id FROM messages').all()).toEqual([{ sender_id: NEW }]);
  });

  it('refuses when the stored key does not match or the inputs are invalid', () => {
    insertNode(OLD, { publicKey: 'cd'.repeat(32) });
    insertMessage(OLD, PEER, 1);
    expect(migrateMeshtasticNodeNumInDb(db!, OLD, NEW, KEY).migrated).toBe(false);
    expect(migrateMeshtasticNodeNumInDb(db!, OLD, OLD, 'cd'.repeat(32)).migrated).toBe(false);
    expect(migrateMeshtasticNodeNumInDb(db!, OLD, 0xffffffff, 'cd'.repeat(32)).migrated).toBe(
      false,
    );
    expect(migrateMeshtasticNodeNumInDb(db!, OLD, NEW, '0'.repeat(64)).migrated).toBe(false);
    db!.prepare('UPDATE nodes SET public_key = ? WHERE node_id = ?').run(KEY, OLD);
    expect(migrateMeshtasticNodeNumInDb(db!, OLD, NEW + 1, KEY).migrated).toBe(false);
    expect(db!.prepare('SELECT sender_id FROM messages').all()).toEqual([{ sender_id: OLD }]);
  });

  it('refuses when the new-number row already belongs to a different key', () => {
    insertNode(OLD, { publicKey: KEY });
    insertNode(NEW, { publicKey: 'cd'.repeat(32) });
    insertMessage(OLD, PEER, 1);
    expect(migrateMeshtasticNodeNumInDb(db!, OLD, NEW, KEY).migrated).toBe(false);
    expect(db!.prepare('SELECT node_id FROM nodes ORDER BY node_id').all()).toEqual([
      { node_id: OLD },
      { node_id: NEW },
    ]);
    expect(db!.prepare('SELECT sender_id FROM messages').all()).toEqual([{ sender_id: OLD }]);
  });

  it('rolls back every change when a step fails partway', () => {
    insertNode(OLD, { publicKey: KEY });
    insertMessage(OLD, PEER, 1);
    db!.prepare('INSERT INTO node_notes (node_id, notes) VALUES (?, ?)').run(OLD, 'old');
    db!.prepare('INSERT INTO node_notes (node_id, notes) VALUES (?, ?)').run(NEW, 'new');
    db!.execScript(`
      CREATE TRIGGER fail_notes BEFORE DELETE ON node_notes
      BEGIN SELECT RAISE(ABORT, 'boom'); END;
    `);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => migrateMeshtasticNodeNumInDb(db!, OLD, NEW, KEY)).toThrow(/boom/);
    expect(db!.prepare('SELECT sender_id FROM messages').all()).toEqual([{ sender_id: OLD }]);
    expect(db!.prepare('SELECT node_id FROM nodes').all()).toEqual([{ node_id: OLD }]);
    warn.mockRestore();
  });
});
