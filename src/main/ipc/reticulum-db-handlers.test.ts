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
import { registerReticulumDbIpcHandlers } from './reticulum-db-handlers';

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const getDbForIpcMock = vi.mocked(getDbForIpc);

describe('reticulum-db-handlers validation', () => {
  const handlers = new Map<string, IpcHandler>();
  const event = {} as IpcMainInvokeEvent;

  beforeAll(() => {
    registerReticulumDbIpcHandlers({
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
    expect(handlers.has('db:getReticulumMessages')).toBe(true);
    expect(handlers.has('db:saveReticulumMessage')).toBe(true);
    expect(handlers.has('db:searchReticulumMessages')).toBe(true);
    expect(handlers.has('db:clearReticulumContactDestinations')).toBe(true);
    expect(handlers.has('db:deleteReticulumDestinationsByAge')).toBe(true);
    expect(handlers.has('db:pruneReticulumDestinationsByCount')).toBe(true);
    expect(handlers.has('db:pruneReticulumIdentityActivityByAge')).toBe(true);
    expect(handlers.has('db:upsertReticulumIdentityActivityBatch')).toBe(true);
  });

  it('db:getReticulumMessages rejects oversized identityId', () => {
    const handler = handlers.get('db:getReticulumMessages');
    expect(handler?.(event, 'x'.repeat(200))).toEqual([]);
  });

  it('db:saveReticulumMessage rejects invalid payload', () => {
    const handler = handlers.get('db:saveReticulumMessage');
    expect(() =>
      handler?.(event, {
        identity_id: 'id-1',
        sender_id: 'sender',
        payload: 'x'.repeat(70000),
        timestamp: Date.now(),
      }),
    ).toThrow('payload invalid');
  });

  it('db:saveReticulumMessage returns no-op when database is unavailable', () => {
    const handler = handlers.get('db:saveReticulumMessage');
    expect(
      handler?.(event, {
        identity_id: 'id-1',
        sender_id: 'sender',
        payload: 'hello',
        timestamp: Date.now(),
        delivery_status: 'not-a-status',
      }),
    ).toEqual({ changes: 0 });
  });

  it('db:searchReticulumMessages clamps limit', () => {
    const handler = handlers.get('db:searchReticulumMessages');
    expect(handler?.(event, 'id-1', 'query', 999999)).toEqual([]);
  });
});

describe('reticulum-db-handlers SQL contracts', () => {
  it('preserves custom display names over hash-prefix aliases with case-insensitive guard', async () => {
    const { readFileSync } = await import('fs');
    const { join: pathJoin } = await import('path');
    const source = readFileSync(pathJoin(__dirname, 'reticulum-db-handlers.ts'), 'utf-8');
    expect(source).toContain('LOWER(excluded.display_name)');
    expect(source).toContain('LOWER(substr(reticulum_destinations.destination_hash, 1, 12))');
    expect(source).toContain('.replace(/[\\r\\n]+/g');
    // Age prune must use Unix-seconds cutoff (destinations store seconds, not ms).
    expect(source).toMatch(
      /deleteReticulumDestinationsByAge[\s\S]*?Math\.floor\(Date\.now\(\) \/ 1000\) - safeDays \* 86_400/,
    );
  });
});

describe('reticulum destination / activity prune IPC', () => {
  const handlers = new Map<string, IpcHandler>();
  const event = {} as IpcMainInvokeEvent;
  let dir: string | undefined;
  let db: NodeSqliteDB | undefined;

  beforeAll(() => {
    registerReticulumDbIpcHandlers({
      ipcMain: {
        handle(channel: string, fn: IpcHandler) {
          handlers.set(channel, fn);
        },
      } as unknown as IpcMain,
    });
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-rns-prune-'));
    db = new NodeSqliteDB(join(dir, 'test.db'));
    db.pragma('journal_mode = WAL');
    runSchemaUpgrade(db);
    getDbForIpcMock.mockReturnValue(db);
  });

  afterEach(() => {
    db?.close();
    db = undefined;
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
    getDbForIpcMock.mockReturnValue(null);
  });

  function insertDestination(hash: string, lastHeardSec: number | null, favorited = 0): void {
    db!
      .prepareOnce(
        `INSERT INTO reticulum_destinations (destination_hash, display_name, last_heard, favorited)
         VALUES (?, ?, ?, ?)`,
      )
      .run(hash, `Peer ${hash.slice(0, 4)}`, lastHeardSec, favorited);
  }

  it('deleteReticulumDestinationsByAge uses Unix-seconds cutoff and keeps favorites', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    insertDestination('aa'.repeat(16), nowSec - 86_400); // 1 day ago — keep
    insertDestination('bb'.repeat(16), nowSec - 40 * 86_400); // 40 days — prune
    insertDestination('cc'.repeat(16), nowSec - 40 * 86_400, 1); // favorited stale — keep
    insertDestination('dd'.repeat(16), null); // no last_heard — keep

    const result = handlers.get('db:deleteReticulumDestinationsByAge')?.(event, 30) as {
      changes: number;
    };
    expect(result.changes).toBe(1);
    const remaining = db!
      .prepareOnce('SELECT destination_hash FROM reticulum_destinations ORDER BY destination_hash')
      .all() as { destination_hash: string }[];
    expect(remaining.map((r) => r.destination_hash)).toEqual([
      'aa'.repeat(16),
      'cc'.repeat(16),
      'dd'.repeat(16),
    ]);
  });

  it('deleteReticulumDestinationsByAge defaults invalid days to 30', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    insertDestination('ee'.repeat(16), nowSec - 40 * 86_400);
    const result = handlers.get('db:deleteReticulumDestinationsByAge')?.(event, -5) as {
      changes: number;
    };
    expect(result.changes).toBe(1);
  });

  it('pruneReticulumDestinationsByCount deletes oldest non-favorited with last_heard', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    insertDestination('11'.repeat(16), nowSec - 300);
    insertDestination('22'.repeat(16), nowSec - 200);
    insertDestination('33'.repeat(16), nowSec - 100);
    insertDestination('44'.repeat(16), nowSec - 50, 1);

    const result = handlers.get('db:pruneReticulumDestinationsByCount')?.(event, 2) as {
      changes: number;
    };
    // total=4, max=2 → need to delete 2; favorited preserved; oldest non-fav deleted
    expect(result.changes).toBe(2);
    const remaining = db!
      .prepareOnce('SELECT destination_hash FROM reticulum_destinations ORDER BY destination_hash')
      .all() as { destination_hash: string }[];
    expect(remaining.map((r) => r.destination_hash)).toEqual(['33'.repeat(16), '44'.repeat(16)]);
  });

  it('pruneReticulumDestinationsByCount no-ops when under cap', () => {
    insertDestination('55'.repeat(16), Math.floor(Date.now() / 1000));
    const result = handlers.get('db:pruneReticulumDestinationsByCount')?.(event, 10_000) as {
      changes: number;
    };
    expect(result.changes).toBe(0);
  });

  it('pruneReticulumIdentityActivityByAge deletes stale millisecond last_seen rows', () => {
    const nowMs = Date.now();
    db!
      .prepareOnce(
        `INSERT INTO reticulum_identity_activity (destination_hash, aspect, identity_hash, last_seen, hops)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('aa'.repeat(16), 'lxmf.delivery', null, nowMs - 86_400_000, 1);
    db!
      .prepareOnce(
        `INSERT INTO reticulum_identity_activity (destination_hash, aspect, identity_hash, last_seen, hops)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('bb'.repeat(16), 'lxmf.delivery', null, nowMs - 40 * 86_400_000, 2);

    const result = handlers.get('db:pruneReticulumIdentityActivityByAge')?.(event, 30) as {
      changes: number;
    };
    expect(result.changes).toBe(1);
    const remaining = db!
      .prepareOnce('SELECT destination_hash FROM reticulum_identity_activity')
      .all() as { destination_hash: string }[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.destination_hash).toBe('aa'.repeat(16));
  });

  it('upsertReticulumIdentityActivityBatch caps at 500 and skips invalid rows', () => {
    const rows = Array.from({ length: 510 }, (_, i) => ({
      destination_hash: i % 2 === 0 ? `h${i.toString(16).padStart(32, '0')}` : null,
      aspect: 'lxmf.delivery',
      last_seen: Date.now(),
      hops: 1,
    }));
    const result = handlers.get('db:upsertReticulumIdentityActivityBatch')?.(event, rows) as {
      changes: number;
    };
    // First 500 rows inspected; ~250 valid (even indices)
    expect(result.changes).toBe(250);
    const count = (
      db!.prepareOnce('SELECT COUNT(*) as cnt FROM reticulum_identity_activity').get() as {
        cnt: number;
      }
    ).cnt;
    expect(count).toBe(250);
  });
});
