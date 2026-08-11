// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseSchemaTooNewError } from './db-schema-sync';
import {
  confirmDatabaseSchemaUpgrade,
  formatDatabaseSchemaTooNewMessage,
  formatSchemaUpgradeConfirmMessage,
  MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE_ENV,
  showFatalStartupError,
} from './fatal-startup-dialog';

const showMessageBoxSync = vi.fn();
const showErrorBox = vi.fn();
const isHeadlessServerMode = vi.fn(() => false);

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3-test' },
  dialog: {
    showErrorBox: (...args: unknown[]) => showErrorBox(...args),
    showMessageBoxSync: (...args: unknown[]) => showMessageBoxSync(...args),
  },
}));

vi.mock('./log-service', () => ({
  getLogPath: () => '/tmp/mesh-client/mesh-client.log',
}));

vi.mock('../shared/headless', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('../shared/headless')>();
  return {
    ...actual,
    isHeadlessServerMode: () => isHeadlessServerMode(),
  };
});

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
  beforeEach(() => {
    isHeadlessServerMode.mockReturnValue(false);
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE_ENV);
    showMessageBoxSync.mockReset();
    isHeadlessServerMode.mockReset();
    isHeadlessServerMode.mockReturnValue(false);
  });

  it('auto-accepts when MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE=1', () => {
    process.env[MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE_ENV] = '1';
    expect(confirmDatabaseSchemaUpgrade(40, 48)).toBe(true);
    expect(showMessageBoxSync).not.toHaveBeenCalled();
  });

  it('auto-accepts when MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE=yes (parseBooleanEnv)', () => {
    process.env[MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE_ENV] = 'yes';
    expect(confirmDatabaseSchemaUpgrade(40, 48)).toBe(true);
    expect(showMessageBoxSync).not.toHaveBeenCalled();
  });

  it('refuses upgrade in headless without explicit accept env', () => {
    isHeadlessServerMode.mockReturnValue(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(confirmDatabaseSchemaUpgrade(40, 48)).toBe(false);
      expect(showMessageBoxSync).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('accepts via env before headless check', () => {
    isHeadlessServerMode.mockReturnValue(true);
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

describe('showFatalStartupError', () => {
  afterEach(() => {
    showErrorBox.mockReset();
    isHeadlessServerMode.mockReset();
    isHeadlessServerMode.mockReturnValue(false);
  });

  it('logs instead of showing a dialog in headless mode', () => {
    isHeadlessServerMode.mockReturnValue(true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      showFatalStartupError('Title', 'Message body');
      expect(showErrorBox).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('shows the native error box outside headless mode', () => {
    isHeadlessServerMode.mockReturnValue(false);
    showFatalStartupError('Title', 'Message body');
    expect(showErrorBox).toHaveBeenCalledWith('Title', 'Message body');
  });
});
