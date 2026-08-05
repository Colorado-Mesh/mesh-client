// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-db-schema-confirm-'));

const confirmDatabaseSchemaUpgrade = vi.fn();

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpDir),
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false,
  },
  dialog: {
    showErrorBox: vi.fn(),
    showMessageBoxSync: vi.fn(() => 0),
  },
}));

vi.mock('./fatal-startup-dialog', async () => {
  const actual = await vi.importActual('./fatal-startup-dialog');
  return {
    ...(actual as object),
    confirmDatabaseSchemaUpgrade: (...args: unknown[]) => confirmDatabaseSchemaUpgrade(...args),
  };
});

describe('database schema upgrade confirm runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    confirmDatabaseSchemaUpgrade.mockReset();
    for (const file of fs.readdirSync(tmpDir)) {
      fs.rmSync(path.join(tmpDir, file), { force: true, recursive: true });
    }
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('leaves user_version unchanged when upgrade is declined', async () => {
    const { NodeSqliteDB } = await import('./db-compat');
    const { CURRENT_SCHEMA_VERSION } = await import('./db-schema-sync');
    const dbPath = path.join(tmpDir, 'mesh-client.db');
    const seedVersion = Math.max(1, CURRENT_SCHEMA_VERSION - 1);

    {
      const seed = new NodeSqliteDB(dbPath);
      seed.pragma(`user_version = ${seedVersion}`);
      seed.close();
    }

    confirmDatabaseSchemaUpgrade.mockReturnValue(false);

    const {
      DatabaseSchemaUpgradeDeclinedError,
      initDatabase,
      isDatabaseSchemaUpgradeDeclinedError,
    } = await import('./database');

    expect(() => {
      initDatabase();
    }).toThrow(DatabaseSchemaUpgradeDeclinedError);
    expect(confirmDatabaseSchemaUpgrade).toHaveBeenCalledWith(seedVersion, CURRENT_SCHEMA_VERSION);

    const after = new NodeSqliteDB(dbPath);
    expect(after.pragma('user_version', { simple: true })).toBe(seedVersion);
    after.close();

    expect(
      isDatabaseSchemaUpgradeDeclinedError(
        new DatabaseSchemaUpgradeDeclinedError(seedVersion, CURRENT_SCHEMA_VERSION),
      ),
    ).toBe(true);
  });

  it('upgrades when confirm returns true', async () => {
    const { NodeSqliteDB } = await import('./db-compat');
    const { CURRENT_SCHEMA_VERSION } = await import('./db-schema-sync');
    const dbPath = path.join(tmpDir, 'mesh-client.db');
    const seedVersion = Math.max(1, CURRENT_SCHEMA_VERSION - 1);

    {
      const seed = new NodeSqliteDB(dbPath);
      seed.pragma(`user_version = ${seedVersion}`);
      seed.close();
    }

    confirmDatabaseSchemaUpgrade.mockReturnValue(true);

    const { closeDatabase, initDatabase } = await import('./database');
    initDatabase();
    closeDatabase();

    const after = new NodeSqliteDB(dbPath);
    expect(after.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    after.close();
  });

  it('skips confirm on fresh install (user_version 0)', async () => {
    confirmDatabaseSchemaUpgrade.mockReturnValue(false);
    const { closeDatabase, CURRENT_SCHEMA_VERSION, getDatabasePath, initDatabase } =
      await import('./database');
    initDatabase();
    closeDatabase();
    expect(confirmDatabaseSchemaUpgrade).not.toHaveBeenCalled();

    const { NodeSqliteDB } = await import('./db-compat');
    const check = new NodeSqliteDB(getDatabasePath());
    expect(check.pragma('user_version', { simple: true })).toBe(CURRENT_SCHEMA_VERSION);
    check.close();
  });
});
