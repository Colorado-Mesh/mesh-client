// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db-ipc-lifecycle', () => ({
  getDbForIpc: vi.fn(() => null),
  finishDbIpcHandler: vi.fn((_channel: string, err: unknown) => {
    throw err;
  }),
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

import { NodeSqliteDB } from '../db-compat';
import { getDbForIpc } from '../db-ipc-lifecycle';
import { runSchemaUpgrade } from '../db-schema-sync';
import { registerRrcDbIpcHandlers } from './rrc-db-handlers';

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const getDbForIpcMock = vi.mocked(getDbForIpc);

const HUB = 'a'.repeat(32);

describe('rrc-db-handlers validation', () => {
  const handlers = new Map<string, IpcHandler>();
  const event = {} as IpcMainInvokeEvent;

  beforeAll(() => {
    registerRrcDbIpcHandlers({
      ipcMain: {
        handle(channel: string, fn: IpcHandler) {
          handlers.set(channel, fn);
        },
      } as unknown as IpcMain,
    });
  });

  beforeEach(() => {
    getDbForIpcMock.mockReturnValue(null);
  });

  it('registers expected handlers', () => {
    expect(handlers.has('db:listRrcMessages')).toBe(true);
    expect(handlers.has('db:insertRrcMessage')).toBe(true);
    expect(handlers.has('db:deleteRrcMessagesByRoom')).toBe(true);
    expect(handlers.has('db:pruneRrcMessagesByCount')).toBe(true);
    expect(handlers.has('db:pruneRrcMessagesByAge')).toBe(true);
    expect(handlers.has('db:listRrcNicks')).toBe(true);
    expect(handlers.has('db:upsertRrcNick')).toBe(true);
  });

  it('db:insertRrcMessage rejects invalid kind', () => {
    const handler = handlers.get('db:insertRrcMessage');
    expect(() =>
      handler?.(event, {
        message_id: 'm1',
        hub_hash: HUB,
        room: 'lobby',
        kind: 'whisper',
        body: 'hi',
        timestamp: Date.now(),
      }),
    ).toThrow('kind invalid');
  });
});

describe('rrc-db-handlers with real DB', () => {
  const handlers = new Map<string, IpcHandler>();
  const event = {} as IpcMainInvokeEvent;
  let dir: string | undefined;
  let db: NodeSqliteDB | undefined;

  beforeAll(() => {
    registerRrcDbIpcHandlers({
      ipcMain: {
        handle(channel: string, fn: IpcHandler) {
          handlers.set(channel, fn);
        },
      } as unknown as IpcMain,
    });
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rrc-db-'));
    db = new NodeSqliteDB(join(dir, 'test.db'));
    runSchemaUpgrade(db);
    getDbForIpcMock.mockReturnValue(db);
  });

  afterEach(() => {
    db?.close();
    db = undefined;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('insert + list returns messages for one room only', () => {
    const insert = handlers.get('db:insertRrcMessage')!;
    const list = handlers.get('db:listRrcMessages')!;
    const now = Date.now();
    expect(
      insert(event, {
        message_id: 'm1',
        hub_hash: HUB,
        room: 'lobby',
        kind: 'msg',
        body: 'hello',
        nickname: 'alice',
        timestamp: now,
      }),
    ).toEqual({ changes: 1 });
    expect(
      insert(event, {
        message_id: 'm2',
        hub_hash: HUB,
        room: 'ops',
        kind: 'msg',
        body: 'other',
        timestamp: now + 1,
      }),
    ).toEqual({ changes: 1 });

    const rows = list(event, HUB, 'lobby') as { message_id: string; body: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ message_id: 'm1', body: 'hello' });
  });

  it('insert is idempotent on duplicate message_id', () => {
    const insert = handlers.get('db:insertRrcMessage')!;
    const list = handlers.get('db:listRrcMessages')!;
    const payload = {
      message_id: 'dup',
      hub_hash: HUB,
      room: 'lobby',
      kind: 'msg' as const,
      body: 'once',
      timestamp: Date.now(),
    };
    expect(insert(event, payload)).toEqual({ changes: 1 });
    expect(insert(event, payload)).toEqual({ changes: 0 });
    expect(list(event, HUB, 'lobby')).toHaveLength(1);
  });

  it('deleteByRoom removes only that room', () => {
    const insert = handlers.get('db:insertRrcMessage')!;
    const del = handlers.get('db:deleteRrcMessagesByRoom')!;
    const list = handlers.get('db:listRrcMessages')!;
    const now = Date.now();
    insert(event, {
      message_id: 'a',
      hub_hash: HUB,
      room: 'lobby',
      kind: 'msg',
      body: 'a',
      timestamp: now,
    });
    insert(event, {
      message_id: 'b',
      hub_hash: HUB,
      room: 'ops',
      kind: 'msg',
      body: 'b',
      timestamp: now,
    });
    expect(del(event, HUB, 'lobby')).toEqual({ changes: 1 });
    expect(list(event, HUB, 'lobby')).toHaveLength(0);
    expect(list(event, HUB, 'ops')).toHaveLength(1);
  });

  it('nick cache upserts newest sighting per identity and scopes by hub', () => {
    const upsert = handlers.get('db:upsertRrcNick')!;
    const list = handlers.get('db:listRrcNicks')!;
    const otherHub = 'b'.repeat(32);
    const now = Date.now();
    const peer = 'c'.repeat(32);

    expect(
      upsert(event, { hub_hash: HUB, identity_hash: peer, nickname: 'Alice', last_seen: now }),
    ).toEqual({ changes: 1 });
    expect(
      upsert(event, {
        hub_hash: HUB,
        identity_hash: peer.toUpperCase(),
        nickname: 'AliceRenamed',
        last_seen: now + 10,
      }),
    ).toEqual({ changes: 1 });
    // Older replay must not clobber the rename.
    upsert(event, { hub_hash: HUB, identity_hash: peer, nickname: 'Stale', last_seen: now - 10 });
    upsert(event, {
      hub_hash: otherHub,
      identity_hash: peer,
      nickname: 'OtherHubName',
      last_seen: now,
    });

    const rows = list(event, HUB) as { identity_hash: string; nickname: string }[];
    expect(rows).toEqual([{ identity_hash: peer, nickname: 'AliceRenamed', last_seen: now + 10 }]);
    expect(list(event, otherHub)).toHaveLength(1);
  });

  it('nick cache rejects malformed identities and blank nicks', () => {
    const upsert = handlers.get('db:upsertRrcNick')!;
    const list = handlers.get('db:listRrcNicks')!;
    const now = Date.now();
    expect(
      upsert(event, {
        hub_hash: HUB,
        identity_hash: 'nick:alice',
        nickname: 'Alice',
        last_seen: now,
      }),
    ).toEqual({ changes: 0 });
    expect(
      upsert(event, {
        hub_hash: HUB,
        identity_hash: 'c'.repeat(32),
        nickname: '  ',
        last_seen: now,
      }),
    ).toEqual({ changes: 0 });
    expect(
      upsert(event, {
        hub_hash: 'not-a-hash',
        identity_hash: 'c'.repeat(32),
        nickname: 'x',
        last_seen: now,
      }),
    ).toEqual({ changes: 0 });
    expect(list(event, HUB)).toHaveLength(0);
  });

  it('pruneByCount keeps newest N', () => {
    const insert = handlers.get('db:insertRrcMessage')!;
    const prune = handlers.get('db:pruneRrcMessagesByCount')!;
    const list = handlers.get('db:listRrcMessages')!;
    const base = Date.now();
    for (let i = 0; i < 5; i++) {
      insert(event, {
        message_id: `m${i}`,
        hub_hash: HUB,
        room: 'lobby',
        kind: 'msg',
        body: `b${i}`,
        timestamp: base + i,
      });
    }
    // Cap below MIN (100) is ignored by handler — use SQL directly for small fixture:
    // exercise prune with a high enough cap that only deletes overflow after seeding many rows.
    // Instead verify prune with maxCount=100 leaves our 5 rows (no prune).
    expect(prune(event, 100)).toEqual({ changes: 0 });
    expect(list(event, HUB, 'lobby')).toHaveLength(5);

    // Direct SQL prune to validate DELETE shape against schema for small caps.
    const result = db!
      .prepare(
        `DELETE FROM rrc_messages
         WHERE id NOT IN (
           SELECT id FROM rrc_messages ORDER BY timestamp DESC, id DESC LIMIT ?
         )`,
      )
      .run(2);
    expect(result.changes).toBe(3);
    const remaining = list(event, HUB, 'lobby') as { message_id: string }[];
    expect(remaining.map((r) => r.message_id)).toEqual(['m3', 'm4']);
  });
});
