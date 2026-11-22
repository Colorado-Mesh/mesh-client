// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-db-created-'));

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
    confirmDatabaseSchemaUpgrade: () => true,
  };
});

describe('wasDatabaseCreatedThisLaunch', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const file of fs.readdirSync(tmpDir)) {
      fs.rmSync(path.join(tmpDir, file), { force: true, recursive: true });
    }
  });

  afterEach(async () => {
    const { closeDatabase } = await import('./database');
    closeDatabase();
    vi.resetModules();
  });

  it('is false before the database is opened', async () => {
    const { wasDatabaseCreatedThisLaunch } = await import('./database');
    expect(wasDatabaseCreatedThisLaunch()).toBe(false);
  });

  it('is true when this launch created the database file', async () => {
    const { initDatabase, wasDatabaseCreatedThisLaunch } = await import('./database');
    initDatabase();
    expect(wasDatabaseCreatedThisLaunch()).toBe(true);
  });

  it('is false for a database at the current schema version', async () => {
    const { NodeSqliteDB } = await import('./db-compat');
    const { CURRENT_SCHEMA_VERSION } = await import('./db-schema-sync');
    const seed = new NodeSqliteDB(path.join(tmpDir, 'mesh-client.db'));
    seed.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`);
    seed.close();

    const { initDatabase, wasDatabaseCreatedThisLaunch } = await import('./database');
    initDatabase();
    expect(wasDatabaseCreatedThisLaunch()).toBe(false);
  });

  it('is false for an older database that this launch upgrades', async () => {
    const { NodeSqliteDB } = await import('./db-compat');
    const { CURRENT_SCHEMA_VERSION } = await import('./db-schema-sync');
    const seed = new NodeSqliteDB(path.join(tmpDir, 'mesh-client.db'));
    seed.pragma(`user_version = ${Math.max(1, CURRENT_SCHEMA_VERSION - 1)}`);
    seed.close();

    const { initDatabase, wasDatabaseCreatedThisLaunch } = await import('./database');
    initDatabase();
    expect(wasDatabaseCreatedThisLaunch()).toBe(false);
  });
});
