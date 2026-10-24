import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RENDERER_STORAGE_DELETION_PREFIX as LOCAL,
  RENDERER_STORAGE_DELETION_SETTING_PREFIX as DB,
} from '@/shared/rendererOrigin';
import {
  parseRendererStorageDeletionState,
  parseRendererStorageIntent,
  type PendingRendererStorageIntent,
} from '@/shared/rendererStorageIntent';

import { createRendererStorage } from './rendererStorage';
import { mockConsoleWarn } from './vitestConsoleMock';

const KEY = 'mesh-client:lastConnection:meshcore';
const FILE_ORIGIN = 'file:';
const CUSTOM_ORIGIN = 'mesh-client://renderer';

function memoryStorage(entries: Iterable<readonly [string, string]> = []) {
  const values = new Map(entries);
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

function profile() {
  const settings: Record<string, string> = {};
  let nextId = 0;
  const read = vi.fn(() => Promise.resolve({ ...settings }));
  const write = vi.fn((key: string, value: string): Promise<unknown> => {
    settings[key] = value;
    return Promise.resolve({ changes: 1 });
  });
  function renderer(origin: string, storage = memoryStorage()) {
    return {
      storage,
      ...createRendererStorage({
        storage,
        origin: () => origin,
        createId: () => `intent-${++nextId}`,
        readSettings: read,
        writeSetting: write,
      }),
    };
  }
  return { settings, read, write, renderer };
}

function journal(storage: ReturnType<typeof memoryStorage>): PendingRendererStorageIntent {
  return parseRendererStorageIntent(storage.getItem(LOCAL + KEY)!);
}

function canonical(state: ReturnType<typeof profile>) {
  return parseRendererStorageDeletionState(state.settings[DB + KEY]);
}

describe('intentional renderer storage deletions', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('does not read SQLite when there are no pending intents', async () => {
    const state = profile();
    await state.renderer(CUSTOM_ORIGIN).flushRendererStorageDeletions();
    expect(state.read).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });

  it('consumes a pre-save credential journal without undoing a newer native retirement', async () => {
    const state = profile();
    const key = 'mesh-client:credentialCompatibility:mqtt:meshcore';
    const native = { deleted: true, applied: {}, imported: {}, secretRevision: 'native-new' };
    state.settings[DB + key] = JSON.stringify(native);
    const storage = memoryStorage([
      [key, 'old-password'],
      [
        LOCAL + key,
        JSON.stringify({
          id: 'old-outage-write',
          origin: CUSTOM_ORIGIN,
          deleted: false,
          secretRevision: 'native-old',
        }),
      ],
    ]);
    const renderer = state.renderer(CUSTOM_ORIGIN, storage);
    await renderer.flushRendererStorageDeletions();
    expect(JSON.parse(state.settings[DB + key])).toEqual(native);
    expect(storage.getItem(key)).toBeNull();
    expect(storage.getItem(LOCAL + key)).toBeNull();
    expect(state.write).not.toHaveBeenCalled();
    renderer.setRendererStorageItem(key, 'new-outage-edit', 'new-intent', 'native-new');
    await renderer.flushRendererStorageDeletions();
    expect(JSON.parse(state.settings[DB + key])).toMatchObject({
      deleted: false,
      secretRevision: 'native-new',
      applied: { [CUSTOM_ORIGIN]: 'new-intent' },
    });
    expect(storage.getItem(key)).toBe('new-outage-edit');
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'commits the canonical flag and receipt atomically for Forget and recreation on %s',
    async () => {
      const state = profile();
      const renderer = state.renderer(CUSTOM_ORIGIN);
      renderer.storage.setItem(KEY, 'old connection');
      renderer.removeRendererStorageItem(KEY);
      const deletion = journal(renderer.storage);
      expect(renderer.storage.getItem(KEY)).toBeNull();
      await renderer.flushRendererStorageDeletions();
      expect(canonical(state)).toEqual({
        deleted: true,
        applied: { [CUSTOM_ORIGIN]: deletion.id },
        imported: {},
      });
      expect(renderer.storage.getItem(LOCAL + KEY)).toBeNull();
      renderer.setRendererStorageItem(KEY, 'new connection');
      const recreation = journal(renderer.storage);
      await renderer.flushRendererStorageDeletions();
      expect(canonical(state)).toEqual({
        deleted: false,
        applied: { [CUSTOM_ORIGIN]: recreation.id },
        imported: {},
      });
      expect(renderer.storage.getItem(KEY)).toBe('new connection');
      expect(renderer.storage.getItem(LOCAL + KEY)).toBeNull();
      expect(state.write).toHaveBeenCalledTimes(2);
      for (const [, raw] of state.write.mock.calls) {
        expect(parseRendererStorageDeletionState(raw).applied[CUSTOM_ORIGIN]).toBeTruthy();
      }
    },
  );

  it('retains the same intent on a failed write and commits it on retry', async () => {
    mockConsoleWarn();
    const state = profile();
    const renderer = state.renderer(CUSTOM_ORIGIN);
    state.write.mockRejectedValueOnce(new Error('DB offline'));
    renderer.removeRendererStorageItem(KEY);
    const deletion = journal(renderer.storage);
    await renderer.flushRendererStorageDeletions();
    expect(journal(renderer.storage)).toEqual(deletion);
    expect(state.settings[DB + KEY]).toBeUndefined();
    await renderer.flushRendererStorageDeletions();
    expect(canonical(state).applied[CUSTOM_ORIGIN]).toBe(deletion.id);
    expect(renderer.storage.getItem(LOCAL + KEY)).toBeNull();
  });

  it('keeps pending intent untouched when the canonical read fails', async () => {
    mockConsoleWarn();
    const state = profile();
    const renderer = state.renderer(CUSTOM_ORIGIN);
    state.read.mockRejectedValueOnce(new Error('DB offline'));
    renderer.removeRendererStorageItem(KEY);
    const deletion = journal(renderer.storage);
    await renderer.flushRendererStorageDeletions();
    expect(journal(renderer.storage)).toEqual(deletion);
    expect(state.write).not.toHaveBeenCalled();
    await renderer.flushRendererStorageDeletions();
    expect(canonical(state).applied[CUSTOM_ORIGIN]).toBe(deletion.id);
  });

  it('does not overwrite malformed canonical data', async () => {
    mockConsoleWarn();
    const state = profile();
    state.settings[DB + KEY] = '{invalid';
    const renderer = state.renderer(CUSTOM_ORIGIN);
    renderer.removeRendererStorageItem(KEY);
    const deletion = journal(renderer.storage);
    await renderer.flushRendererStorageDeletions();
    expect(state.settings[DB + KEY]).toBe('{invalid');
    expect(state.write).not.toHaveBeenCalled();
    expect(journal(renderer.storage)).toEqual(deletion);
  });

  it('preserves a malformed journal while replaying another valid pending key', async () => {
    mockConsoleWarn();
    const state = profile();
    const malformedKey = 'mesh-client:lastBleDevice:meshcore';
    const storage = memoryStorage([
      [LOCAL + malformedKey, '{invalid'],
      [LOCAL + KEY, '1'],
    ]);
    await state.renderer(CUSTOM_ORIGIN, storage).flushRendererStorageDeletions();
    expect(storage.getItem(LOCAL + malformedKey)).toBe('{invalid');
    expect(storage.getItem(LOCAL + KEY)).toBeNull();
    expect(canonical(state).deleted).toBe(true);
    expect(state.settings[DB + malformedKey]).toBeUndefined();
  });

  it('does not let an earlier in-flight delete remove a later recreation', async () => {
    const state = profile();
    const renderer = state.renderer(CUSTOM_ORIGIN);
    let complete!: () => void;
    state.write.mockImplementationOnce(
      (key, raw) =>
        new Promise<void>((resolve) => {
          complete = () => {
            state.settings[key] = raw;
            resolve();
          };
        }),
    );
    renderer.removeRendererStorageItem(KEY);
    await vi.waitFor(() => {
      expect(state.write).toHaveBeenCalledOnce();
    });
    renderer.setRendererStorageItem(KEY, 'recreated');
    const recreation = journal(renderer.storage);
    complete();
    await renderer.flushRendererStorageDeletions();
    expect(canonical(state)).toEqual({
      deleted: false,
      applied: { [CUSTOM_ORIGIN]: recreation.id },
      imported: {},
    });
    expect(renderer.storage.getItem(KEY)).toBe('recreated');
    expect(state.read).toHaveBeenCalledOnce();
  });

  it.each(['0', '1'])('recovers legacy pending intent %s after restart', async (raw) => {
    const state = profile();
    const storage = memoryStorage([
      [LOCAL + KEY, raw],
      [KEY, 'cached connection'],
    ]);
    await state.renderer(CUSTOM_ORIGIN, storage).flushRendererStorageDeletions();
    expect(canonical(state)).toEqual({
      deleted: raw === '1',
      applied: { [FILE_ORIGIN]: `legacy:${raw}` },
      imported: {},
    });
    expect(storage.getItem(LOCAL + KEY)).toBeNull();
    expect(storage.getItem(KEY)).toBe(raw === '1' ? null : 'cached connection');
  });

  it('waits for SQLite when quota prevents the local journal, including a failed first attempt', async () => {
    mockConsoleWarn();
    const state = profile();
    const renderer = state.renderer(CUSTOM_ORIGIN);
    renderer.storage.setItem(KEY, 'existing connection');
    renderer.storage.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    state.write.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    renderer.removeRendererStorageItem(KEY);
    await renderer.flushRendererStorageDeletions();
    expect(renderer.storage.getItem(KEY)).toBe('existing connection');
    await renderer.flushRendererStorageDeletions();
    expect(renderer.storage.getItem(KEY)).toBeNull();
    expect(canonical(state).deleted).toBe(true);
  });

  it('retains committed intent for cleanup retry if the local removal fails', async () => {
    mockConsoleWarn();
    const state = profile();
    const storage = memoryStorage([
      [KEY, 'existing connection'],
      [LOCAL + KEY, '1'],
    ]);
    storage.removeItem.mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    });
    const renderer = state.renderer(CUSTOM_ORIGIN, storage);
    await renderer.flushRendererStorageDeletions();
    expect(storage.getItem(KEY)).toBe('existing connection');
    expect(storage.getItem(LOCAL + KEY)).toBe('1');
    await renderer.flushRendererStorageDeletions();
    expect(storage.getItem(KEY)).toBeNull();
    expect(storage.getItem(LOCAL + KEY)).toBeNull();
    expect(state.write).toHaveBeenCalledOnce();
  });

  it('does not replay a file intent consumed during cutover after custom recreation and force-file recovery', async () => {
    mockConsoleWarn();
    const state = profile();
    const file = state.renderer(FILE_ORIGIN);
    file.storage.setItem(KEY, 'old BLE connection');
    state.write.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    file.removeRendererStorageItem(KEY);
    await file.flushRendererStorageDeletions();
    const sourceIntent = journal(file.storage);
    // The verified origin copy includes the live pending journal; the source stays untouched.
    // Main commits the receipt before the first custom document can start or crash.
    state.settings[DB + KEY] = JSON.stringify({
      deleted: true,
      applied: { [FILE_ORIGIN]: sourceIntent.id },
      imported: { [FILE_ORIGIN]: sourceIntent.id },
    });
    const custom = state.renderer(CUSTOM_ORIGIN, memoryStorage(file.storage.values));
    await custom.flushRendererStorageDeletions();
    expect(file.storage.getItem(LOCAL + KEY)).not.toBeNull();
    expect(custom.storage.getItem(LOCAL + KEY)).toBeNull();
    custom.setRendererStorageItem(KEY, 'NEW TCP connection');
    const recreation = journal(custom.storage);
    await custom.flushRendererStorageDeletions();
    const expected = {
      deleted: false,
      applied: { [FILE_ORIGIN]: sourceIntent.id, [CUSTOM_ORIGIN]: recreation.id },
      imported: { [FILE_ORIGIN]: sourceIntent.id },
    };
    expect(canonical(state)).toEqual(expected);
    const writes = state.write.mock.calls.length;
    await state.renderer(FILE_ORIGIN, file.storage).flushRendererStorageDeletions();
    expect(canonical(state)).toEqual(expected);
    expect(state.write).toHaveBeenCalledTimes(writes);
    expect(file.storage.getItem(LOCAL + KEY)).toBeNull();
    await state.renderer(CUSTOM_ORIGIN, custom.storage).flushRendererStorageDeletions();
    expect(custom.storage.getItem(KEY)).toBe('NEW TCP connection');
    expect(canonical(state)).toEqual(expected);
  });

  it.each(['before custom startup', 'during custom cleanup'])(
    'retains the imported receipt after a newer file-origin edit and a crash %s',
    async (interruption) => {
      mockConsoleWarn();
      const state = profile();
      const imported: PendingRendererStorageIntent = {
        id: 'imported-file-delete',
        origin: FILE_ORIGIN,
        deleted: true,
      };
      const fileStorage = memoryStorage([[LOCAL + KEY, JSON.stringify(imported)]]);
      const customStorage = memoryStorage(fileStorage.values);
      state.settings[DB + KEY] = JSON.stringify({
        deleted: true,
        applied: { [FILE_ORIGIN]: imported.id },
        imported: { [FILE_ORIGIN]: imported.id },
      });
      if (interruption === 'during custom cleanup') {
        customStorage.removeItem.mockImplementation((key) => {
          if (key === LOCAL + KEY) throw new Error('Storage unavailable');
          customStorage.values.delete(key);
        });
        await state.renderer(CUSTOM_ORIGIN, customStorage).flushRendererStorageDeletions();
        customStorage.removeItem.mockImplementation((key) => {
          customStorage.values.delete(key);
        });
      }
      expect(journal(customStorage)).toEqual(imported);
      const file = state.renderer(FILE_ORIGIN, fileStorage);
      await file.flushRendererStorageDeletions();
      file.setRendererStorageItem(KEY, 'new recovery connection');
      const newer = journal(fileStorage);
      await file.flushRendererStorageDeletions();
      expect(canonical(state)).toEqual({
        deleted: false,
        applied: { [FILE_ORIGIN]: newer.id },
        imported: { [FILE_ORIGIN]: imported.id },
      });
      const committed = state.settings[DB + KEY];
      const writes = state.write.mock.calls.length;
      await state.renderer(CUSTOM_ORIGIN, customStorage).flushRendererStorageDeletions();
      expect(state.settings[DB + KEY]).toBe(committed);
      expect(state.write).toHaveBeenCalledTimes(writes);
      expect(customStorage.getItem(LOCAL + KEY)).toBeNull();
      expect(fileStorage.getItem(KEY)).toBe('new recovery connection');
    },
  );

  it('keeps noncritical cache edits local', async () => {
    const state = profile();
    const renderer = state.renderer(CUSTOM_ORIGIN);
    renderer.setRendererStorageItem('temporary-ui', 'value');
    renderer.removeRendererStorageItem('temporary-ui');
    await renderer.flushRendererStorageDeletions();
    expect(renderer.storage.getItem('temporary-ui')).toBeNull();
    expect(state.read).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });
});
