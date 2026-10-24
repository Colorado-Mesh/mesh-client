import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = fs.readFileSync(path.join(root, 'e2e/fixtures/origin-migration.cjs'), 'utf8');

describe('isolated Electron E2E bootstrap', () => {
  let profile;
  let token;

  beforeEach(() => {
    profile = fs.mkdtempSync(path.join(tmpdir(), 'mesh-e2e-'));
    token = randomUUID();
    fs.writeFileSync(path.join(profile, '.mesh-e2e-profile'), token);
  });

  afterEach(() => {
    fs.rmSync(profile, { recursive: true, force: true });
  });

  function harness(extraEnv = {}) {
    const originalSystemCall = vi.fn(() => {
      throw new Error('Unexpected real OS operation');
    });
    const app = {
      isPackaged: false,
      setPath: vi.fn(),
      setAppLogsPath: vi.fn(),
      setAsDefaultProtocolClient: originalSystemCall,
      removeAsDefaultProtocolClient: originalSystemCall,
      setLoginItemSettings: originalSystemCall,
      getLoginItemSettings: originalSystemCall,
    };
    const shell = { openExternal: originalSystemCall };
    const autoUpdater = {
      checkForUpdates: originalSystemCall,
      downloadUpdate: originalSystemCall,
      quitAndInstall: originalSystemCall,
    };
    const loadMain = vi.fn();
    const loadUpdater = vi.fn();
    const run = () =>
      runInNewContext(source, {
        process: {
          env: { MESH_E2E_USER_DATA: profile, MESH_E2E_PROFILE_TOKEN: token, ...extraEnv },
          cwd: () => root,
        },
        require: (id) => {
          if (id === 'electron') return { app, shell };
          if (id === 'electron-updater') {
            loadUpdater();
            return { autoUpdater };
          }
          if (id === path.join(root, 'dist-electron/main/index.js')) return loadMain();
          if (id === 'node:fs') return fs;
          if (id === 'node:os') return { tmpdir };
          if (id === 'node:path') return path;
          if (id === 'node:url') return { pathToFileURL };
          if (id === path.join(root, 'package.json')) return { version: '1.0.0' };
          throw new Error(`Unexpected fixture module: ${id}`);
        },
      });
    return { run, app, shell, autoUpdater, loadMain, loadUpdater, originalSystemCall };
  }

  it('contains storage and OS mutations while loading the real packaged entrypoint', async () => {
    const h = harness();
    h.run();
    expect(h.app.isPackaged).toBe(true);
    expect(h.loadMain).toHaveBeenCalledOnce();
    expect(h.app.setPath.mock.calls).toEqual([
      ['userData', profile],
      ['sessionData', profile],
      ['crashDumps', path.join(profile, 'crashDumps')],
    ]);
    expect(h.app.setAppLogsPath).toHaveBeenCalledWith(path.join(profile, 'logs'));
    expect(h.app.getAppPath()).toBe(root);
    h.app.setAsDefaultProtocolClient('lxm');
    h.app.removeAsDefaultProtocolClient('lxm');
    h.app.setLoginItemSettings({ openAtLogin: true });
    h.app.getLoginItemSettings();
    await h.shell.openExternal('https://example.com');
    await h.autoUpdater.checkForUpdates();
    await h.autoUpdater.downloadUpdate();
    h.autoUpdater.quitAndInstall();
    expect(h.originalSystemCall).not.toHaveBeenCalled();
  });

  it('preserves unpackaged mode for normal E2E', () => {
    const h = harness({ MESH_E2E_PACKAGED: '0' });
    h.run();
    expect(h.app.isPackaged).toBe(false);
    expect(h.loadMain).toHaveBeenCalledOnce();
    expect(h.loadUpdater).not.toHaveBeenCalled();
  });

  it.each([
    { MESH_E2E_USER_DATA: undefined },
    { MESH_E2E_USER_DATA: root },
    { MESH_E2E_PROFILE_TOKEN: undefined },
    { MESH_E2E_PROFILE_TOKEN: 'wrong-owner' },
  ])('rejects an unowned profile before configuring Electron: %j', (env) => {
    const h = harness(env);
    expect(h.run).toThrow('explicitly owned temporary profile');
    expect(h.app.setPath).not.toHaveBeenCalled();
    expect(h.loadMain).not.toHaveBeenCalled();
  });
});
