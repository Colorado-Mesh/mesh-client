// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DatabaseSchemaTooNewError } from './db-schema-sync';
import {
  confirmDatabaseSchemaUpgrade,
  formatDatabaseSchemaTooNewMessage,
  formatSchemaUpgradeConfirmMessage,
  MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE_ENV,
} from './fatal-startup-dialog';

const showMessageBoxSync = vi.fn();

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3-test' },
  dialog: {
    showErrorBox: vi.fn(),
    showMessageBoxSync: (...args: unknown[]) => showMessageBoxSync(...args),
  },
}));

vi.mock('./log-service', () => ({
  getLogPath: () => '/tmp/mesh-client/mesh-client.log',
}));

describe('formatDatabaseSchemaTooNewMessage', () => {
  it('includes app version, schema versions, and log path', () => {
    const err = new DatabaseSchemaTooNewError(40, 36);
    const message = formatDatabaseSchemaTooNewMessage(err);
    expect(message).toContain('schema 40');
    expect(message).toContain('1.2.3-test');
    expect(message).toContain('schema version 36');
    expect(message).toContain('/tmp/mesh-client/mesh-client.log');
    expect(message).toContain('latest Mesh-Client release');
  });
});

describe('formatSchemaUpgradeConfirmMessage', () => {
  it('states from/to schema and that downgrade is impossible', () => {
    const message = formatSchemaUpgradeConfirmMessage(47, 48);
    expect(message).toContain('schema 47');
    expect(message).toContain('48');
    expect(message).toContain('cannot go back');
    expect(message).toContain('Quit');
    expect(message).toContain('Upgrade');
  });
});

describe('confirmDatabaseSchemaUpgrade', () => {
  afterEach(() => {
    Reflect.deleteProperty(process.env, MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE_ENV);
    showMessageBoxSync.mockReset();
  });

  it('auto-accepts when MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE=1', () => {
    process.env[MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE_ENV] = '1';
    expect(confirmDatabaseSchemaUpgrade(40, 48)).toBe(true);
    expect(showMessageBoxSync).not.toHaveBeenCalled();
  });

  it('returns true only when Upgrade (index 1) is chosen', () => {
    showMessageBoxSync.mockReturnValue(1);
    expect(confirmDatabaseSchemaUpgrade(40, 48)).toBe(true);
    expect(showMessageBoxSync).toHaveBeenCalledOnce();
    const firstCall = showMessageBoxSync.mock.calls[0];
    expect(firstCall).toBeDefined();
    const opts = firstCall[0] as {
      buttons: string[];
      defaultId: number;
      cancelId: number;
    };
    expect(opts.buttons).toEqual(['Quit', 'Upgrade']);
    expect(opts.defaultId).toBe(0);
    expect(opts.cancelId).toBe(0);
  });

  it('returns false when Quit (index 0) is chosen', () => {
    showMessageBoxSync.mockReturnValue(0);
    expect(confirmDatabaseSchemaUpgrade(40, 48)).toBe(false);
  });

  it('returns false when the dialog throws', () => {
    showMessageBoxSync.mockImplementation(() => {
      throw new Error('no display');
    });
    expect(confirmDatabaseSchemaUpgrade(40, 48)).toBe(false);
  });
});
