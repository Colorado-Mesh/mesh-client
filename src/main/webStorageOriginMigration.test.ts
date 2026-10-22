import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import type { BrowserWindowConstructorOptions, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ENV_FORCE_FILE_ORIGIN,
  ENV_FORCE_ORIGIN_REPAIR,
  ENV_SKIP_ORIGIN_MIGRATION,
  ENV_USE_CUSTOM_PROTOCOL,
  LATEST_RENDERER_ORIGIN_MIGRATION,
  RENDERER_MIGRATION_URL,
} from '../shared/rendererOrigin';
import type {
  WebStorageEntries,
  WebStorageOriginMigrationOptions,
} from './webStorageOriginMigration';
import {
  beginRendererStorageReset,
  checkRendererOriginStorageHealth,
  LEGACY_STORAGE_EXPORT_FILENAME,
  RENDERER_ORIGIN_STATE_FILENAME,
  RENDERER_ORIGIN_STORAGE_SENTINEL_KEY,
  RENDERER_STORAGE_RESET_FILENAME,
  resumePendingRendererStorageReset,
  runWebStorageOriginMigration,
} from './webStorageOriginMigration';

const electron = vi.hoisted(() => ({ createWindow: vi.fn() }));
vi.mock('electron', () => ({
  BrowserWindow: vi.fn(function (options: BrowserWindowConstructorOptions) {
    return electron.createWindow(options);
  }),
}));

interface TestWindow {
  options: BrowserWindowConstructorOptions;
  url: string;
  destroyed: boolean;
  loadURL: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
  destroy: () => void;
  webContents: {
    executeJavaScript: ReturnType<typeof vi.fn>;
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    session: { flushStorageData: ReturnType<typeof vi.fn> };
  };
}

describe('renderer origin migration', () => {
  let directory: string;
  let options: WebStorageOriginMigrationOptions;
  let legacy: Map<string, string>;
  let target: Map<string, string>;
  let windows: TestWindow[];
  let importCount: number;
  let failLoad: string | undefined;
  let hangLoad: boolean;
  let failImportAfter: number | undefined;
  let corruptVerify: boolean;
  let seed: ReturnType<typeof vi.fn<WebStorageOriginMigrationOptions['seedDurableStorage']>>;

  const storageObject = (map: Map<string, string>) => ({
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failImportAfter !== undefined && importCount++ >= failImportAfter) {
        throw new Error('QuotaExceededError');
      }
      map.set(key, value);
    },
  });

  function execute(script: string, map: Map<string, string>): unknown {
    return runInNewContext(script, {
      localStorage: storageObject(map),
      TextEncoder,
      TextDecoder,
      atob,
      btoa,
    });
  }

  function createWindow(browserOptions: BrowserWindowConstructorOptions): TestWindow {
    const window: TestWindow = {
      options: browserOptions,
      url: '',
      destroyed: false,
      loadURL: vi.fn(async (url: string) => {
        window.url = url;
        if (hangLoad) return new Promise<void>(() => {});
        if (url === failLoad) throw new Error('ERR_FAILED');
      }),
      isDestroyed: () => window.destroyed,
      destroy: () => {
        window.destroyed = true;
      },
      webContents: {
        executeJavaScript: vi.fn((script: string) => {
          const map = window.url === RENDERER_MIGRATION_URL ? target : legacy;
          const result = execute(script, map);
          if (corruptVerify && map === target && script.includes('localStorage.length')) {
            return Promise.resolve(Buffer.from('{}').toString('base64'));
          }
          return Promise.resolve(result);
        }),
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        session: { flushStorageData: vi.fn() },
      },
    };
    windows.push(window);
    return window;
  }

  function contentsForTarget(): Pick<WebContents, 'executeJavaScript'> {
    return {
      executeJavaScript: vi.fn((script: string) => Promise.resolve(execute(script, target))),
    };
  }

  function targetEntriesWithoutSentinel(): WebStorageEntries {
    return Object.fromEntries(
      [...target].filter(([key]) => key !== RENDERER_ORIGIN_STORAGE_SENTINEL_KEY),
    );
  }

  function readArtifact(filename: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(directory, 'migration', filename), 'utf8'));
  }

  function overwriteArtifact(filename: string, value: unknown): void {
    fs.writeFileSync(path.join(directory, 'migration', filename), JSON.stringify(value));
  }

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-origin-migration-'));
    legacy = new Map([
      ['mesh-client:protocol', 'meshcore'],
      ['mesh-client:lastRead:meshcore', '{"channel":1234}'],
      ['mesh-client:chatMacros', '{"state":{"macros":["snow ☃️ & <script>"]}}'],
    ]);
    target = new Map();
    windows = [];
    importCount = 0;
    failLoad = undefined;
    hangLoad = false;
    failImportAfter = undefined;
    corruptVerify = false;
    seed = vi.fn<WebStorageOriginMigrationOptions['seedDurableStorage']>();
    options = {
      packaged: true,
      userDataPath: directory,
      legacyMigrationUrl: 'file:///dist/renderer/migration.html',
      appVersion: '6.3.0',
      env: {},
      seedDurableStorage: seed,
    };
    electron.createWindow.mockReset().mockImplementation(createWindow);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  describe('explicit local data reset', () => {
    function resetOptions() {
      return {
        userDataPath: directory,
        appVersion: options.appVersion,
        clearSessionStorage: vi.fn(() => {
          legacy.clear();
          target.clear();
          return Promise.resolve();
        }),
        resetDurableStorage: vi.fn(),
      };
    }

    it('replaces the historical baseline only after explicit clear and never restores it on restart', async () => {
      await runWebStorageOriginMigration(options);
      const reset = resetOptions();
      beginRendererStorageReset(options);
      expect(readArtifact(RENDERER_STORAGE_RESET_FILENAME).phase).toBe('pending');
      expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME).keyCount).toBe(3);
      await resumePendingRendererStorageReset(reset);
      expect(reset.clearSessionStorage).toHaveBeenCalledOnce();
      expect(reset.resetDurableStorage).toHaveBeenCalledOnce();
      expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME).entries).toEqual({});
      expect(readArtifact(RENDERER_STORAGE_RESET_FILENAME).phase).toBe('completed');
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(targetEntriesWithoutSentinel()).toEqual({});
      target.clear();
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(targetEntriesWithoutSentinel()).toEqual({});
      expect(legacy.size).toBe(0);

      target.set('new-setting', 'created after reset');
      await resumePendingRendererStorageReset(reset);
      expect(reset.clearSessionStorage).toHaveBeenCalledOnce();
      expect(target.get('new-setting')).toBe('created after reset');
    });

    it('blocks migration and live repair until an interrupted reset has finished', async () => {
      await runWebStorageOriginMigration(options);
      const reset = resetOptions();
      beginRendererStorageReset(options);
      reset.clearSessionStorage.mockRejectedValueOnce(new Error('clear failed'));
      await expect(resumePendingRendererStorageReset(reset)).rejects.toThrow('clear failed');
      expect(reset.resetDurableStorage).not.toHaveBeenCalled();
      expect(await runWebStorageOriginMigration(options)).toBe('failed');
      expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('failed');
      expect(readArtifact(RENDERER_STORAGE_RESET_FILENAME).phase).toBe('pending');
      await resumePendingRendererStorageReset(reset);
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(targetEntriesWithoutSentinel()).toEqual({});
    });

    it.each([ENV_FORCE_FILE_ORIGIN, ENV_SKIP_ORIGIN_MIGRATION])(
      'retries reset before opening legacy storage when %s is enabled',
      async (flag) => {
        await runWebStorageOriginMigration(options);
        const reset = resetOptions();
        beginRendererStorageReset(options);
        reset.resetDurableStorage.mockImplementationOnce(() => {
          throw new Error('database busy');
        });
        await expect(resumePendingRendererStorageReset(reset)).rejects.toThrow('database busy');
        // A partially cleared origin or a late old-process write is cleared again on restart.
        legacy.set('late-old-value', 'must not survive');
        options.env = { [flag]: '1' };
        await resumePendingRendererStorageReset(reset);
        expect(await runWebStorageOriginMigration(options)).toBe('skipped');
        expect(legacy.size).toBe(0);
        expect(target.size).toBe(0);
        options.env = {};
        expect(await runWebStorageOriginMigration(options)).toBe('completed');
        expect(targetEntriesWithoutSentinel()).toEqual({});
      },
    );

    it.each([
      LEGACY_STORAGE_EXPORT_FILENAME,
      RENDERER_ORIGIN_STATE_FILENAME,
      RENDERER_STORAGE_RESET_FILENAME,
    ])('retries destructive clear if committing %s is interrupted', async (filename) => {
      await runWebStorageOriginMigration(options);
      const reset = resetOptions();
      beginRendererStorageReset(options);
      const rename = fs.renameSync;
      vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (String(to).endsWith(filename)) throw new Error('interrupted reset commit');
        rename(from, to);
      });
      await expect(resumePendingRendererStorageReset(reset)).rejects.toThrow('interrupted');
      expect(readArtifact(RENDERER_STORAGE_RESET_FILENAME).phase).toBe('pending');
      vi.restoreAllMocks();
      legacy.set('late-write', 'old');
      target.set('late-write', 'old');
      await resumePendingRendererStorageReset(reset);
      expect(reset.clearSessionStorage).toHaveBeenCalledTimes(2);
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(targetEntriesWithoutSentinel()).toEqual({});
    });

    it('does not clear any storage when persisting the reset intent fails', async () => {
      await runWebStorageOriginMigration(options);
      const original = readArtifact(LEGACY_STORAGE_EXPORT_FILENAME);
      vi.spyOn(fs, 'renameSync').mockImplementation(() => {
        throw new Error('disk full');
      });
      expect(() => {
        beginRendererStorageReset(options);
      }).toThrow('disk full');
      expect(legacy.size).toBe(3);
      expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME)).toEqual(original);
    });

    it.skipIf(process.platform === 'win32')(
      'retries a reset intent that was renamed before its directory flush failed',
      async () => {
        await runWebStorageOriginMigration(options);
        const sync = fs.fsyncSync;
        vi.spyOn(fs, 'fsyncSync').mockImplementation((descriptor) => {
          if (fs.fstatSync(descriptor).isDirectory()) throw new Error('directory flush failed');
          sync(descriptor);
        });
        expect(() => {
          beginRendererStorageReset(options);
        }).toThrow('directory flush failed');
        expect(readArtifact(RENDERER_STORAGE_RESET_FILENAME).phase).toBe('pending');
        expect(await runWebStorageOriginMigration(options)).toBe('failed');
        vi.restoreAllMocks();
        await resumePendingRendererStorageReset(resetOptions());
        expect(await runWebStorageOriginMigration(options)).toBe('completed');
        expect(targetEntriesWithoutSentinel()).toEqual({});
      },
    );

    it('preserves unsupported reset journals and refuses to open their data', async () => {
      await runWebStorageOriginMigration(options);
      const unknown = { formatVersion: 2, phase: 'pending' };
      overwriteArtifact(RENDERER_STORAGE_RESET_FILENAME, unknown);
      const reset = resetOptions();
      await expect(resumePendingRendererStorageReset(reset)).rejects.toThrow('unsupported');
      expect(() => {
        beginRendererStorageReset(options);
      }).toThrow('unsupported');
      expect(reset.clearSessionStorage).not.toHaveBeenCalled();
      expect(await runWebStorageOriginMigration(options)).toBe('failed');
      expect(readArtifact(RENDERER_STORAGE_RESET_FILENAME)).toEqual(unknown);
    });
  });

  it('seeds before import, independently verifies every string, and preserves the legacy copy', async () => {
    legacy.set('__proto__', 'a normal storage key');
    legacy.set('key\u0000with"quotes', '\ud800 lone surrogate / 🛜');
    const original = Object.fromEntries(legacy);
    seed.mockImplementation((entries: WebStorageEntries) => {
      expect(target.size).toBe(0);
      expect(entries).toEqual(original);
      expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).phase).toBe('exported');
    });
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(targetEntriesWithoutSentinel()).toEqual(original);
    expect(Object.fromEntries(legacy)).toEqual(original);
    const state = readArtifact(RENDERER_ORIGIN_STATE_FILENAME);
    const snapshot = readArtifact(LEGACY_STORAGE_EXPORT_FILENAME);
    expect(state.phase).toBe('completed');
    expect(state.completedVersion).toBe(LATEST_RENDERER_ORIGIN_MIGRATION);
    expect(state.exportSha256).toBe(snapshot.sha256);
    expect(JSON.parse(target.get(RENDERER_ORIGIN_STORAGE_SENTINEL_KEY)!)).toEqual({
      version: LATEST_RENDERER_ORIGIN_MIGRATION,
      exportSha256: snapshot.sha256,
    });
    expect(snapshot.entries).toEqual(original);
    expect(snapshot.keyCount).toBe(legacy.size);
    expect(windows.map((window) => window.url)).toEqual([
      RENDERER_MIGRATION_URL,
      options.legacyMigrationUrl,
      RENDERER_MIGRATION_URL,
      RENDERER_MIGRATION_URL,
    ]);
    for (const window of windows) {
      expect(window.options).toEqual({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
        },
      });
      expect(window.destroyed).toBe(true);
    }
    expect(windows[2].webContents.session.flushStorageData).toHaveBeenCalledOnce();
    if (process.platform !== 'win32') {
      expect(
        fs.statSync(path.join(directory, 'migration', LEGACY_STORAGE_EXPORT_FILENAME)).mode & 0o777,
      ).toBe(0o600);
    }
  });

  it('completes a genuinely empty profile only after an independent empty read-back', async () => {
    legacy.clear();
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(windows).toHaveLength(4);
    expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME).keyCount).toBe(0);
  });

  it('preserves target-only keys from an interrupted import and verifies the combined copy', async () => {
    target.set('earlier-attempt-extra', 'keep me');
    target.set('mesh-client:protocol', 'stale incomplete import');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get('earlier-attempt-extra')).toBe('keep me');
    expect(target.get('mesh-client:protocol')).toBe('meshcore');
    expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME).entries).not.toHaveProperty(
      'earlier-attempt-extra',
    );
  });

  it.each([ENV_FORCE_FILE_ORIGIN, ENV_SKIP_ORIGIN_MIGRATION])(
    'skips without touching storage for %s',
    async (flag) => {
      options.env = { [flag]: '1', [ENV_FORCE_ORIGIN_REPAIR]: '1', [ENV_USE_CUSTOM_PROTOCOL]: '1' };
      expect(await runWebStorageOriginMigration(options)).toBe('skipped');
      expect(windows).toHaveLength(0);
      expect(seed).not.toHaveBeenCalled();
      expect(fs.readdirSync(directory)).toEqual([]);
    },
  );

  it('never migrates unpackaged COI tests', async () => {
    options.packaged = false;
    options.env = { [ENV_USE_CUSTOM_PROTOCOL]: '1' };
    expect(await runWebStorageOriginMigration(options)).toBe('skipped');
    expect(windows).toHaveLength(0);
  });

  it('does not accept the development custom-protocol flag as a packaged migration bypass', async () => {
    options.env = { [ENV_USE_CUSTOM_PROTOCOL]: '1' };
    corruptVerify = true;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).completedVersion).toBeUndefined();
  });

  it('retries a partial quota failure and never completes before verification', async () => {
    failImportAfter = 1;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(target.size).toBe(1);
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).completedVersion).toBeUndefined();
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).phase).toBe('exported');
    expect(legacy.size).toBe(3);
    failImportAfter = undefined;
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(targetEntriesWithoutSentinel()).toEqual(Object.fromEntries(legacy));
  });

  it('rejects mismatched read-back even when the import call resolves', async () => {
    corruptVerify = true;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).phase).toBe('imported');
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).completedVersion).toBeUndefined();
    expect(windows.every((window) => window.destroyed)).toBe(true);
    corruptVerify = false;
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
  });

  it.each(['empty', 'fewer', 'different'])(
    'keeps the recovery export if a retry produces %s keys',
    async (variant) => {
      failImportAfter = 0;
      expect(await runWebStorageOriginMigration(options)).toBe('failed');
      const original = readArtifact(LEGACY_STORAGE_EXPORT_FILENAME);
      if (variant === 'empty') legacy.clear();
      if (variant === 'fewer') legacy.delete('mesh-client:protocol');
      if (variant === 'different') {
        legacy.delete('mesh-client:protocol');
        legacy.set('new', 'would hide the missing critical key');
      }
      failImportAfter = undefined;
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME)).toEqual(original);
      expect(targetEntriesWithoutSentinel()).toEqual(original.entries);
    },
  );

  it('uses an existing valid export when the legacy renderer cannot reopen', async () => {
    failImportAfter = 0;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    const original = readArtifact(LEGACY_STORAGE_EXPORT_FILENAME);
    failImportAfter = undefined;
    failLoad = options.legacyMigrationUrl;
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME).sha256).toBe(original.sha256);
  });

  it('does not import if SQLite seeding fails', async () => {
    seed.mockRejectedValue(new Error('SQLITE_FULL'));
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(target.size).toBe(0);
    expect(windows).toHaveLength(2);
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).phase).toBe('exported');
  });

  it('bounds an unresponsive asynchronous durable seed without importing', async () => {
    seed.mockImplementation(() => new Promise<void>(() => {}));
    options.timeoutMs = 10;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(target.size).toBe(0);
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).phase).toBe('exported');
  });

  it('retains its previous recovery file if an atomic replacement fails', async () => {
    failImportAfter = 0;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    const original = readArtifact(LEGACY_STORAGE_EXPORT_FILENAME);
    legacy.set('additional-key', 'new value');
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to).endsWith(LEGACY_STORAGE_EXPORT_FILENAME)) throw new Error('ENOSPC');
      rename(from, to);
    });
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME)).toEqual(original);
    expect(
      fs.readdirSync(path.join(directory, 'migration')).some((name) => name.endsWith('.tmp')),
    ).toBe(false);
  });

  it('does not mark completion when committing the verified state fails', async () => {
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      const value = JSON.parse(fs.readFileSync(from, 'utf8'));
      if (value.phase === 'completed') throw new Error('EACCES');
      rename(from, to);
    });
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).phase).toBe('verified');
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).completedVersion).toBeUndefined();
  });

  it('reads the checked descriptor when the migration pathname is replaced after fstat', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const statePath = path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME);
    const fstat = fs.fstatSync;
    const close = vi.spyOn(fs, 'closeSync');
    const inspected = vi.spyOn(fs, 'fstatSync').mockImplementationOnce((descriptor) => {
      const stats = fstat(descriptor);
      fs.renameSync(statePath, path.join(directory, 'original-state.json'));
      fs.writeFileSync(statePath, 'replacement must not be read');
      return stats;
    });
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(fs.readFileSync(statePath, 'utf8')).toBe('replacement must not be read');
    expect(close).toHaveBeenCalledWith(inspected.mock.calls[0][0]);
    expect(() => fstat(inspected.mock.calls[0][0])).toThrow(/EBADF/);
  });

  it('continues through short reads and growth within the migration file limit', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const statePath = path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME);
    const state = fs.readFileSync(statePath);
    fs.writeFileSync(statePath, '{');
    const fstat = fs.fstatSync;
    vi.spyOn(fs, 'fstatSync').mockImplementationOnce((descriptor) => {
      const stats = fstat(descriptor);
      fs.writeFileSync(statePath, state);
      return stats;
    });
    const read = fs.readSync;
    const reads = vi.spyOn(fs, 'readSync').mockImplementation((descriptor, buffer, readOptions) =>
      read(descriptor, buffer, {
        ...readOptions,
        length: Math.min(readOptions?.length ?? buffer.byteLength, 7),
      }),
    );
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(reads.mock.calls.length).toBeGreaterThan(2);
  });

  it('rejects an oversized open migration file without reading it and closes the descriptor', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const statePath = path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME);
    fs.truncateSync(statePath, 64 * 1024 * 1024 + 1);
    const fstat = fs.fstatSync;
    const inspected = vi.spyOn(fs, 'fstatSync');
    const read = vi.spyOn(fs, 'readSync');
    const close = vi.spyOn(fs, 'closeSync');
    windows = [];
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(windows).toHaveLength(0);
    expect(read).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(inspected.mock.calls[0][0]);
    expect(() => fstat(inspected.mock.calls[0][0])).toThrow(/EBADF/);
  });

  it('reads at most 64 MiB plus one detection byte when an open migration file grows', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const limit = 64 * 1024 * 1024;
    const statePath = path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME);
    const fstat = fs.fstatSync;
    const inspected = vi.spyOn(fs, 'fstatSync').mockImplementationOnce((descriptor) => {
      const stats = fstat(descriptor);
      fs.truncateSync(statePath, limit + 1024);
      return stats;
    });
    const read = fs.readSync;
    let bytesRead = 0;
    vi.spyOn(fs, 'readSync').mockImplementation((descriptor, buffer, readOptions) => {
      const count = read(descriptor, buffer, readOptions);
      bytesRead += count;
      return count;
    });
    const close = vi.spyOn(fs, 'closeSync');
    windows = [];
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(bytesRead).toBe(limit + 1);
    expect(windows).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.any(String),
      'Renderer origin migration file exceeds size limit',
    );
    expect(close).toHaveBeenCalledWith(inspected.mock.calls[0][0]);
    expect(() => fstat(inspected.mock.calls[0][0])).toThrow(/EBADF/);
  });

  it('only treats ENOENT from opening as missing, and closes after a later metadata error', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const fstat = fs.fstatSync;
    const inspected = vi
      .spyOn(fs, 'fstatSync')
      .mockImplementationOnce(() => fs.statSync(path.join(directory, 'nonexistent')));
    const close = vi.spyOn(fs, 'closeSync');
    windows = [];
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(windows).toHaveLength(0);
    expect(close).toHaveBeenCalledWith(inspected.mock.calls[0][0]);
    expect(() => fstat(inspected.mock.calls[0][0])).toThrow(/EBADF/);
  });

  it('closes an opened migration file when reading fails', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const fstat = fs.fstatSync;
    const inspected = vi.spyOn(fs, 'fstatSync');
    vi.spyOn(fs, 'readSync').mockImplementationOnce(() => {
      throw new Error('EIO');
    });
    const close = vi.spyOn(fs, 'closeSync');
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(close).toHaveBeenCalledWith(inspected.mock.calls[0][0]);
    expect(() => fstat(inspected.mock.calls[0][0])).toThrow(/EBADF/);
  });

  it('closes an opened migration file when JSON parsing fails', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    fs.writeFileSync(path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME), '{');
    const fstat = fs.fstatSync;
    const inspected = vi.spyOn(fs, 'fstatSync');
    const close = vi.spyOn(fs, 'closeSync');
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(close).toHaveBeenCalledWith(inspected.mock.calls[0][0]);
    expect(() => fstat(inspected.mock.calls[0][0])).toThrow(/EBADF/);
  });

  it.each(['export checksum', 'export shape', 'state JSON', 'future version'])(
    'fails closed without replacing damaged %s',
    async (variant) => {
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      let filename = LEGACY_STORAGE_EXPORT_FILENAME;
      if (variant === 'export checksum') {
        const snapshot = readArtifact(filename);
        overwriteArtifact(filename, { ...snapshot, sha256: 'bad' });
      } else if (variant === 'export shape') {
        overwriteArtifact(filename, { formatVersion: 1, entries: [] });
      } else {
        filename = RENDERER_ORIGIN_STATE_FILENAME;
        if (variant === 'state JSON')
          fs.writeFileSync(path.join(directory, 'migration', filename), '{');
        else overwriteArtifact(filename, { ...readArtifact(filename), completedVersion: 999 });
      }
      const artifact = fs.readFileSync(path.join(directory, 'migration', filename), 'utf8');
      windows = [];
      expect(await runWebStorageOriginMigration(options)).toBe('failed');
      expect(windows).toHaveLength(0);
      expect(fs.readFileSync(path.join(directory, 'migration', filename), 'utf8')).toBe(artifact);
    },
  );

  it('fails closed when a completed migration lost its export', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    fs.unlinkSync(path.join(directory, 'migration', LEGACY_STORAGE_EXPORT_FILENAME));
    windows = [];
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(windows).toHaveLength(0);
    expect(target.size).toBe(4);
  });

  it('re-verifies surviving marked storage if state disappears, preserving newer values', async () => {
    legacy.set('mesh-client:lastConnection:meshcore', '{"type":"ble"}');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.set('mesh-client:protocol', 'reticulum');
    target.set('mesh-client:lastRead:meshcore', '{"channel":9999}');
    target.delete('mesh-client:lastConnection:meshcore');
    fs.unlinkSync(path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME));
    windows = [];
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(windows).toHaveLength(3);
    expect(windows.every((window) => window.url === RENDERER_MIGRATION_URL)).toBe(true);
    expect(target.get('mesh-client:protocol')).toBe('reticulum');
    expect(target.get('mesh-client:lastRead:meshcore')).toContain('9999');
    expect(target.has('mesh-client:lastConnection:meshcore')).toBe(false);
  });

  it.each(['missing', 'foreign'])(
    'does not invent migration state if marked storage has %s recovery evidence',
    async (variant) => {
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      target.set('mesh-client:protocol', 'reticulum');
      fs.unlinkSync(path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME));
      if (variant === 'missing')
        fs.unlinkSync(path.join(directory, 'migration', LEGACY_STORAGE_EXPORT_FILENAME));
      else target.set(RENDERER_ORIGIN_STORAGE_SENTINEL_KEY, 'foreign');
      expect(await runWebStorageOriginMigration(options)).toBe('failed');
      expect(await runWebStorageOriginMigration(options)).toBe('failed');
      expect(fs.existsSync(path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME))).toBe(
        false,
      );
      expect(target.get('mesh-client:protocol')).toBe('reticulum');
    },
  );

  it('checks completed profiles without replaying stale values or requiring equality', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.set('mesh-client:lastRead:meshcore', '{"channel":9999}');
    target.set('mesh-client:chatMacros', '{"state":{"macros":[]}}');
    target.set('new-setting', 'present');
    windows = [];
    seed.mockClear();
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(windows).toHaveLength(1);
    expect(windows[0].url).toBe(RENDERER_MIGRATION_URL);
    expect(seed).not.toHaveBeenCalled();
    expect(target.get('mesh-client:lastRead:meshcore')).toContain('9999');
    expect(target.get('mesh-client:chatMacros')).toContain('[]');
  });

  it('keeps forgotten connections and deliberately removed keys deleted on relaunch and post-load', async () => {
    legacy.set('mesh-client:lastConnection:meshcore', '{"type":"ble"}');
    legacy.set('mesh-client:lastBleDevice:meshcore', 'old-radio');
    legacy.set('mesh-client:lastSerialPort:meshtastic', 'old-port');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    for (const key of [
      'mesh-client:lastConnection:meshcore',
      'mesh-client:lastBleDevice:meshcore',
      'mesh-client:lastSerialPort:meshtastic',
      'mesh-client:chatMacros',
    ])
      target.delete(key);
    windows = [];
    seed.mockClear();
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    expect(windows).toHaveLength(1);
    expect(seed).not.toHaveBeenCalled();
    expect(target.has('mesh-client:lastConnection:meshcore')).toBe(false);
    expect(target.has('mesh-client:lastBleDevice:meshcore')).toBe(false);
    expect(target.has('mesh-client:lastSerialPort:meshtastic')).toBe(false);
    expect(target.has('mesh-client:chatMacros')).toBe(false);
  });

  it('repairs a fully cleared origin from its recovery export', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.clear();
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(targetEntriesWithoutSentinel()).toEqual(Object.fromEntries(legacy));
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
  });

  it('repairs a foreign migration marker without replacing existing values', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.set(RENDERER_ORIGIN_STORAGE_SENTINEL_KEY, '{"version":1,"exportSha256":"foreign"}');
    target.set('mesh-client:protocol', 'reticulum');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get('mesh-client:protocol')).toBe('reticulum');
    expect(JSON.parse(target.get(RENDERER_ORIGIN_STORAGE_SENTINEL_KEY)!).exportSha256).toBe(
      readArtifact(LEGACY_STORAGE_EXPORT_FILENAME).sha256,
    );
  });

  it('repairs a lost origin marker once and retains newer existing values', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.delete('mesh-client:protocol');
    target.delete(RENDERER_ORIGIN_STORAGE_SENTINEL_KEY);
    target.set('mesh-client:lastRead:meshcore', '{"channel":9999}');
    windows = [];
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(windows).toHaveLength(3);
    expect(target.get('mesh-client:protocol')).toBe('meshcore');
    expect(target.get('mesh-client:lastRead:meshcore')).toContain('9999');
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).hasCompleted).toBe(true);
  });

  it('bounds failed repairs and remembers prior completion across another launch', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.delete('mesh-client:protocol');
    target.delete(RENDERER_ORIGIN_STORAGE_SENTINEL_KEY);
    target.set('mesh-client:lastRead:meshcore', '{"channel":9999}');
    failImportAfter = 0;
    importCount = 0;
    windows = [];
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(windows).toHaveLength(2);
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME)).toMatchObject({
      phase: 'needsRepair',
      hasCompleted: true,
    });
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).completedVersion).toBeUndefined();
    failImportAfter = undefined;
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get('mesh-client:lastRead:meshcore')).toContain('9999');
  });

  it('force repair verifies without overwriting legitimate new-origin updates', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.set('mesh-client:protocol', 'reticulum');
    options.env = { [ENV_FORCE_ORIGIN_REPAIR]: '1' };
    windows = [];
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(windows).toHaveLength(3);
    expect(target.get('mesh-client:protocol')).toBe('reticulum');
  });

  it('times out hung hidden windows and closes them', async () => {
    hangLoad = true;
    options.timeoutMs = 5;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(windows[0].destroyed).toBe(true);
    expect(seed).not.toHaveBeenCalled();
  });

  it('demotes a completed profile if its health renderer fails to load', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    failLoad = RENDERER_MIGRATION_URL;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME)).toMatchObject({
      phase: 'needsRepair',
      hasCompleted: true,
    });
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).completedVersion).toBeUndefined();
  });

  it('re-verifies after a transient health failure without resurrecting deliberately deleted settings', async () => {
    legacy.set('mesh-client:lastConnection:meshcore', '{"type":"ble"}');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.delete('mesh-client:lastConnection:meshcore');
    failLoad = RENDERER_MIGRATION_URL;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    failLoad = undefined;
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.has('mesh-client:lastConnection:meshcore')).toBe(false);
  });

  it('checks the actual loaded main renderer and signals when a repair needs reload', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    target.delete('mesh-client:protocol');
    target.delete(RENDERER_ORIGIN_STORAGE_SENTINEL_KEY);
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('repaired');
    expect(target.get('mesh-client:protocol')).toBe('meshcore');
  });

  it('post-load failures demote completion and never loop repairs', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.clear();
    failImportAfter = 0;
    windows = [];
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('failed');
    expect(windows).toHaveLength(1);
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME)).toMatchObject({
      phase: 'needsRepair',
      hasCompleted: true,
    });
  });

  it('does not replace corrupt recovery state during post-load health failure', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const file = path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME);
    fs.writeFileSync(file, '{');
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('failed');
    expect(fs.readFileSync(file, 'utf8')).toBe('{');
  });
});
