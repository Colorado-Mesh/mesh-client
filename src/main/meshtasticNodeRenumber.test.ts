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

  it('moves DMs, favorite, and notes onto the new number and drops the old row', () => {
    insertNode(OLD, { publicKey: KEY, favorited: 1 });
    insertMessage(OLD, PEER, 1);
    insertMessage(PEER, OLD, 2);
    db!.prepare('INSERT INTO node_notes (node_id, notes) VALUES (?, ?)').run(OLD, 'note');

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
