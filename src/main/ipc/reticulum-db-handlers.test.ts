// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { testUserDataDir } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- vi.hoisted runs before ESM imports for electron mock
  const fs = require('node:fs') as {
    mkdtempSync: (prefix: string) => string;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
  const os = require('node:os') as { tmpdir: () => string };
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
  const path = require('node:path') as { join: (...parts: string[]) => string };
  return { testUserDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-rns-db-')) };
});

vi.mock('electron', () => ({
  app: {
    getPath: () => testUserDataDir,
  },
}));

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
import { getReticulumAttachmentsDir } from '../reticulum-attachment-path';
import {
  BLOCKED_CONTACTS_IMPORT_MAX,
  registerReticulumDbIpcHandlers,
} from './reticulum-db-handlers';

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const getDbForIpcMock = vi.mocked(getDbForIpc);

afterAll(() => {
  rmSync(testUserDataDir, { recursive: true, force: true });
});

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
    expect(handlers.has('db:listReticulumRemoteAddresses')).toBe(true);
    expect(handlers.has('db:upsertReticulumRemoteAddress')).toBe(true);
    expect(handlers.has('db:deleteReticulumRemoteAddress')).toBe(true);
    expect(handlers.has('db:listReticulumInboundPolicy')).toBe(true);
    expect(handlers.has('db:upsertReticulumInboundPolicy')).toBe(true);
    expect(handlers.has('db:deleteReticulumInboundPolicy')).toBe(true);
    expect(handlers.has('db:getBlockedContacts')).toBe(true);
    expect(handlers.has('db:blockContact')).toBe(true);
    expect(handlers.has('db:unblockContact')).toBe(true);
    expect(handlers.has('db:exportBlockedContacts')).toBe(true);
    expect(handlers.has('db:importBlockedContacts')).toBe(true);
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
    expect(source).toContain('canonicalizeReticulumDestinationHash(rawHash)');
    expect(source).toContain('WHEN ? = 1 THEN excluded.favorited');
    expect(source).toContain('WHEN ? = 1 THEN excluded.is_contact');
    // Age prune must use Unix-seconds cutoff (destinations store seconds, not ms).
    expect(source).toMatch(
      /deleteReticulumDestinationsByAge[\s\S]*?Math\.floor\(Date\.now\(\) \/ 1000\) - safeDays \* 86_400/,
    );
    expect(source).toMatch(
      /deleteReticulumDestinationsByAge[\s\S]*?is_contact IS NULL OR is_contact = 0/,
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

  it('saveReticulumMessage does not demote delivered to sending', () => {
    const identityId = 'id-rt-status';
    const messageHash = 'ab'.repeat(32);
    const save = handlers.get('db:saveReticulumMessage');
    save?.(event, {
      identity_id: identityId,
      sender_id: 'cc'.repeat(16),
      sender_name: 'Me',
      payload: 'hello',
      timestamp: 1_700_000_000_000,
      message_hash: messageHash,
      delivery_status: 'delivered',
    });
    save?.(event, {
      identity_id: identityId,
      sender_id: 'cc'.repeat(16),
      sender_name: 'Me',
      payload: 'hello',
      timestamp: 1_700_000_000_000,
      message_hash: messageHash,
      delivery_status: 'sending',
    });
    const row = db!
      .prepareOnce(
        'SELECT delivery_status FROM reticulum_messages WHERE identity_id = ? AND message_hash = ?',
      )
      .get(identityId, messageHash) as { delivery_status: string };
    expect(row.delivery_status).toBe('delivered');
  });

  it('saveReticulumMessage still allows failed → sending on retry', () => {
    const identityId = 'id-rt-retry';
    const messageHash = 'cd'.repeat(32);
    const save = handlers.get('db:saveReticulumMessage');
    save?.(event, {
      identity_id: identityId,
      sender_id: 'cc'.repeat(16),
      sender_name: 'Me',
      payload: 'retry',
      timestamp: 1_700_000_000_000,
      message_hash: messageHash,
      delivery_status: 'failed',
    });
    save?.(event, {
      identity_id: identityId,
      sender_id: 'cc'.repeat(16),
      sender_name: 'Me',
      payload: 'retry',
      timestamp: 1_700_000_000_000,
      message_hash: messageHash,
      delivery_status: 'sending',
    });
    const row = db!
      .prepareOnce(
        'SELECT delivery_status FROM reticulum_messages WHERE identity_id = ? AND message_hash = ?',
      )
      .get(identityId, messageHash) as { delivery_status: string };
    expect(row.delivery_status).toBe('sending');
  });

  it('saveReticulumMessage coalesces attachment_path onto an existing Completes row', () => {
    const identityId = 'id-rt-attach-coalesce';
    const messageHash = 'a1'.repeat(32);
    const save = handlers.get('db:saveReticulumMessage');
    save?.(event, {
      identity_id: identityId,
      sender_id: 'cc'.repeat(16),
      sender_name: 'Me',
      payload: '[voice:600]',
      timestamp: 1_700_000_000_000,
      message_hash: messageHash,
      delivery_status: 'delivered',
    });
    const attachmentPath = join(getReticulumAttachmentsDir(), 'voice-memo-out.ogg');
    mkdirSync(getReticulumAttachmentsDir(), { recursive: true });
    writeFileSync(attachmentPath, Buffer.from('OggS'));
    save?.(event, {
      identity_id: identityId,
      sender_id: 'cc'.repeat(16),
      sender_name: 'Me',
      payload: '[voice:600]',
      timestamp: 1_700_000_000_000,
      message_hash: messageHash,
      delivery_status: 'sending',
      attachment_path: attachmentPath,
    });
    const row = db!
      .prepareOnce(
        'SELECT delivery_status, attachment_path FROM reticulum_messages WHERE identity_id = ? AND message_hash = ?',
      )
      .get(identityId, messageHash) as { delivery_status: string; attachment_path: string | null };
    expect(row.delivery_status).toBe('delivered');
    expect(row.attachment_path).toBe(resolve(attachmentPath));
  });

  it('saveReticulumMessage persists audio_mode and audio_duration_sec', () => {
    const identityId = 'id-rt-audio-meta';
    const messageHash = 'b2'.repeat(32);
    const save = handlers.get('db:saveReticulumMessage');
    const attachmentPath = join(getReticulumAttachmentsDir(), 'voice-memo-meta.ogg');
    mkdirSync(getReticulumAttachmentsDir(), { recursive: true });
    writeFileSync(attachmentPath, Buffer.from('OggS'));
    save?.(event, {
      identity_id: identityId,
      sender_id: 'cc'.repeat(16),
      sender_name: 'Me',
      payload: '[voice:600]',
      timestamp: 1_700_000_000_000,
      message_hash: messageHash,
      delivery_status: 'sending',
      attachment_path: attachmentPath,
      audio_mode: 16,
      audio_duration_sec: 1.25,
    });
    const row = db!
      .prepareOnce(
        'SELECT attachment_path, audio_mode, audio_duration_sec FROM reticulum_messages WHERE identity_id = ? AND message_hash = ?',
      )
      .get(identityId, messageHash) as {
      attachment_path: string | null;
      audio_mode: number | null;
      audio_duration_sec: number | null;
    };
    expect(row.attachment_path).toBe(resolve(attachmentPath));
    expect(row.audio_mode).toBe(16);
    expect(row.audio_duration_sec).toBe(1.25);
  });

  it('saveReticulumMessage replaces exact pending hash while still sending', () => {
    const identityId = 'id-rt-pending-orphan';
    const senderId = 'cc'.repeat(16);
    const payload = 'hello aibot';
    const ts = 1_700_000_000_000;
    const pendingHash = 'reticulum-pending-1700000000000';
    const save = handlers.get('db:saveReticulumMessage');
    save?.(event, {
      identity_id: identityId,
      sender_id: senderId,
      sender_name: 'Me',
      payload,
      timestamp: ts,
      message_hash: pendingHash,
      delivery_status: 'sending',
    });
    save?.(event, {
      identity_id: identityId,
      sender_id: senderId,
      sender_name: 'Me',
      payload,
      timestamp: ts + 182,
      message_hash: 'ab'.repeat(32),
      replaces_message_hash: pendingHash,
      delivery_status: 'sending',
    });
    const rows = db!
      .prepareOnce(
        'SELECT message_hash, delivery_status FROM reticulum_messages WHERE identity_id = ? ORDER BY id',
      )
      .all(identityId) as { message_hash: string; delivery_status: string }[];
    expect(rows).toEqual([{ message_hash: 'ab'.repeat(32), delivery_status: 'sending' }]);
  });

  it('saveReticulumMessage ignores invalid replaces_message_hash (no accidental DELETE)', () => {
    const identityId = 'id-rt-bad-replaces';
    const senderId = 'ee'.repeat(16);
    const payload = 'keep me';
    const ts = 1_700_000_200_000;
    const victimHash = 'reticulum-pending-victim';
    const save = handlers.get('db:saveReticulumMessage');
    save?.(event, {
      identity_id: identityId,
      sender_id: senderId,
      sender_name: 'Me',
      payload,
      timestamp: ts,
      message_hash: victimHash,
      delivery_status: 'sending',
    });
    save?.(event, {
      identity_id: identityId,
      sender_id: senderId,
      sender_name: 'Me',
      payload: 'new',
      timestamp: ts + 1,
      message_hash: 'ff'.repeat(32),
      replaces_message_hash: '../etc/passwd',
      delivery_status: 'sending',
    });
    const rows = db!
      .prepareOnce('SELECT message_hash FROM reticulum_messages WHERE identity_id = ? ORDER BY id')
      .all(identityId) as { message_hash: string }[];
    expect(rows.map((r) => r.message_hash)).toEqual([victimHash, 'ff'.repeat(32)]);
  });

  it('saveReticulumMessage replaces only the named pending when two identical payloads exist', () => {
    const identityId = 'id-rt-twin-payload';
    const senderId = 'dd'.repeat(16);
    const payload = 'hello';
    const ts = 1_700_000_100_000;
    const pendingA = 'reticulum-pending-a';
    const pendingB = 'reticulum-pending-b';
    const save = handlers.get('db:saveReticulumMessage');
    save?.(event, {
      identity_id: identityId,
      sender_id: senderId,
      sender_name: 'Me',
      payload,
      timestamp: ts,
      message_hash: pendingA,
      delivery_status: 'sending',
    });
    save?.(event, {
      identity_id: identityId,
      sender_id: senderId,
      sender_name: 'Me',
      payload,
      timestamp: ts + 50,
      message_hash: pendingB,
      delivery_status: 'sending',
    });
    save?.(event, {
      identity_id: identityId,
      sender_id: senderId,
      sender_name: 'Me',
      payload,
      timestamp: ts + 80,
      message_hash: 'ee'.repeat(32),
      replaces_message_hash: pendingA,
      delivery_status: 'sending',
    });
    const rows = db!
      .prepareOnce('SELECT message_hash FROM reticulum_messages WHERE identity_id = ? ORDER BY id')
      .all(identityId) as { message_hash: string }[];
    expect(rows.map((r) => r.message_hash)).toEqual([pendingB, 'ee'.repeat(32)]);
  });

  it('saveReticulumMessage rolls back pending delete when replacement insert fails', () => {
    const identityId = 'id-rt-pending-rollback';
    const senderId = 'ff'.repeat(16);
    const payload = 'rollback me';
    const ts = 1_700_000_200_000;
    const pendingHash = 'reticulum-pending-rollback';
    const save = handlers.get('db:saveReticulumMessage');
    save?.(event, {
      identity_id: identityId,
      sender_id: senderId,
      sender_name: 'Me',
      payload,
      timestamp: ts,
      message_hash: pendingHash,
      delivery_status: 'sending',
    });

    const prepareOnce = db!.prepareOnce.bind(db!);
    const spy = vi.spyOn(db!, 'prepareOnce').mockImplementation((sql: string) => {
      const stmt = prepareOnce(sql);
      if (sql.includes('INSERT INTO reticulum_messages')) {
        return {
          run: () => {
            throw new Error('insert boom');
          },
          get: stmt.get.bind(stmt),
          all: stmt.all.bind(stmt),
        } as unknown as ReturnType<typeof prepareOnce>;
      }
      return stmt;
    });

    expect(() =>
      save?.(event, {
        identity_id: identityId,
        sender_id: senderId,
        sender_name: 'Me',
        payload,
        timestamp: ts + 10,
        message_hash: '11'.repeat(32),
        replaces_message_hash: pendingHash,
        delivery_status: 'sending',
      }),
    ).toThrow('insert boom');
    spy.mockRestore();

    const rows = db!
      .prepareOnce(
        'SELECT message_hash, delivery_status FROM reticulum_messages WHERE identity_id = ?',
      )
      .all(identityId) as { message_hash: string; delivery_status: string }[];
    expect(rows).toEqual([{ message_hash: pendingHash, delivery_status: 'sending' }]);
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

  it('named identity-activity upsert clears sibling unknown aspect rows', () => {
    const dest = 'aa'.repeat(16);
    db!
      .prepareOnce(
        `INSERT INTO reticulum_identity_activity (destination_hash, aspect, identity_hash, last_seen, hops)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(dest, 'unknown', null, Date.now() - 1000, 2);
    const upsert = handlers.get('db:upsertReticulumIdentityActivity');
    upsert?.(event, {
      destination_hash: dest,
      aspect: 'lxmf.delivery',
      identity_hash: 'bb'.repeat(16),
      last_seen: Date.now(),
      hops: 1,
    });
    const rows = db!
      .prepareOnce(
        'SELECT aspect, identity_hash FROM reticulum_identity_activity WHERE destination_hash = ? ORDER BY aspect',
      )
      .all(dest) as { aspect: string; identity_hash: string | null }[];
    expect(rows).toEqual([{ aspect: 'lxmf.delivery', identity_hash: 'bb'.repeat(16) }]);
  });

  it('named identity-activity batch upsert clears sibling unknown aspect rows', () => {
    const dest = 'cc'.repeat(16);
    db!
      .prepareOnce(
        `INSERT INTO reticulum_identity_activity (destination_hash, aspect, identity_hash, last_seen, hops)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(dest, 'unknown', null, Date.now() - 1000, 3);
    const result = handlers.get('db:upsertReticulumIdentityActivityBatch')?.(event, [
      {
        destination_hash: dest,
        aspect: 'nomadnetwork.node',
        last_seen: Date.now(),
        hops: 1,
      },
    ]) as { changes: number };
    expect(result.changes).toBe(1);
    const rows = db!
      .prepareOnce('SELECT aspect FROM reticulum_identity_activity WHERE destination_hash = ?')
      .all(dest) as { aspect: string }[];
    expect(rows.map((r) => r.aspect)).toEqual(['nomadnetwork.node']);
  });

  it('upsertReticulumDestination normalizes hash casing into one row', () => {
    const upsert = handlers.get('db:upsertReticulumDestination');
    const mixed = 'AABBCCDDEEFF00112233445566778899';
    const lower = mixed.toLowerCase();
    upsert?.(event, {
      destination_hash: mixed,
      display_name: 'Alice',
      favorited: true,
      icon_name: 'star',
      icon_color: 'amber',
    });
    upsert?.(event, {
      destination_hash: lower,
      last_heard: 1_700_000_000,
    });
    const rows = db!.prepareOnce('SELECT * FROM reticulum_destinations').all() as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.destination_hash).toBe(lower);
    expect(rows[0]?.display_name).toBe('Alice');
    expect(rows[0]?.favorited).toBe(1);
    expect(rows[0]?.icon_name).toBe('star');
    expect(rows[0]?.icon_color).toBe('amber');
    expect(rows[0]?.last_heard).toBe(1_700_000_000);
  });

  it('upsertReticulumDestination icon-only patch does not clear favorited or display_name', () => {
    const upsert = handlers.get('db:upsertReticulumDestination');
    const hash = 'deadbeefcafebabe0123456789abcdef';
    upsert?.(event, {
      destination_hash: hash,
      display_name: 'Named',
      favorited: true,
    });
    upsert?.(event, {
      destination_hash: hash,
      icon_name: 'heart',
      icon_color: 'cyan',
    });
    const row = db!
      .prepareOnce('SELECT * FROM reticulum_destinations WHERE destination_hash = ?')
      .get(hash) as Record<string, unknown>;
    expect(row.display_name).toBe('Named');
    expect(row.favorited).toBe(1);
    expect(row.icon_name).toBe('heart');
    expect(row.icon_color).toBe('cyan');
  });

  it('upsertReticulumDestination history stamp does not clear is_contact', () => {
    const upsert = handlers.get('db:upsertReticulumDestination');
    const hash = 'cafebabedeadbeef0123456789abcdef';
    upsert?.(event, {
      destination_hash: hash,
      display_name: 'Saved',
      is_contact: true,
      last_heard: 1_700_000_000,
    });
    upsert?.(event, {
      destination_hash: hash,
      last_heard: 1_700_000_100,
    });
    const row = db!
      .prepareOnce('SELECT * FROM reticulum_destinations WHERE destination_hash = ?')
      .get(hash) as Record<string, unknown>;
    expect(row.is_contact).toBe(1);
    expect(row.last_heard).toBe(1_700_000_100);
  });

  it('deleteReticulumDestinationsByAge keeps is_contact rows', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    db!
      .prepareOnce(
        `INSERT INTO reticulum_destinations (destination_hash, display_name, last_heard, favorited, is_contact)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('ff'.repeat(16), 'Contact', nowSec - 40 * 86_400, 0, 1);
    db!
      .prepareOnce(
        `INSERT INTO reticulum_destinations (destination_hash, display_name, last_heard, favorited, is_contact)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run('ee'.repeat(16), 'History', nowSec - 40 * 86_400, 0, 0);
    const result = handlers.get('db:deleteReticulumDestinationsByAge')?.(event, 30) as {
      changes: number;
    };
    expect(result.changes).toBe(1);
    const remaining = db!
      .prepareOnce('SELECT destination_hash FROM reticulum_destinations')
      .all() as { destination_hash: string }[];
    expect(remaining.map((r) => r.destination_hash)).toEqual(['ff'.repeat(16)]);
  });

  it('clearReticulumContactDestinations clears is_contact and keeps last_heard', () => {
    const upsert = handlers.get('db:upsertReticulumDestination');
    const hash = 'aabbccddeeff00112233445566778899';
    upsert?.(event, {
      destination_hash: hash,
      last_heard: 1_700_000_000,
      is_contact: true,
    });
    const result = handlers.get('db:clearReticulumContactDestinations')?.(event) as {
      changes: number;
    };
    expect(result.changes).toBe(1);
    const row = db!
      .prepareOnce(
        'SELECT is_contact, last_heard FROM reticulum_destinations WHERE destination_hash = ?',
      )
      .get(hash) as { is_contact: number; last_heard: number };
    expect(row.is_contact).toBe(0);
    expect(row.last_heard).toBe(1_700_000_000);
  });

  it('upsertReticulumDestination rejects stripped/malformed hashes', () => {
    const upsert = handlers.get('db:upsertReticulumDestination');
    expect(() =>
      upsert?.(event, {
        destination_hash: 'aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99',
        display_name: 'Bad',
      }),
    ).toThrow(/destination_hash invalid/);
    expect(() =>
      upsert?.(event, {
        destination_hash: 'deadbeef',
        display_name: 'Short',
      }),
    ).toThrow(/destination_hash invalid/);
  });

  it('upsertReticulumDestination refuses hash-prefix overwrite of a real name', () => {
    const upsert = handlers.get('db:upsertReticulumDestination');
    const hash = 'aabbccddeeff00112233445566778899';
    upsert?.(event, {
      destination_hash: hash,
      display_name: 'Alice',
      favorited: true,
    });
    upsert?.(event, {
      destination_hash: hash.toUpperCase(),
      display_name: 'AABBCCDDEEFF',
    });
    let row = db!
      .prepareOnce('SELECT * FROM reticulum_destinations WHERE destination_hash = ?')
      .get(hash) as Record<string, unknown>;
    expect(row.display_name).toBe('Alice');
    expect(row.favorited).toBe(1);

    upsert?.(event, {
      destination_hash: hash,
      display_name: 'Bob',
    });
    row = db!
      .prepareOnce('SELECT * FROM reticulum_destinations WHERE destination_hash = ?')
      .get(hash) as Record<string, unknown>;
    expect(row.display_name).toBe('Bob');
    expect(row.favorited).toBe(1);

    upsert?.(event, {
      destination_hash: hash,
      favorited: false,
    });
    row = db!
      .prepareOnce('SELECT * FROM reticulum_destinations WHERE destination_hash = ?')
      .get(hash) as Record<string, unknown>;
    expect(row.favorited).toBe(0);
    expect(row.display_name).toBe('Bob');
  });
});

describe('reticulum remote address book + inbound policy IPC', () => {
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
    dir = mkdtempSync(join(tmpdir(), 'mesh-rns-remote-'));
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

  const HASH_A = 'aa'.repeat(16);
  const HASH_B = 'bb'.repeat(16);

  it('upsertReticulumRemoteAddress inserts then updates by (service, destination_hash)', () => {
    const upsert = handlers.get('db:upsertReticulumRemoteAddress');
    upsert?.(event, { label: 'Shell box', service: 'rnsh', destination_hash: HASH_A });
    upsert?.(event, { label: 'Shell box (renamed)', service: 'rnsh', destination_hash: HASH_A });

    const rows = handlers.get('db:listReticulumRemoteAddresses')?.(event) as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('Shell box (renamed)');
    expect(rows[0]?.service).toBe('rnsh');
    expect(rows[0]?.destination_hash).toBe(HASH_A);
  });

  it('upsertReticulumRemoteAddress rejects invalid hash, service, or missing label', () => {
    const upsert = handlers.get('db:upsertReticulumRemoteAddress');
    expect(() =>
      upsert?.(event, { label: 'x', service: 'rnsh', destination_hash: 'not-hex' }),
    ).toThrow(/destination_hash invalid/);
    expect(() =>
      upsert?.(event, { label: 'x', service: 'bogus', destination_hash: HASH_A }),
    ).toThrow(/service invalid/);
    expect(() => upsert?.(event, { label: '', service: 'rncp', destination_hash: HASH_A })).toThrow(
      /label required/,
    );
  });

  it('allows the same destination_hash under different services', () => {
    const upsert = handlers.get('db:upsertReticulumRemoteAddress');
    upsert?.(event, { label: 'Shell', service: 'rnsh', destination_hash: HASH_A });
    upsert?.(event, { label: 'Files', service: 'rncp', destination_hash: HASH_A });
    const rows = handlers.get('db:listReticulumRemoteAddresses')?.(event) as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(2);
  });

  it('deleteReticulumRemoteAddress removes by id', () => {
    const upsert = handlers.get('db:upsertReticulumRemoteAddress');
    upsert?.(event, { id: 'fixed-id', label: 'Shell', service: 'rnsh', destination_hash: HASH_A });
    const result = handlers.get('db:deleteReticulumRemoteAddress')?.(event, 'fixed-id') as {
      changes: number;
    };
    expect(result.changes).toBe(1);
    const rows = handlers.get('db:listReticulumRemoteAddresses')?.(event) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('upsertReticulumInboundPolicy inserts then updates decision by identity_hash', () => {
    const upsert = handlers.get('db:upsertReticulumInboundPolicy');
    upsert?.(event, { identity_hash: HASH_B, decision: 'allow', label: 'Trusted peer' });
    upsert?.(event, { identity_hash: HASH_B, decision: 'block' });

    const rows = handlers.get('db:listReticulumInboundPolicy')?.(event) as Record<
      string,
      unknown
    >[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe('block');
    // label preserved via COALESCE when the update omits it.
    expect(rows[0]?.label).toBe('Trusted peer');
  });

  it('upsertReticulumInboundPolicy rejects invalid hash or decision', () => {
    const upsert = handlers.get('db:upsertReticulumInboundPolicy');
    expect(() => upsert?.(event, { identity_hash: 'zz', decision: 'allow' })).toThrow(
      /identity_hash invalid/,
    );
    expect(() => upsert?.(event, { identity_hash: HASH_B, decision: 'maybe' })).toThrow(
      /decision invalid/,
    );
  });

  it('deleteReticulumInboundPolicy removes by identity_hash', () => {
    const upsert = handlers.get('db:upsertReticulumInboundPolicy');
    upsert?.(event, { identity_hash: HASH_A, decision: 'allow' });
    const result = handlers.get('db:deleteReticulumInboundPolicy')?.(event, HASH_A) as {
      changes: number;
    };
    expect(result.changes).toBe(1);
    const rows = handlers.get('db:listReticulumInboundPolicy')?.(event) as unknown[];
    expect(rows).toHaveLength(0);
  });
});

describe('blocked contacts IPC', () => {
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
    dir = mkdtempSync(join(tmpdir(), 'mesh-rns-blocked-'));
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

  const ID = 'identity-1';
  const OTHER_ID = 'identity-2';
  const HASH_1 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const HASH_2 = 'b1b2c3d4e5f60718293a4b5c6d7e8f90';
  const HASH_3 = 'c1b2c3d4e5f60718293a4b5c6d7e8f90';

  const block = (hash: string, identityId = ID) =>
    handlers.get('db:blockContact')?.(event, 'reticulum', identityId, hash);
  const exportBlocked = (identityId = ID, protocol = 'reticulum') =>
    handlers.get('db:exportBlockedContacts')?.(event, protocol, identityId) as string[];
  const importBlocked = (hashes: unknown, identityId = ID, protocol = 'reticulum') =>
    handlers.get('db:importBlockedContacts')?.(event, protocol, identityId, hashes) as {
      imported: number;
      skipped: number;
    };

  it('exports every stored hash after block', () => {
    block(HASH_1);
    block(HASH_2);
    expect(exportBlocked().sort()).toEqual([HASH_1, HASH_2].sort());
  });

  it('unblock removes a hash from the export', () => {
    block(HASH_1);
    block(HASH_2);
    handlers.get('db:unblockContact')?.(event, 'reticulum', ID, HASH_1);
    expect(exportBlocked()).toEqual([HASH_2]);
  });

  it('exports an empty array when nothing is blocked', () => {
    expect(exportBlocked()).toEqual([]);
  });

  it('imports a fresh set and makes rows readable via getBlockedContacts', () => {
    expect(importBlocked([HASH_1, HASH_2, HASH_3])).toEqual({ imported: 3, skipped: 0 });
    const rows = handlers.get('db:getBlockedContacts')?.(event, 'reticulum', ID) as {
      blocked_hash: string;
      created_at: number;
    }[];
    expect(rows.map((r) => r.blocked_hash).sort()).toEqual([HASH_1, HASH_2, HASH_3].sort());
    expect(rows.every((r) => typeof r.created_at === 'number')).toBe(true);
  });

  it('re-importing the same set reports every entry as skipped', () => {
    importBlocked([HASH_1, HASH_2]);
    expect(importBlocked([HASH_1, HASH_2])).toEqual({ imported: 0, skipped: 2 });
    expect(exportBlocked()).toHaveLength(2);
  });

  it('counts already-blocked hashes as skipped on a mixed import', () => {
    block(HASH_1);
    expect(importBlocked([HASH_1, HASH_2])).toEqual({ imported: 1, skipped: 1 });
  });

  it('skips malformed entries while importing the valid ones', () => {
    expect(importBlocked([HASH_1, 'nope', '', 42, null, undefined, HASH_2])).toEqual({
      imported: 2,
      skipped: 5,
    });
    expect(exportBlocked().sort()).toEqual([HASH_1, HASH_2].sort());
  });

  it('collapses duplicates within one import payload', () => {
    expect(importBlocked([HASH_1, HASH_1.toUpperCase(), HASH_1])).toEqual({
      imported: 1,
      skipped: 2,
    });
  });

  it('normalizes case and separators to a single row', () => {
    importBlocked(['A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90']);
    expect(exportBlocked()).toEqual([HASH_1]);
  });

  it('scopes rows per identity', () => {
    importBlocked([HASH_1], ID);
    importBlocked([HASH_2], OTHER_ID);
    expect(exportBlocked(ID)).toEqual([HASH_1]);
    expect(exportBlocked(OTHER_ID)).toEqual([HASH_2]);
  });

  it('scopes rows per protocol', () => {
    importBlocked([HASH_1], ID, 'reticulum');
    expect(exportBlocked(ID, 'meshtastic')).toEqual([]);
  });

  it('returns no-op values for an invalid protocol', () => {
    expect(importBlocked([HASH_1], ID, 'bogus')).toEqual({ imported: 0, skipped: 0 });
    expect(exportBlocked(ID, 'bogus')).toEqual([]);
  });

  it('returns no-op values for an oversized identityId', () => {
    expect(importBlocked([HASH_1], 'x'.repeat(200))).toEqual({ imported: 0, skipped: 0 });
    expect(exportBlocked('x'.repeat(200))).toEqual([]);
  });

  it('returns a no-op when hashes is not an array', () => {
    expect(importBlocked('not-an-array')).toEqual({ imported: 0, skipped: 0 });
    expect(importBlocked(null)).toEqual({ imported: 0, skipped: 0 });
  });

  it('rejects an oversized import without inserting anything', () => {
    const tooMany = Array.from({ length: BLOCKED_CONTACTS_IMPORT_MAX + 1 }, () => HASH_1);
    expect(() => importBlocked(tooMany)).toThrow(/too many entries/);
    expect(exportBlocked()).toEqual([]);
  });

  it('imports the maximum allowed number of entries', () => {
    const atLimit = Array.from({ length: BLOCKED_CONTACTS_IMPORT_MAX }, (_, i) =>
      (i + 1).toString(16).padStart(32, '0'),
    );
    expect(importBlocked(atLimit).imported).toBe(BLOCKED_CONTACTS_IMPORT_MAX);
  });

  it('imports an empty array as a no-op', () => {
    expect(importBlocked([])).toEqual({ imported: 0, skipped: 0 });
  });
});
