import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RENDERER_STORAGE_DELETION_SETTING_PREFIX } from '../shared/rendererOrigin';
import { parseRendererStorageDeletionState } from '../shared/rendererStorageIntent';
import { NodeSqliteDB } from './db-compat';
import {
  commitImportedRendererStorageIntents,
  writeRendererStorageDeletionState,
} from './rendererStorageIntentMigration';

const originalKey = 'mesh-client:lastConnection:meshcore';
const settingKey = `${RENDERER_STORAGE_DELETION_SETTING_PREFIX}${originalKey}`;
const intentA = { id: 'imported-A', origin: 'file:', deleted: true };

describe('durable renderer storage receipts', () => {
  let db: NodeSqliteDB;
  beforeEach(() => {
    db = new NodeSqliteDB(':memory:');
    db.execScript('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.pragma('synchronous = NORMAL');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  function readState() {
    const row = db.prepareOnce('SELECT value FROM app_settings WHERE key = ?').get(settingKey) as
      { value: string } | undefined;
    return parseRendererStorageDeletionState(row?.value);
  }

  it('pins the imported source receipt without replaying it over a newer edit from the same origin', () => {
    commitImportedRendererStorageIntents(db, { [originalKey]: intentA });
    expect(readState()).toEqual({
      deleted: true,
      applied: { 'file:': 'imported-A' },
      imported: { 'file:': 'imported-A' },
    });
    const newer = {
      deleted: false,
      applied: { 'file:': 'later-file-B', 'mesh-client://renderer': 'custom-recreation' },
      imported: { 'file:': 'imported-A' },
    };
    writeRendererStorageDeletionState(db, settingKey, JSON.stringify(newer));
    commitImportedRendererStorageIntents(db, { [originalKey]: intentA });
    expect(readState()).toEqual(newer);
  });

  it('preserves pinned imports when an ordinary receipt write omits, clears or forges them', () => {
    commitImportedRendererStorageIntents(db, { [originalKey]: intentA });
    for (const imported of [undefined, {}, { 'file:': 'forged-replacement' }]) {
      writeRendererStorageDeletionState(
        db,
        settingKey,
        JSON.stringify({
          deleted: false,
          applied: { 'mesh-client://renderer': 'new-edit' },
          imported,
        }),
      );
      expect(readState()).toEqual({
        deleted: false,
        applied: { 'mesh-client://renderer': 'new-edit' },
        imported: { 'file:': 'imported-A' },
      });
    }
  });

  it('can pin a newer live source intent while retrying before the first successful cutover', () => {
    commitImportedRendererStorageIntents(db, { [originalKey]: intentA });
    commitImportedRendererStorageIntents(db, {
      [originalKey]: { id: 'replacement-B', origin: 'file:', deleted: false },
    });
    expect(readState()).toEqual({
      deleted: false,
      applied: { 'file:': 'replacement-B' },
      imported: { 'file:': 'replacement-B' },
    });
  });

  it.each(['OFF', 'NORMAL', 'FULL', 'EXTRA'])(
    'uses FULL for scoped ACK writes and restores prior %s synchronous mode',
    (mode) => {
      db.pragma(`synchronous = ${mode}`);
      const prior = db.pragma('synchronous', { simple: true });
      const prepare = db.prepareOnce.bind(db);
      vi.spyOn(db, 'prepareOnce').mockImplementation((sql) => {
        expect(db.pragma('synchronous', { simple: true })).toBe(2);
        return prepare(sql);
      });
      writeRendererStorageDeletionState(db, settingKey, '0');
      expect(db.pragma('synchronous', { simple: true })).toBe(prior);
      commitImportedRendererStorageIntents(db, { [originalKey]: intentA });
      expect(db.pragma('synchronous', { simple: true })).toBe(prior);
    },
  );

  it('propagates a failed receipt write without an ACK and restores the previous synchronous mode', () => {
    db.execScript(`CREATE TRIGGER reject_receipt BEFORE INSERT ON app_settings
      BEGIN SELECT RAISE(ABORT, 'receipt write failed'); END;`);
    expect(() => writeRendererStorageDeletionState(db, settingKey, '1')).toThrow(
      'receipt write failed',
    );
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
    expect(db.prepareOnce('SELECT key FROM app_settings').all()).toEqual([]);
  });

  it('cannot clear or forge a native credential revision with a stale renderer receipt', () => {
    const key = 'rendererDeletedStorage:mesh-client:credentialCompatibility:mqtt:meshcore';
    const native = { deleted: true, applied: {}, imported: {}, secretRevision: 'native-new' };
    db.prepareOnce('INSERT INTO app_settings(key, value) VALUES (?, ?)').run(
      key,
      JSON.stringify(native),
    );
    for (const revision of [undefined, 'old', 'forged']) {
      expect(() =>
        writeRendererStorageDeletionState(
          db,
          key,
          JSON.stringify({ ...native, deleted: false, secretRevision: revision }),
        ),
      ).toThrow('Stale secure credential');
    }
    commitImportedRendererStorageIntents(db, {
      'mesh-client:credentialCompatibility:mqtt:meshcore': {
        id: 'old-outage-journal',
        origin: 'file:',
        deleted: false,
      },
    });
    const row = db.prepareOnce('SELECT value FROM app_settings WHERE key = ?').get(key) as {
      value: string;
    };
    expect(JSON.parse(row.value)).toMatchObject(native);
    writeRendererStorageDeletionState(db, key, JSON.stringify({ ...native, deleted: false }));
    expect(
      JSON.parse(
        (
          db.prepareOnce('SELECT value FROM app_settings WHERE key = ?').get(key) as {
            value: string;
          }
        ).value,
      ).deleted,
    ).toBe(false);
  });

  it('rolls back all imported receipts when a later canonical record is corrupt', () => {
    const secondKey = 'mesh-client:lastBleDevice:meshcore';
    db.prepareOnce('INSERT INTO app_settings(key, value) VALUES (?, ?)').run(
      `${RENDERER_STORAGE_DELETION_SETTING_PREFIX}${secondKey}`,
      '{broken',
    );
    expect(() => {
      commitImportedRendererStorageIntents(db, {
        [originalKey]: intentA,
        [secondKey]: { id: 'second', origin: 'file:', deleted: true },
      });
    }).toThrow();
    expect(readState()).toEqual({ deleted: false, applied: {}, imported: {} });
    expect(db.pragma('synchronous', { simple: true })).toBe(1);
  });
});
