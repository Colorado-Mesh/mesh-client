import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import type { BrowserWindowConstructorOptions, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import joeyPreferences from '../../e2e/fixtures/renderer-preferences.json';
import {
  CRITICAL_LOCALSTORAGE_KEY_PREFIXES,
  ENV_FORCE_FILE_ORIGIN,
  ENV_FORCE_ORIGIN_REPAIR,
  ENV_SKIP_ORIGIN_MIGRATION,
  LATEST_RENDERER_ORIGIN_MIGRATION,
  RENDERER_INDEX_URL,
  RENDERER_MIGRATION_URL,
  RENDERER_STORAGE_DELETION_PREFIX,
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
  let unloadRenderer: ReturnType<typeof vi.fn<() => Promise<void>>>;

  const storageObject = (map: Map<string, string>) => ({
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    removeItem: (key: string) => map.delete(key),
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
    unloadRenderer = vi.fn(async () => {});
    options = {
      userDataPath: directory,
      legacyMigrationUrl: 'file:///dist/renderer/migration.html',
      appVersion: '6.3.0',
      env: {},
      seedDurableStorage: seed,
      commitImportedStorageIntents: vi.fn(),
      unloadRendererBeforeRepair: unloadRenderer,
    };
    electron.createWindow.mockReset().mockImplementation(createWindow);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it.each(['linux', 'darwin', 'win32'])(
    'unloads the live %s renderer and re-snapshots deletion journals and edits before repair',
    async (platform) => {
      const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
      Object.defineProperty(process, 'platform', { value: platform });
      try {
        const key = 'mesh-client:lastConnection:meshcore';
        const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
        legacy.set(key, '{"type":"ble","bleDeviceId":"forgotten"}');
        expect(await runWebStorageOriginMigration(options)).toBe('completed');
        target.delete('mesh-client:protocol');
        let writerActive = true;
        const liveContents = {
          executeJavaScript: vi.fn((script: string) => {
            const captured = execute(script, target);
            // A renderer effect runs after the snapshot was captured, before main can repair.
            queueMicrotask(() => {
              target.delete(key);
              target.set(journal, '1');
              target.set('mesh-client:chatMacros', '{"state":{"macros":["late edit"]}}');
            });
            return Promise.resolve(captured);
          }),
        };
        unloadRenderer.mockImplementation(async () => {
          await Promise.resolve();
          target.set('mesh-client:durablePending:takRelayPrefs', 'final unload journal');
          writerActive = false;
        });
        const repairWhileLive: boolean[] = [];
        seed.mockClear().mockImplementation(() => {
          repairWhileLive.push(writerActive);
        });
        windows = [];

        const health = await checkRendererOriginStorageHealth(options, liveContents);
        expect(target.has(key)).toBe(false);
        expect(target.get(journal)).toBe('1');
        expect(health).toBe('repaired');
        expect(unloadRenderer).toHaveBeenCalledOnce();
        expect(liveContents.executeJavaScript).toHaveBeenCalledOnce();
        expect(repairWhileLive).toEqual([false]);
        expect(target.get('mesh-client:chatMacros')).toBe('{"state":{"macros":["late edit"]}}');
        expect(target.get('mesh-client:durablePending:takRelayPrefs')).toBe('final unload journal');
        expect(seed.mock.calls[0]?.[0][journal]).toBe('1');
        expect(windows.every((window) => window.url === RENDERER_MIGRATION_URL)).toBe(true);
      } finally {
        Object.defineProperty(process, 'platform', platformDescriptor);
      }
    },
  );

  it('retains a late recreation and its journal over an older SQLite deletion during live repair', async () => {
    const key = 'mesh-client:lastConnection:meshcore';
    const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
    legacy.set(key, '{"type":"ble"}');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    options.readStorageDeletionStates = () => ({
      [key]: { deleted: true, applied: {}, imported: {} },
    });
    target.delete(key);
    target.delete('mesh-client:protocol');
    const liveContents = {
      executeJavaScript: vi.fn((script: string) => {
        const captured = execute(script, target);
        queueMicrotask(() => {
          target.set(key, '{"type":"tcp","httpAddress":"recreated"}');
          target.set(journal, '0');
        });
        return Promise.resolve(captured);
      }),
    };
    expect(await checkRendererOriginStorageHealth(options, liveContents)).toBe('repaired');
    expect(unloadRenderer).toHaveBeenCalledOnce();
    expect(target.get(key)).toBe('{"type":"tcp","httpAddress":"recreated"}');
    expect(target.get(journal)).toBe('0');
  });

  it('keeps a healthy live renderer loaded without creating repair windows or seeding', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    windows = [];
    seed.mockClear();
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    expect(unloadRenderer).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
    expect(windows).toHaveLength(0);
  });

  it.each(['missing', 'rejected', 'timeout'])(
    'does not repair live storage when unloading is %s',
    async (failure) => {
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      target.delete('mesh-client:protocol');
      const before = Object.fromEntries(target);
      windows = [];
      seed.mockClear();
      if (failure === 'missing') options.unloadRendererBeforeRepair = undefined;
      else if (failure === 'rejected') unloadRenderer.mockRejectedValue(new Error('ERR_FAILED'));
      else {
        options.timeoutMs = 5;
        unloadRenderer.mockImplementation(() => new Promise<void>(() => {}));
      }
      expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('failed');
      expect(Object.fromEntries(target)).toEqual(before);
      expect(seed).not.toHaveBeenCalled();
      expect(windows).toHaveLength(0);
      expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).phase).toBe('needsRepair');
    },
  );

  it('does not unload or repeat repair when a reloaded renderer is still unhealthy', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.delete('mesh-client:protocol');
    windows = [];
    seed.mockClear();
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget(), false)).toBe(
      'failed',
    );
    expect(unloadRenderer).not.toHaveBeenCalled();
    expect(seed).not.toHaveBeenCalled();
    expect(windows).toHaveLength(0);
  });

  it('does not seed or repair when the fresh unloaded-origin snapshot cannot load', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.delete('mesh-client:protocol');
    const before = Object.fromEntries(target);
    seed.mockClear();
    failLoad = RENDERER_MIGRATION_URL;
    windows = [];
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('failed');
    expect(unloadRenderer).toHaveBeenCalledOnce();
    expect(seed).not.toHaveBeenCalled();
    expect(Object.fromEntries(target)).toEqual(before);
    expect(windows).toHaveLength(1);
    expect(windows[0].destroyed).toBe(true);
  });

  it('recovers missing fields from a richer app-settings export while retaining newer present choices', async () => {
    legacy.set('mesh-client:appSettings', JSON.stringify(joeyPreferences));
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const originalExport = readArtifact(LEGACY_STORAGE_EXPORT_FILENAME);
    target.set('mesh-client:appSettings', '{"autoPruneEnabled":false,"newPreference":"current"}');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const actual = JSON.parse(target.get('mesh-client:appSettings')!);
    for (const [key, value] of Object.entries(joeyPreferences))
      expect(actual[key], key).toEqual(value);
    expect(actual.newPreference).toBe('current');
    expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME)).toEqual(originalExport);
  });

  it('keeps missing nested app fields in an incomplete retry export even when top-level keys survived', async () => {
    legacy.set('mesh-client:appSettings', JSON.stringify(joeyPreferences));
    failImportAfter = 1;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    legacy.set('mesh-client:appSettings', '{"autoPruneEnabled":false,"newPreference":"current"}');
    failImportAfter = undefined;
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const actual = JSON.parse(target.get('mesh-client:appSettings')!);
    for (const [key, value] of Object.entries(joeyPreferences))
      expect(actual[key], key).toEqual(value);
    expect(actual.newPreference).toBe('current');
  });

  it('does not reintroduce deliberately removed app fields after canonical preferences are established', async () => {
    legacy.set('mesh-client:appSettings', JSON.stringify(joeyPreferences));
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.set('mesh-client:appSettings', '{"autoPruneEnabled":false}');
    target.set(
      'mesh-client:rendererPreferences',
      '{"legacyAliasesImported":true,"values":{"mesh-client:appSettings":{"autoPruneEnabled":false}}}',
    );
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(JSON.parse(target.get('mesh-client:appSettings')!)).toEqual({ autoPruneEnabled: false });
  });

  it.each([
    'mesh-client:mqttSettings',
    'mesh-client:mqttSettings:meshcore',
    'mesh-client:reticulumInterfaceProfiles',
    'mesh-client:reticulumRemoteSettings',
    'mesh-client:rrcNickname',
    'mesh-client:rrc:hubAutoJoin',
    'mesh-client:rrc:autoJoin:hub',
    'mesh-client:gpsSettings',
    'mesh-client:themeColors',
  ])('repairs missing exported preference %s before its consumers mount', async (key) => {
    legacy.set(key, 'saved-non-default');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.delete(key);
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get(key)).toBe('saved-non-default');
  });

  it('never revives historical acknowledged write journals during repair while retaining current pending edits', async () => {
    const journalKey = 'mesh-client:durablePending:takRelayPrefs';
    legacy.set(journalKey, 'historical-journal');
    legacy.set('mesh-client:incidentPending', 'historical-incidents');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get(journalKey)).toBe('historical-journal');
    target.delete(journalKey);
    target.delete('mesh-client:incidentPending');
    const originalExport = readArtifact(LEGACY_STORAGE_EXPORT_FILENAME);
    options.env = { [ENV_FORCE_ORIGIN_REPAIR]: '1' };
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.has(journalKey)).toBe(false);
    expect(target.has('mesh-client:incidentPending')).toBe(false);
    target.set(journalKey, 'current-pending');
    target.set('mesh-client:incidentPending', 'current-incidents');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get(journalKey)).toBe('current-pending');
    expect(target.get('mesh-client:incidentPending')).toBe('current-incidents');
    expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME)).toEqual(originalExport);
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
    failImportAfter = 0;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    failImportAfter = undefined;
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
      options.env = { [flag]: '1', [ENV_FORCE_ORIGIN_REPAIR]: '1' };
      expect(await runWebStorageOriginMigration(options)).toBe('skipped');
      expect(windows).toHaveLength(0);
      expect(seed).not.toHaveBeenCalled();
      expect(fs.readdirSync(directory)).toEqual([]);
    },
  );

  it.each(['http://localhost:5173', 'https://localhost:5173', 'file:///e2e/index.html'])(
    'does not migrate or inspect storage for an explicit renderer URL %s',
    async (devServerUrl) => {
      options.devServerUrl = devServerUrl;
      options.env = { [ENV_FORCE_ORIGIN_REPAIR]: '1' };
      const contents = contentsForTarget();
      expect(await runWebStorageOriginMigration(options)).toBe('skipped');
      expect(await checkRendererOriginStorageHealth(options, contents)).toBe('failed');
      expect(contents.executeJavaScript).not.toHaveBeenCalled();
      expect(windows).toHaveLength(0);
      expect(seed).not.toHaveBeenCalled();
      expect(fs.readdirSync(directory)).toEqual([]);
    },
  );

  it.each([
    undefined,
    '',
    RENDERER_INDEX_URL,
    'mesh-client://renderer/index.html?test=1#settings',
    'MESH-CLIENT://renderer/',
  ])('migrates and checks the built renderer with devServerUrl=%s', async (devServerUrl) => {
    options.devServerUrl = devServerUrl;
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(targetEntriesWithoutSentinel()).toEqual(Object.fromEntries(legacy));
    expect(seed).toHaveBeenCalledOnce();
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
  });

  it('fails an explicit custom-origin launch if storage verification fails', async () => {
    options.devServerUrl = RENDERER_INDEX_URL;
    corruptVerify = true;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(seed).toHaveBeenCalledOnce();
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).completedVersion).toBeUndefined();
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('failed');
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
    'keeps the recovery export and merges live values if a retry produces %s keys',
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
      expect(targetEntriesWithoutSentinel()).toEqual({
        ...(original.entries as WebStorageEntries),
        ...Object.fromEntries(legacy),
      });
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
    options.readStorageDeletionStates = () => ({
      'mesh-client:lastConnection:meshcore': { deleted: true, applied: {}, imported: {} },
    });
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
    expect(seed).toHaveBeenCalledExactlyOnceWith(Object.fromEntries(target));
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
    ]) {
      target.delete(key);
      target.set(`${RENDERER_STORAGE_DELETION_PREFIX}${key}`, '1');
    }
    windows = [];
    seed.mockClear();
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    expect(windows).toHaveLength(1);
    expect(seed).toHaveBeenCalledExactlyOnceWith(Object.fromEntries(target));
    expect(target.has('mesh-client:lastConnection:meshcore')).toBe(false);
    expect(target.has('mesh-client:lastBleDevice:meshcore')).toBe(false);
    expect(target.has('mesh-client:lastSerialPort:meshtastic')).toBe(false);
    expect(target.has('mesh-client:chatMacros')).toBe(false);
  });

  it.each(CRITICAL_LOCALSTORAGE_KEY_PREFIXES)(
    'repairs missing exported critical key %s while retaining a valid marker',
    async (key) => {
      legacy.set(key, 'exported critical value');
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      const originalExport = fs.readFileSync(
        path.join(directory, 'migration', LEGACY_STORAGE_EXPORT_FILENAME),
        'utf8',
      );
      target.delete(key);
      target.set('mesh-client:protocol', 'reticulum');
      if (key === 'mesh-client:protocol') target.delete(key);
      expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('repaired');
      expect(target.get(key)).toBe('exported critical value');
      if (key !== 'mesh-client:protocol')
        expect(target.get('mesh-client:protocol')).toBe('reticulum');
      expect(
        fs.readFileSync(path.join(directory, 'migration', LEGACY_STORAGE_EXPORT_FILENAME), 'utf8'),
      ).toBe(originalExport);
      expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    },
  );

  it('honors SQLite deletion intent after total Chromium loss', async () => {
    const key = 'mesh-client:lastConnection:meshcore';
    legacy.set(key, '{"type":"ble","bleDeviceId":"forgotten"}');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    options.readStorageDeletionStates = () => ({
      [key]: { deleted: true, applied: {}, imported: {} },
    });
    target.clear();
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.has(key)).toBe(false);
    expect(target.get(`${RENDERER_STORAGE_DELETION_PREFIX}${key}`)).toBeUndefined();
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
  });

  it('does not replay an exported pending deletion after SQLite acknowledges a recreation', async () => {
    const key = 'mesh-client:lastConnection:meshcore';
    const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
    legacy.set(journal, '1');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const exportPath = path.join(directory, 'migration', LEGACY_STORAGE_EXPORT_FILENAME);
    const originalExport = fs.readFileSync(exportPath, 'utf8');
    expect(JSON.parse(originalExport).entries[journal]).toBe('1');

    // Startup committed the old intent; a later reconnect committed SQLite value '0'.
    target.delete(journal);
    target.set(key, '{"type":"tcp","httpAddress":"new-radio"}');
    options.readStorageDeletionStates = () => ({});
    target.delete('mesh-client:protocol');

    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get(key)).toBe('{"type":"tcp","httpAddress":"new-radio"}');
    expect(target.has(journal)).toBe(false);
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    expect(fs.readFileSync(exportPath, 'utf8')).toBe(originalExport);
  });

  it('does not replay an exported recreation after SQLite acknowledges a deletion', async () => {
    const key = 'mesh-client:lastConnection:meshcore';
    const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
    legacy.set(key, '{"type":"ble","bleDeviceId":"forgotten"}');
    legacy.set(journal, '0');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const exportPath = path.join(directory, 'migration', LEGACY_STORAGE_EXPORT_FILENAME);
    const originalExport = fs.readFileSync(exportPath, 'utf8');
    expect(JSON.parse(originalExport).entries[journal]).toBe('0');

    target.delete(journal);
    target.delete(key);
    options.readStorageDeletionStates = () => ({
      [key]: { deleted: true, applied: {}, imported: {} },
    });
    target.delete('mesh-client:protocol');

    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.has(key)).toBe(false);
    expect(target.has(journal)).toBe(false);
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    expect(target.has(key)).toBe(false);
    expect(fs.readFileSync(exportPath, 'utf8')).toBe(originalExport);
  });

  it.each(['0', '1'])(
    'retains the current pending intent %s over export and SQLite history during repair',
    async (intent) => {
      const key = 'mesh-client:lastConnection:meshcore';
      const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
      legacy.set(key, '{"type":"ble"}');
      legacy.set(journal, intent === '0' ? '1' : '0');
      expect(await runWebStorageOriginMigration(options)).toBe('completed');

      target.set(key, '{"type":"tcp"}');
      target.set(journal, intent);
      options.readStorageDeletionStates = () => ({
        [key]: { deleted: intent === '0', applied: {}, imported: {} },
      });
      target.delete('mesh-client:protocol');

      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(target.get(key)).toBe(intent === '0' ? '{"type":"tcp"}' : undefined);
      expect(target.get(journal)).toBe(intent);
      expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    },
  );

  it('resumes an interrupted first migration after the legacy renderer commits a recreation', async () => {
    const key = 'mesh-client:lastConnection:meshcore';
    const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
    legacy.set(journal, '1');
    seed.mockRejectedValueOnce(new Error('SQLite unavailable'));
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    const exportPath = path.join(directory, 'migration', LEGACY_STORAGE_EXPORT_FILENAME);
    const originalExport = fs.readFileSync(exportPath, 'utf8');

    legacy.delete(journal);
    legacy.set(key, '{"type":"tcp","httpAddress":"recreated-radio"}');
    options.readStorageDeletionStates = () => ({});
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get(key)).toBe('{"type":"tcp","httpAddress":"recreated-radio"}');
    expect(target.has(journal)).toBe(false);
    expect(fs.readFileSync(exportPath, 'utf8')).toBe(originalExport);
  });

  it.each(['0', '1'])(
    'resumes with the live legacy pending intent %s over saved and partially imported journals',
    async (intent) => {
      const key = 'mesh-client:lastConnection:meshcore';
      const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
      const oldIntent = intent === '0' ? '1' : '0';
      legacy.set(key, '{"type":"ble"}');
      legacy.set(journal, oldIntent);
      legacy.set('old-ui-only', 'preserved recovery key');
      seed.mockRejectedValueOnce(new Error('SQLite unavailable'));
      expect(await runWebStorageOriginMigration(options)).toBe('failed');
      const exportPath = path.join(directory, 'migration', LEGACY_STORAGE_EXPORT_FILENAME);
      const originalExport = fs.readFileSync(exportPath, 'utf8');

      legacy.delete('old-ui-only');
      legacy.set(key, '{"type":"tcp"}');
      legacy.set(journal, intent);
      target.set(key, '{"type":"ble"}');
      target.set(journal, oldIntent);
      options.readStorageDeletionStates = () => ({
        [key]: { deleted: intent === '0', applied: {}, imported: {} },
      });

      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(target.get(key)).toBe(intent === '0' ? '{"type":"tcp"}' : undefined);
      expect(target.get(journal)).toBe(intent);
      expect(target.get('old-ui-only')).toBe('preserved recovery key');
      expect(fs.readFileSync(exportPath, 'utf8')).toBe(originalExport);
    },
  );

  it('does not resume historical export intents when live legacy storage is unavailable', async () => {
    const key = 'mesh-client:lastConnection:meshcore';
    const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
    legacy.set(key, '{"type":"ble"}');
    legacy.set(journal, '1');
    seed.mockRejectedValueOnce(new Error('SQLite unavailable'));
    expect(await runWebStorageOriginMigration(options)).toBe('failed');

    failLoad = options.legacyMigrationUrl;
    options.readStorageDeletionStates = () => ({});
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get(key)).toBe('{"type":"ble"}');
    expect(target.has(journal)).toBe(false);
  });

  it.each(['0', '1'])(
    'does not replay a consumed legacy file-origin intent %s over newer SQLite state',
    async (intent) => {
      const key = 'mesh-client:lastConnection:meshcore';
      const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
      legacy.set(key, '{"type":"ble"}');
      expect(await runWebStorageOriginMigration(options)).toBe('completed');

      // File-origin storage is retained after the flip; its consumed marker may survive
      // there or in a copied renderer cache after the custom origin changes this key.
      legacy.set(journal, intent);
      target.set(journal, intent);
      target.set(key, '{"type":"tcp","httpAddress":"new-radio"}');
      Object.assign(options, {
        readStorageDeletionStates: () => ({
          [key]: {
            deleted: intent === '0',
            applied: { 'file:': `legacy:${intent}` },
            imported: {},
          },
        }),
      });
      target.delete('mesh-client:protocol');

      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(target.get(key)).toBe(
        intent === '0' ? undefined : '{"type":"tcp","httpAddress":"new-radio"}',
      );
      expect(legacy.get(journal)).toBe(intent);
      expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    },
  );

  it.each([false, true])(
    'honors a new pending JSON intent with deleted=%s after an older receipt from that origin',
    async (deleted) => {
      const key = 'mesh-client:lastConnection:meshcore';
      const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
      legacy.set(key, '{"type":"ble"}');
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      target.set(key, '{"type":"tcp"}');
      target.set(journal, JSON.stringify({ id: 'new-intent', origin: 'file:', deleted }));
      Object.assign(options, {
        readStorageDeletionStates: () => ({
          [key]: { deleted: !deleted, applied: { 'file:': 'previous-intent' }, imported: {} },
        }),
      });
      target.delete('mesh-client:protocol');

      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(target.get(key)).toBe(deleted ? undefined : '{"type":"tcp"}');
      expect(JSON.parse(target.get(journal)!)).toEqual({
        id: 'new-intent',
        origin: 'file:',
        deleted,
      });
      expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    },
  );

  it('pins an imported receipt before the first renderer flush and keeps it after a newer file edit', async () => {
    const key = 'mesh-client:lastConnection:meshcore';
    const journal = `${RENDERER_STORAGE_DELETION_PREFIX}${key}`;
    const intent = { id: 'import-A', origin: 'file:', deleted: true };
    const raw = JSON.stringify(intent);
    legacy.set(key, '{"type":"ble"}');
    legacy.set(journal, raw);
    let state = {
      deleted: false,
      applied: {} as Record<string, string>,
      imported: {} as Record<string, string>,
    };
    options.readStorageDeletionStates = () => ({ [key]: state });
    const commit = vi.fn(() => {
      state = {
        deleted: true,
        applied: { 'file:': 'import-A' },
        imported: { 'file:': 'import-A' },
      };
    });
    options.commitImportedStorageIntents = commit;
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(commit).toHaveBeenCalledExactlyOnceWith({ [key]: intent });
    expect(commit.mock.invocationCallOrder[0]).toBeLessThan(seed.mock.invocationCallOrder[0]);
    expect(target.get(journal)).toBe(raw);
    expect(state.imported['file:']).toBe('import-A');

    // No target renderer flush has consumed the copied A journal. The file renderer's
    // newer B updates its last-applied receipt while the imported A receipt stays pinned.
    state = { deleted: false, applied: { 'file:': 'later-B' }, imported: { 'file:': 'import-A' } };
    target.set(key, '{"type":"tcp","httpAddress":"recreated"}');
    target.delete('mesh-client:protocol');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get(key)).toBe('{"type":"tcp","httpAddress":"recreated"}');
    expect(commit).toHaveBeenCalledOnce();
    expect(legacy.get(journal)).toBe(raw);
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
  });

  it('does not copy a live source journal when its durable imported receipt cannot commit', async () => {
    legacy.set(`${RENDERER_STORAGE_DELETION_PREFIX}mesh-client:lastConnection:meshcore`, '1');
    options.commitImportedStorageIntents = vi.fn(() => {
      throw new Error('receipt commit failed');
    });
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(target.size).toBe(0);
    expect(seed).not.toHaveBeenCalled();
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).phase).toBe('exported');
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).completedVersion).toBeUndefined();
  });

  it('finishes an acknowledged Forget before opening a stale origin with the old connection still present', async () => {
    const key = 'mesh-client:lastConnection:meshcore';
    legacy.set(key, '{"type":"ble"}');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    options.readStorageDeletionStates = () => ({
      [key]: { deleted: true, applied: {}, imported: {} },
    });
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.has(key)).toBe(false);
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
  });

  it.each([{}, { [ENV_FORCE_ORIGIN_REPAIR]: '1' }])(
    'exports legacy data and repairs an untracked nonempty origin with env=%j',
    async (env) => {
      options.env = env;
      target.set('mesh-client:protocol', 'reticulum');
      target.set('target-only', 'keep existing custom value');
      const originalLegacy = Object.fromEntries(legacy);
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(target.get('mesh-client:protocol')).toBe('reticulum');
      expect(target.get('target-only')).toBe('keep existing custom value');
      expect(target.get('mesh-client:chatMacros')).toBe(legacy.get('mesh-client:chatMacros'));
      expect(Object.fromEntries(legacy)).toEqual(originalLegacy);
      expect(readArtifact(LEGACY_STORAGE_EXPORT_FILENAME).entries).toEqual(originalLegacy);
      expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME)).toMatchObject({
        phase: 'completed',
        hasCompleted: true,
        completedVersion: LATEST_RENDERER_ORIGIN_MIGRATION,
      });
      expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    },
  );

  it('repairs untracked storage from an existing export without replacing its baseline', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const file = path.join(directory, 'migration', LEGACY_STORAGE_EXPORT_FILENAME);
    const originalExport = fs.readFileSync(file, 'utf8');
    fs.unlinkSync(path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME));
    target.delete(RENDERER_ORIGIN_STORAGE_SENTINEL_KEY);
    target.set('mesh-client:protocol', 'reticulum');
    legacy.set('mesh-client:protocol', 'meshtastic');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get('mesh-client:protocol')).toBe('reticulum');
    expect(fs.readFileSync(file, 'utf8')).toBe(originalExport);
  });

  it('preserves untracked data and creates no state if the missing legacy export cannot be read', async () => {
    target.set('mesh-client:protocol', 'reticulum');
    const originalTarget = Object.fromEntries(target);
    failLoad = options.legacyMigrationUrl;
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(Object.fromEntries(target)).toEqual(originalTarget);
    expect(seed).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(directory, 'migration'))).toBe(false);
  });

  it('keeps untracked data untouched if its recovery export cannot be committed', async () => {
    target.set('mesh-client:protocol', 'reticulum');
    const originalTarget = Object.fromEntries(target);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('disk write failed');
    });
    expect(await runWebStorageOriginMigration(options)).toBe('failed');
    expect(Object.fromEntries(target)).toEqual(originalTarget);
    expect(seed).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME))).toBe(
      false,
    );
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get('mesh-client:protocol')).toBe('reticulum');
  });

  it.each(['seed', 'import', 'verification'])(
    'retains untracked-origin precedence after interrupted %s and retry',
    async (failure) => {
      target.set('mesh-client:protocol', 'reticulum');
      target.set('target-only', 'retain this');
      if (failure === 'seed')
        seed.mockImplementationOnce(() => {
          throw new Error('database seed failed');
        });
      else if (failure === 'import') failImportAfter = 1;
      else
        seed.mockImplementationOnce(() => {
          corruptVerify = true;
        });
      expect(await runWebStorageOriginMigration(options)).toBe('failed');
      expect(target.get('mesh-client:protocol')).toBe('reticulum');
      expect(target.get('target-only')).toBe('retain this');
      expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).hasCompleted).toBe(true);
      failImportAfter = undefined;
      corruptVerify = false;
      expect(await runWebStorageOriginMigration(options)).toBe('completed');
      expect(target.get('mesh-client:protocol')).toBe('reticulum');
      expect(target.get('target-only')).toBe('retain this');
      expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
    },
  );

  it('does not replay a legacy deletion journal over an untracked custom-origin value', async () => {
    const key = 'mesh-client:lastConnection:meshcore';
    legacy.set(`${RENDERER_STORAGE_DELETION_PREFIX}${key}`, '1');
    target.set(key, 'current custom connection');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get(key)).toBe('current custom connection');
    expect(options.commitImportedStorageIntents).not.toHaveBeenCalled();
  });

  it('does not repair twice when the reloaded actual document still loses critical storage', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    // Prefer a non-preference critical key: once the preference map is established, missing
    // preference keys are intentional and reconciled from SQLite rather than re-repaired.
    target.delete('mesh-client:lastRead:meshcore');
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('repaired');
    target.delete('mesh-client:lastRead:meshcore');
    windows = [];
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget(), false)).toBe(
      'failed',
    );
    expect(windows).toHaveLength(0);
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).phase).toBe('needsRepair');
  });

  it('preserves ambiguous newer values when both state and marker disappear', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.set('mesh-client:protocol', 'reticulum');
    target.delete(RENDERER_ORIGIN_STORAGE_SENTINEL_KEY);
    fs.unlinkSync(path.join(directory, 'migration', RENDERER_ORIGIN_STATE_FILENAME));
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get('mesh-client:protocol')).toBe('reticulum');
    expect(readArtifact(RENDERER_ORIGIN_STATE_FILENAME).hasCompleted).toBe(true);
    options.env = { [ENV_FORCE_ORIGIN_REPAIR]: '1' };
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get('mesh-client:protocol')).toBe('reticulum');
  });

  it('repairs a fully cleared origin from its recovery export', async () => {
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.clear();
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    const restored = targetEntriesWithoutSentinel();
    expect(restored).toMatchObject(Object.fromEntries(legacy));
    const preferencesRaw = restored['mesh-client:rendererPreferences'];
    expect(typeof preferencesRaw).toBe('string');
    if (typeof preferencesRaw !== 'string') throw new Error('missing rebuilt preferences');
    expect(JSON.parse(preferencesRaw).values).toMatchObject({
      'mesh-client:protocol': 'meshcore',
      'mesh-client:chatMacros': legacy.get('mesh-client:chatMacros'),
    });
    expect(await checkRendererOriginStorageHealth(options, contentsForTarget())).toBe('healthy');
  });

  it('repairs exported preferences after an empty clear() preference envelope', async () => {
    legacy.set('mesh-client:origin-e2e-marker', 'original profile');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    for (const key of [...target.keys()]) {
      if (key !== RENDERER_ORIGIN_STORAGE_SENTINEL_KEY) target.delete(key);
    }
    target.set(
      'mesh-client:rendererPreferences',
      JSON.stringify({ legacyAliasesImported: true, values: {} }),
    );
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get('mesh-client:origin-e2e-marker')).toBe('original profile');
    expect(
      JSON.parse(target.get('mesh-client:rendererPreferences')!).values[
        'mesh-client:origin-e2e-marker'
      ],
    ).toBe('original profile');
  });

  it('repairs export markers into an established clear() write-through preference map', async () => {
    legacy.set('mesh-client:origin-e2e-marker', 'original profile');
    legacy.set('mesh-client:themeColor', 'export-stale');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    target.delete(RENDERER_ORIGIN_STORAGE_SENTINEL_KEY);
    target.delete('mesh-client:origin-e2e-marker');
    // Drop the live top-level cache so themeColor exists only in the current map; the export
    // still has a conflicting top-level scalar that must not win.
    target.delete('mesh-client:themeColor');
    // Live clear() + preference persistence rewrites a nonempty map without export-only keys.
    target.set(
      'mesh-client:rendererPreferences',
      JSON.stringify({
        legacyAliasesImported: true,
        values: {
          'mesh-client:protocol': 'meshcore',
          'mesh-client:fontScale': '1',
          'mesh-client:themeColor': 'current-map-only',
        },
      }),
    );
    target.set('mesh-client:protocol', 'meshcore');
    target.set('mesh-client:fontScale', '1');
    expect(await runWebStorageOriginMigration(options)).toBe('completed');
    expect(target.get('mesh-client:origin-e2e-marker')).toBe('original profile');
    expect(
      JSON.parse(target.get('mesh-client:rendererPreferences')!).values[
        'mesh-client:origin-e2e-marker'
      ],
    ).toBe('original profile');
    expect(JSON.parse(target.get('mesh-client:rendererPreferences')!).values).toMatchObject({
      'mesh-client:protocol': 'meshcore',
      'mesh-client:fontScale': '1',
      'mesh-client:themeColor': 'current-map-only',
    });
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
    options.readStorageDeletionStates = () => ({
      'mesh-client:lastConnection:meshcore': { deleted: true, applied: {}, imported: {} },
    });
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
    expect(windows).toHaveLength(2);
    expect(unloadRenderer).toHaveBeenCalledOnce();
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
