import type { ElectronAPI } from '@/shared/electron-api.types';
import {
  isCriticalRendererStorageKey,
  isRendererStorageDeletionSetting,
  RENDERER_STORAGE_DELETION_PREFIX,
  RENDERER_STORAGE_DELETION_SETTING_PREFIX,
} from '@/shared/rendererOrigin';
import {
  hasAppliedRendererStorageIntent,
  parseRendererStorageDeletionState,
  parseRendererStorageIntent,
  type PendingRendererStorageIntent,
  rendererStorageIntentOrigin,
} from '@/shared/rendererStorageIntent';

import { errLikeToLogString } from './errLikeToLogString';

interface RendererStorageEnvironment {
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;
  origin: () => string;
  createId: () => string;
  readSettings: () => Promise<Record<string, string>>;
  writeSetting: (key: string, value: string) => Promise<unknown>;
}

/** One instance belongs to one renderer document and its origin-local journal. */
export function createRendererStorage(environment: RendererStorageEnvironment) {
  const pending = new Map<string, PendingRendererStorageIntent>();
  let flushing: Promise<void> | undefined;
  let restored = false;
  const storage = environment.storage;

  function restorePendingIntents(): void {
    if (restored) return;
    restored = true;
    try {
      for (let index = 0; index < storage.length; index++) {
        const marker = storage.key(index);
        if (!marker?.startsWith(RENDERER_STORAGE_DELETION_PREFIX)) continue;
        const key = marker.slice(RENDERER_STORAGE_DELETION_PREFIX.length);
        const setting = `${RENDERER_STORAGE_DELETION_SETTING_PREFIX}${key}`;
        const raw = storage.getItem(marker);
        if (isRendererStorageDeletionSetting(setting) && raw !== null) {
          try {
            pending.set(setting, parseRendererStorageIntent(raw));
          } catch (error) {
            // Preserve damaged evidence without blocking independent valid pending keys.
            console.warn(
              '[rendererStorage] invalid deletion journal entry',
              errLikeToLogString(error),
            );
          }
        }
      }
    } catch (error) {
      console.warn('[rendererStorage] deletion journal read failed', errLikeToLogString(error));
    }
  }

  function finishIntent(key: string, intent: PendingRendererStorageIntent, deleted: boolean): void {
    if (pending.get(key) !== intent) return;
    const original = key.slice(RENDERER_STORAGE_DELETION_SETTING_PREFIX.length);
    const marker = `${RENDERER_STORAGE_DELETION_PREFIX}${original}`;
    // A consumed source-origin journal may predate a later recreation on the custom origin.
    // Only the current canonical flag may authorize finishing an interrupted local removal.
    if (deleted) storage.removeItem(original);
    const raw = storage.getItem(marker);
    if (raw !== null) {
      const cached = parseRendererStorageIntent(raw);
      if (cached.id === intent.id && cached.origin === intent.origin) storage.removeItem(marker);
    }
    pending.delete(key);
  }

  /** Retry journals without replaying an intent already consumed by another renderer origin. */
  function flushRendererStorageDeletions(): Promise<void> {
    restorePendingIntents();
    if (flushing) return flushing;
    if (pending.size === 0) return Promise.resolve();
    let failed = false;
    flushing = (async () => {
      let settings: Record<string, string>;
      try {
        settings = await environment.readSettings();
      } catch (error) {
        failed = true;
        console.warn('[rendererStorage] deletion state read failed', errLikeToLogString(error));
        return;
      }
      while (pending.size > 0) {
        const [key, intent] = pending.entries().next().value!;
        try {
          let state = parseRendererStorageDeletionState(settings[key]);
          if (!hasAppliedRendererStorageIntent(state, intent)) {
            state = {
              ...state,
              deleted: intent.deleted,
              applied: { ...state.applied, [intent.origin]: intent.id },
            };
            const raw = JSON.stringify(state);
            // Apply the same bound as main before attempting a canonical write.
            parseRendererStorageDeletionState(raw);
            await environment.writeSetting(key, raw);
            settings[key] = raw;
          }
          finishIntent(key, intent, state.deleted);
        } catch (error) {
          failed = true;
          console.warn(
            '[rendererStorage] deletion intent persistence failed',
            errLikeToLogString(error),
          );
          break;
        }
      }
    })().finally(() => {
      flushing = undefined;
      if (pending.size > 0 && !failed) return flushRendererStorageDeletions();
    });
    return flushing;
  }

  function recordIntent(key: string, deleted: boolean): boolean {
    if (!isCriticalRendererStorageKey(key)) return true;
    restorePendingIntents();
    const intent: PendingRendererStorageIntent = {
      id: environment.createId(),
      origin: environment.origin(),
      deleted,
    };
    pending.set(`${RENDERER_STORAGE_DELETION_SETTING_PREFIX}${key}`, intent);
    let cached = true;
    try {
      storage.setItem(`${RENDERER_STORAGE_DELETION_PREFIX}${key}`, JSON.stringify(intent));
    } catch (error) {
      cached = false;
      console.warn('[rendererStorage] deletion journal write failed', errLikeToLogString(error));
    }
    void flushRendererStorageDeletions();
    return cached;
  }

  function removeRendererStorageItem(key: string): void {
    // If quota prevents the journal, successful SQLite acknowledgment finishes the removal.
    if (recordIntent(key, true)) storage.removeItem(key);
  }

  function setRendererStorageItem(key: string, value: string): void {
    storage.setItem(key, value);
    // The local marker may have been lost independently of its canonical SQLite flag.
    recordIntent(key, false);
  }

  return { flushRendererStorageDeletions, removeRendererStorageItem, setRendererStorageItem };
}

let rendererStorage: ReturnType<typeof createRendererStorage> | undefined;

function currentRendererStorage() {
  rendererStorage ??= createRendererStorage({
    storage: {
      get length() {
        return localStorage.length;
      },
      key: (index) => localStorage.key(index),
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => {
        localStorage.setItem(key, value);
      },
      removeItem: (key) => {
        localStorage.removeItem(key);
      },
    },
    origin: () => rendererStorageIntentOrigin(window.location.href),
    createId: () => crypto.randomUUID(),
    readSettings: () =>
      (window as unknown as { electronAPI: ElectronAPI }).electronAPI.appSettings.getAll(),
    writeSetting: (key, value) =>
      (window as unknown as { electronAPI: ElectronAPI }).electronAPI.appSettings.set(key, value),
  });
  return rendererStorage;
}

export function flushRendererStorageDeletions(): Promise<void> {
  return currentRendererStorage().flushRendererStorageDeletions();
}

export function removeRendererStorageItem(key: string): void {
  currentRendererStorage().removeRendererStorageItem(key);
}

export function setRendererStorageItem(key: string, value: string): void {
  currentRendererStorage().setRendererStorageItem(key, value);
}
