// @vitest-environment node
import { createRequire } from 'node:module';

import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getCheckNowFromMenu, initUpdater } from './updater';

const PACKAGE_JSON = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'),
) as { dependencies?: Record<string, string> };

/**
 * updater.ts loads electron-updater through a runtime require() so dev mode
 * survives its absence. Vitest runs that require through the real Node module
 * system, so tests inject a fake module into the shared CJS cache.
 */
const cjsRequire = createRequire(join(__dirname, 'updater.ts'));
const ELECTRON_UPDATER_PATH = cjsRequire.resolve('electron-updater');

/**
 * Shared mutable harness: vi.mock factories run before test code, so the mocked
 * electron / electron-updater surface lives in vi.hoisted and each test
 * re-registers handlers by calling initUpdater() again.
 */
const harness = vi.hoisted(() => {
  type Listener = (info?: unknown) => void;
  const listeners = new Map<string, Listener[]>();
  return {
    listeners,
    autoUpdater: {
      autoDownload: undefined as boolean | undefined,
      autoInstallOnAppQuit: undefined as boolean | undefined,
      on(event: string, cb: Listener): void {
        listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      },
      checkForUpdates: vi.fn((): Promise<void> => Promise.resolve()),
      downloadUpdate: vi.fn((): Promise<void> => Promise.resolve()),
      quitAndInstall: vi.fn(),
    },
    ipcHandlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    send: vi.fn(),
    openExternal: vi.fn<(url: string) => Promise<void>>(),
    fetchAllGithubReleases: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(),
    isPackaged: true,
    electronUpdaterMissing: false,
  };
});

vi.mock('electron', () => ({
  app: {
    getVersion: () => '5.32.0',
    get isPackaged() {
      return harness.isPackaged;
    },
  },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      harness.ipcHandlers.set(channel, fn);
    },
  },
  shell: {
    openExternal: (url: string) => harness.openExternal(url),
  },
}));

vi.mock('./log-service', async () => {
  const actual = await import('./sanitize-log-message');
  return { sanitizeLogMessage: actual.sanitizeLogMessage };
});

vi.mock('@/shared/fetchGithubReleases', () => ({
  fetchAllGithubReleases: (...args: unknown[]) => harness.fetchAllGithubReleases(...args),
}));

const REAL_PLATFORM = process.platform;

const win = {
  isDestroyed: () => false,
  webContents: {
    // updater.ts always forwards a payload slot; drop it when it is just undefined.
    send: (channel: string, ...rest: unknown[]) =>
      rest.length === 1 && rest[0] === undefined
        ? harness.send(channel)
        : harness.send(channel, ...rest),
  },
} as unknown as BrowserWindow;

const trustedEvent = {
  senderFrame: { url: 'file:///Applications/Mesh-client.app/Contents/Resources/app.asar/x.html' },
} as unknown as IpcMainInvokeEvent;

const untrustedEvent = {
  senderFrame: { url: 'https://evil.example/' },
} as unknown as IpcMainInvokeEvent;

const NEWER_RELEASE_ROW = {
  tag_name: 'v9.9.9',
  draft: false,
  prerelease: false,
  html_url: 'https://github.com/Colorado-Mesh/mesh-client/releases/tag/v9.9.9',
};

function setPlatform(platform: 'darwin' | 'win32' | 'linux'): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

function emitUpdaterEvent(event: string, info?: unknown): void {
  for (const cb of harness.listeners.get(event) ?? []) cb(info);
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function setup(platform: 'darwin' | 'win32' | 'linux' = 'darwin'): void {
  setPlatform(platform);
  Reflect.deleteProperty(cjsRequire.cache, ELECTRON_UPDATER_PATH);
  if (harness.electronUpdaterMissing) {
    // A cached module whose exports getter throws makes the require() fail like
    // a missing dependency, exercising the GitHub Releases API fallback.
    const broken = {
      id: ELECTRON_UPDATER_PATH,
      filename: ELECTRON_UPDATER_PATH,
      loaded: true,
    } as NodeJS.Module;
    Object.defineProperty(broken, 'exports', {
      get(): never {
        throw new Error("Cannot find module 'electron-updater'");
      },
    });
    cjsRequire.cache[ELECTRON_UPDATER_PATH] = broken;
  } else {
    cjsRequire.cache[ELECTRON_UPDATER_PATH] = {
      id: ELECTRON_UPDATER_PATH,
      filename: ELECTRON_UPDATER_PATH,
      loaded: true,
      exports: { autoUpdater: harness.autoUpdater },
    } as NodeJS.Module;
  }
  initUpdater(win);
}

function handler(channel: string): (event: unknown, ...args: unknown[]) => unknown {
  const fn = harness.ipcHandlers.get(channel);
  expect(fn, `IPC handler ${channel} registered`).toBeDefined();
  return fn!;
}

beforeEach(() => {
  harness.listeners.clear();
  harness.ipcHandlers.clear();
  harness.send.mockReset();
  harness.openExternal.mockReset().mockResolvedValue(undefined);
  harness.fetchAllGithubReleases.mockReset().mockResolvedValue([]);
  harness.autoUpdater.checkForUpdates.mockReset().mockResolvedValue(undefined);
  harness.autoUpdater.downloadUpdate.mockReset().mockResolvedValue(undefined);
  harness.autoUpdater.quitAndInstall.mockReset();
  harness.autoUpdater.autoDownload = undefined;
  harness.autoUpdater.autoInstallOnAppQuit = undefined;
  harness.isPackaged = true;
  harness.electronUpdaterMissing = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true });
  Reflect.deleteProperty(cjsRequire.cache, ELECTRON_UPDATER_PATH);
  vi.restoreAllMocks();
});

describe('updater behavior (electron-updater path)', () => {
  it.each(['darwin', 'win32', 'linux'] as const)(
    'downloads updates automatically but never installs without an explicit restart request on %s',
    (platform) => {
      setup(platform);
      expect(harness.autoUpdater.autoDownload).toBe(true);
      expect(harness.autoUpdater.autoInstallOnAppQuit).toBe(false);
      expect(harness.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    },
  );

  it.each(['darwin', 'win32', 'linux'] as const)(
    'installs only via update:install, forcing run-after-restart, on %s',
    (platform) => {
      setup(platform);
      expect(harness.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
      handler('update:install')(trustedEvent);
      expect(harness.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    },
  );

  it.each([
    ['darwin', true],
    ['win32', false],
    ['linux', false],
  ] as const)('on %s reports an available update with isMac=%s', async (platform, isMac) => {
    setup(platform);
    emitUpdaterEvent('update-available', { version: '9.9.9' });
    await flushMicrotasks();
    expect(harness.send).toHaveBeenCalledWith('update:available', {
      version: '9.9.9',
      releaseUrl: 'https://github.com/Colorado-Mesh/mesh-client/releases/tag/v9.9.9',
      isPackaged: true,
      isMac,
    });
  });

  it('announces when no update is available', () => {
    setup('linux');
    emitUpdaterEvent('update-not-available');
    expect(harness.send).toHaveBeenCalledWith('update:not-available');
  });

  it('downloads on request, forwards rounded progress, and announces readiness', async () => {
    setup('darwin');
    await handler('update:download')(trustedEvent);
    expect(harness.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);

    emitUpdaterEvent('download-progress', { percent: 42.4 });
    expect(harness.send).toHaveBeenCalledWith('update:progress', { percent: 42 });

    emitUpdaterEvent('update-downloaded');
    expect(harness.send).toHaveBeenCalledWith('update:downloaded');
  });

  it('surfaces a sanitized update:error when the download fails', async () => {
    setup('darwin');
    harness.autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('disk full\ninjected'));
    await handler('update:download')(trustedEvent);
    expect(harness.send).toHaveBeenCalledWith('update:error', { message: 'disk full injected' });
  });

  it('forwards updater error events as sanitized update:error payloads', () => {
    setup('win32');
    emitUpdaterEvent('error', new Error('boom\nforged log line'));
    expect(harness.send).toHaveBeenCalledWith('update:error', { message: 'boom forged log line' });
    expect(console.error).toHaveBeenCalled();
  });

  it('surfaces a sanitized update:error when the update check fails', async () => {
    setup('darwin');
    harness.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('offline\nnow'));
    await handler('update:check')(trustedEvent);
    expect(harness.send).toHaveBeenCalledWith('update:error', { message: 'offline now' });
  });

  it('emits update:checking for IPC checks and exposes a notifying menu check', async () => {
    setup('darwin');
    await handler('update:check')(trustedEvent);
    expect(harness.send).toHaveBeenCalledWith('update:checking', { notifyOnSettled: false });
    expect(harness.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    harness.send.mockClear();
    const checkFromMenu = getCheckNowFromMenu();
    expect(checkFromMenu).not.toBeNull();
    checkFromMenu!();
    await flushMicrotasks();
    expect(harness.send).toHaveBeenCalledWith('update:checking', { notifyOnSettled: true });
    expect(harness.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('opens only github.com release URLs', async () => {
    setup('darwin');
    await handler('update:open-releases')(
      trustedEvent,
      'https://github.com/Colorado-Mesh/mesh-client/releases/tag/v9.9.9',
    );
    expect(harness.openExternal).toHaveBeenCalledWith(
      'https://github.com/Colorado-Mesh/mesh-client/releases/tag/v9.9.9',
    );

    harness.openExternal.mockClear();
    await handler('update:open-releases')(trustedEvent, 'https://evil.example/clone');
    expect(harness.openExternal).toHaveBeenCalledWith(
      'https://github.com/Colorado-Mesh/mesh-client/releases',
    );
  });

  it.each(['update:check', 'update:download', 'update:install', 'update:open-releases'] as const)(
    'rejects untrusted senders on %s',
    async (channel) => {
      setup('darwin');
      await expect(Promise.resolve().then(() => handler(channel)(untrustedEvent))).rejects.toThrow(
        `${channel}: unauthorized sender`,
      );
      expect(harness.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
      expect(harness.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
      expect(harness.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
      expect(harness.openExternal).not.toHaveBeenCalled();
    },
  );
});

describe('updater behavior (GitHub Releases API fallback)', () => {
  beforeEach(() => {
    harness.electronUpdaterMissing = true;
  });

  it('announces a newer published GitHub release and opens its page on download', async () => {
    harness.fetchAllGithubReleases.mockResolvedValue([NEWER_RELEASE_ROW]);
    setup('linux');
    await handler('update:check')(trustedEvent);
    expect(harness.send).toHaveBeenCalledWith('update:available', {
      version: '9.9.9',
      releaseUrl: 'https://github.com/Colorado-Mesh/mesh-client/releases/tag/v9.9.9',
      isPackaged: true,
      isMac: false,
    });

    await handler('update:download')(trustedEvent);
    expect(harness.openExternal).toHaveBeenCalledWith(
      'https://github.com/Colorado-Mesh/mesh-client/releases/tag/v9.9.9',
    );
    expect(harness.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('reports not-available when no newer published release exists', async () => {
    setup('win32');
    await handler('update:check')(trustedEvent);
    expect(harness.send).toHaveBeenCalledWith('update:not-available');
  });

  it('emits update:error when the GitHub API fetch fails', async () => {
    harness.fetchAllGithubReleases.mockRejectedValueOnce(new Error('HTTP 503'));
    setup('darwin');
    await handler('update:check')(trustedEvent);
    expect(harness.send).toHaveBeenCalledWith('update:error', {
      message: 'Update check failed — check network connection',
    });
  });

  it('keeps update:download and update:install inert in dev (not packaged)', async () => {
    harness.isPackaged = false;
    harness.fetchAllGithubReleases.mockResolvedValue([NEWER_RELEASE_ROW]);
    setup('darwin');
    await handler('update:check')(trustedEvent);
    expect(harness.send).toHaveBeenCalledWith(
      'update:available',
      expect.objectContaining({ isPackaged: false, isMac: true }),
    );

    await handler('update:download')(trustedEvent);
    expect(harness.openExternal).not.toHaveBeenCalled();

    handler('update:install')(trustedEvent);
    expect(harness.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });
});

describe('updater packaging contracts', () => {
  it('declares builder-util-runtime so electron-updater resolves in packaged Windows builds', () => {
    expect(PACKAGE_JSON.dependencies?.['builder-util-runtime']).toBeTruthy();
  });

  it('declares semver so electron-updater resolves in hoisted Windows app.asar builds', () => {
    expect(PACKAGE_JSON.dependencies?.semver).toBeTruthy();
  });
});
