import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDurableRendererSetting } from './durableRendererSetting';
import { mockConsoleWarn } from './vitestConsoleMock';

const LOCAL_KEY = 'mesh-client:test-durable';
const DB_KEY = 'testDurable';

describe('durable renderer settings', () => {
  let database: Record<string, string>;

  beforeEach(() => {
    vi.mocked(window.electronAPI.appSettings.set).mockReset();
    vi.mocked(window.electronAPI.appSettings.getAll).mockReset();
    localStorage.clear();
    database = {};
    vi.spyOn(window.electronAPI.appSettings, 'set').mockImplementation((key, value) => {
      database[key] = value;
      return Promise.resolve({ changes: 1 });
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(['linux', 'darwin', 'win32'] as const)(
    'seeds once and restores a wiped cache on %s',
    async (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      localStorage.setItem(LOCAL_KEY, '{"read":12}');
      const first = createDurableRendererSetting(LOCAL_KEY, DB_KEY);
      await first.hydrate(database);
      expect(database[DB_KEY]).toBe('{"read":12}');
      first.write('{"read":20}');
      await first.flush();
      localStorage.clear();
      const restored = createDurableRendererSetting(LOCAL_KEY, DB_KEY);
      await restored.hydrate(database);
      expect(restored.read()).toBe('{"read":20}');
    },
  );

  it('uses the canonical DB value rather than a stale cache without edits', async () => {
    localStorage.setItem(LOCAL_KEY, '{"read":10}');
    database[DB_KEY] = '{"read":20}';
    const setting = createDurableRendererSetting(LOCAL_KEY, DB_KEY);
    await setting.hydrate(database);
    expect(setting.read()).toBe('{"read":20}');
    expect(window.electronAPI.appSettings.set).not.toHaveBeenCalled();
  });

  it('replays edits during hydration while retaining unrelated DB entries and deletions', async () => {
    localStorage.setItem(LOCAL_KEY, '{"a":{"remove":1,"keep":2}}');
    database[DB_KEY] = '{"a":{"remove":1,"keep":4,"new":3},"b":7}';
    const setting = createDurableRendererSetting(LOCAL_KEY, DB_KEY);
    setting.write('{"a":{"keep":2,"added":9}}');
    expect(window.electronAPI.appSettings.set).not.toHaveBeenCalled();
    await setting.hydrate(database);
    expect(JSON.parse(database[DB_KEY])).toEqual({ a: { keep: 4, new: 3, added: 9 }, b: 7 });
  });

  it('serializes writes and drains edits received while a write is in flight', async () => {
    database[DB_KEY] = '{}';
    const setting = createDurableRendererSetting(LOCAL_KEY, DB_KEY);
    await setting.hydrate(database);
    let release!: () => void;
    vi.mocked(window.electronAPI.appSettings.set).mockImplementationOnce(async (key, value) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      database[key] = value;
      return Promise.resolve({ changes: 1 });
    });
    setting.write('{"read":1}');
    setting.write('{"read":2}');
    setting.write('{"read":3}');
    expect(window.electronAPI.appSettings.set).toHaveBeenCalledTimes(1);
    release();
    await setting.flush();
    expect(database[DB_KEY]).toBe('{"read":3}');
    expect(window.electronAPI.appSettings.set).toHaveBeenCalledTimes(2);
  });

  it('recovers a rejected write after relaunch without losing newly durable fields', async () => {
    const warn = mockConsoleWarn();
    database[DB_KEY] = '{"a":1,"remove":2}';
    const setting = createDurableRendererSetting(LOCAL_KEY, DB_KEY);
    await setting.hydrate(database);
    vi.mocked(window.electronAPI.appSettings.set).mockRejectedValueOnce(new Error('busy'));
    setting.write('{"a":3}');
    await setting.flush();
    expect(JSON.parse(setting.read()!)).toEqual({ a: 3 });
    database[DB_KEY] = '{"a":1,"remove":2,"b":4}';
    const relaunched = createDurableRendererSetting(LOCAL_KEY, DB_KEY);
    await relaunched.hydrate(database);
    expect(JSON.parse(database[DB_KEY])).toEqual({ a: 3, b: 4 });
    expect(localStorage.getItem(`mesh-client:durablePending:${DB_KEY}`)).toBeNull();
    warn.restore();
  });

  it('keeps SQLite hydration and writes usable when localStorage cannot be written', async () => {
    const warn = mockConsoleWarn();
    database[DB_KEY] = '{"read":20}';
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const setting = createDurableRendererSetting(LOCAL_KEY, DB_KEY);
    let applied: string | null = null;
    await setting.hydrate(database, () => {
      applied = setting.read();
    });
    expect(applied).toBe('{"read":20}');
    expect(setting.read()).toBe('{"read":20}');
    setting.write('{"read":30}');
    await setting.flush();
    expect(database[DB_KEY]).toBe('{"read":30}');
    warn.restore();
  });

  it('does not replace malformed durable JSON with an empty cache', async () => {
    database[DB_KEY] = 'broken';
    const setting = createDurableRendererSetting(LOCAL_KEY, DB_KEY);
    await expect(setting.hydrate(database)).rejects.toThrow();
    setting.write('{"read":30}');
    await setting.flush();
    expect(database[DB_KEY]).toBe('broken');
    expect(window.electronAPI.appSettings.set).not.toHaveBeenCalled();
  });
});
