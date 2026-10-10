// @vitest-environment node
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
  return { testUserDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-blocked-db-')) };
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
import {
  BLOCKED_CONTACTS_IMPORT_MAX,
  registerBlockedContactsIpcHandlers,
} from './blocked-contacts-handlers';

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

const getDbForIpcMock = vi.mocked(getDbForIpc);

afterAll(() => {
  rmSync(testUserDataDir, { recursive: true, force: true });
});

describe('blocked contacts IPC', () => {
  const handlers = new Map<string, IpcHandler>();
  const event = {} as IpcMainInvokeEvent;
  let dir: string | undefined;
  let db: NodeSqliteDB | undefined;

  beforeAll(() => {
    registerBlockedContactsIpcHandlers({
      ipcMain: {
        handle(channel: string, fn: IpcHandler) {
          handlers.set(channel, fn);
        },
      } as unknown as IpcMain,
    });
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mesh-blocked-'));
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
    handlers.get('db:blockContact')?.(event, 'meshcore', identityId, hash);
  const exportBlocked = (identityId = ID, protocol = 'meshcore') =>
    handlers.get('db:exportBlockedContacts')?.(event, protocol, identityId) as string[];
  const importBlocked = (hashes: unknown, identityId = ID, protocol = 'meshcore') =>
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
    handlers.get('db:unblockContact')?.(event, 'meshcore', ID, HASH_1);
    expect(exportBlocked()).toEqual([HASH_2]);
  });

  it('exports an empty array when nothing is blocked', () => {
    expect(exportBlocked()).toEqual([]);
  });

  it('imports a fresh set and makes rows readable via getBlockedContacts', () => {
    expect(importBlocked([HASH_1, HASH_2, HASH_3])).toEqual({ imported: 3, skipped: 0 });
    const rows = handlers.get('db:getBlockedContacts')?.(event, 'meshcore', ID) as {
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
    importBlocked([HASH_1], ID, 'meshcore');
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
