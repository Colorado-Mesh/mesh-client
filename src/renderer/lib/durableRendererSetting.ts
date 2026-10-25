import type { StateStorage } from 'zustand/middleware';

import { errLikeToLogString } from './errLikeToLogString';

interface PendingWrite {
  baseline: string;
  value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Replay only local edits; untouched fields come from SQLite, including other identities. */
function replayChanges(
  baseline: unknown,
  value: unknown,
  durable: unknown,
  missingRecordDefaults?: (path: readonly string[]) => unknown,
  path: readonly string[] = [],
): unknown {
  if (JSON.stringify(baseline) === JSON.stringify(value)) return durable;
  if (!isRecord(baseline) || !isRecord(value) || !isRecord(durable)) return value;
  const result = new Map(Object.entries(durable));
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(value)])) {
    if (!Object.hasOwn(value, key)) result.delete(key);
    else if (!Object.hasOwn(baseline, key)) {
      const defaults = missingRecordDefaults?.([...path, key]);
      result.set(
        key,
        defaults === undefined
          ? value[key]
          : replayChanges(defaults, value[key], result.get(key), missingRecordDefaults, [
              ...path,
              key,
            ]),
      );
    } else if (JSON.stringify(baseline[key]) !== JSON.stringify(value[key])) {
      result.set(
        key,
        replayChanges(baseline[key], value[key], result.get(key), missingRecordDefaults, [
          ...path,
          key,
        ]),
      );
    }
  }
  return Object.fromEntries(result);
}

/**
 * SQLite is canonical after startup hydration. The original localStorage key remains a
 * synchronous cache/recovery copy. A small local journal preserves edits made before hydration
 * or during an IPC failure, including removals, without replacing unrelated durable data.
 */
export function createDurableRendererSetting(
  localKey: string,
  settingKey: string,
  emptyValue = '{}',
  missingRecordDefaults?: (path: readonly string[]) => unknown,
) {
  const journalKey = `mesh-client:durablePending:${settingKey}`;
  let fallbackRaw: string | null = null;
  let cacheWriteFailed = false;
  const readLocal = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('[durableRendererSetting] read cache failed', errLikeToLogString(error));
      return key === localKey ? fallbackRaw : null;
    }
  };
  const writeLocal = (key: string, value: string | null): void => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      if (key === localKey) cacheWriteFailed = false;
    } catch (error) {
      if (key === localKey) cacheWriteFailed = true;
      console.warn('[durableRendererSetting] write cache failed', errLikeToLogString(error));
    }
  };
  let baseline = readLocal(localKey) ?? emptyValue;
  let pending: PendingWrite | null = null;
  const journal = readLocal(journalKey);
  if (journal !== null) {
    try {
      const parsed: unknown = JSON.parse(journal);
      if (
        isRecord(parsed) &&
        typeof parsed.baseline === 'string' &&
        typeof parsed.value === 'string'
      ) {
        JSON.parse(parsed.baseline);
        JSON.parse(parsed.value);
        pending = { baseline: parsed.baseline, value: parsed.value };
      }
    } catch (error) {
      console.warn('[durableRendererSetting] invalid pending write', errLikeToLogString(error));
    }
  }
  let hydrated = false;
  let applying = false;
  let flushing: Promise<void> | undefined;
  const readValue = (): string | null =>
    applying || cacheWriteFailed ? fallbackRaw : readLocal(localKey);
  const saveJournal = (): void => {
    writeLocal(journalKey, pending === null ? null : JSON.stringify(pending));
  };
  const flush = (): Promise<void> => {
    if (flushing) return flushing;
    if (!hydrated || !pending) return Promise.resolve();
    let failed = false;
    flushing = (async () => {
      while (pending) {
        const write: PendingWrite = pending;
        try {
          await window.electronAPI.appSettings.set(settingKey, write.value);
        } catch (error) {
          failed = true;
          // Keep the journal and original cache; retry on the next edit or launch.
          console.warn(
            '[durableRendererSetting] SQLite write failed',
            settingKey,
            errLikeToLogString(error),
          );
          break;
        }
        baseline = write.value;
        pending = pending === write ? null : { baseline, value: pending.value };
        saveJournal();
      }
    })().finally(() => {
      flushing = undefined;
      // A caller can enqueue between the last await and this promise's finalizer.
      if (pending && !failed) return flush();
    });
    return flushing;
  };
  const write = (value: string): void => {
    fallbackRaw = value;
    if (!applying && value !== (pending?.value ?? baseline)) {
      pending = { baseline: pending?.baseline ?? baseline, value };
      saveJournal();
    }
    writeLocal(localKey, value);
    if (!applying) void flush();
  };

  return {
    isHydrated: (): boolean => hydrated,
    read: readValue,
    write,
    flush,
    /** Schema upgrades of a cache are not user edits and must not override a newer DB. */
    hydrateLocal: (apply: () => void): void => {
      applying = true;
      fallbackRaw = readLocal(localKey);
      try {
        apply();
        baseline = fallbackRaw ?? emptyValue;
      } finally {
        applying = false;
      }
    },
    storage: {
      getItem: readValue,
      setItem: (_name, value) => {
        write(value);
      },
      removeItem: () => {
        write(emptyValue);
      },
    } satisfies StateStorage,
    /** Call before mounting App. `apply` rehydrates a synchronous Zustand cache if needed. */
    hydrate: async (
      settings: Partial<Record<string, string>>,
      apply?: () => void,
    ): Promise<void> => {
      if (hydrated) return flush();
      const durable = settings[settingKey];
      let value = durable ?? pending?.value ?? readLocal(localKey) ?? emptyValue;
      if (durable !== undefined && pending) {
        value = JSON.stringify(
          replayChanges(
            JSON.parse(pending.baseline),
            JSON.parse(pending.value),
            JSON.parse(durable),
            missingRecordDefaults,
          ),
        );
      }
      if (!isRecord(JSON.parse(value))) throw new Error(`Invalid durable setting: ${settingKey}`);
      baseline = durable ?? emptyValue;
      applying = true;
      try {
        write(value);
        apply?.();
        // Zustand may migrate/sanitize an older version while rehydrating.
        value = fallbackRaw ?? value;
      } finally {
        applying = false;
      }
      pending = value === durable ? null : { baseline, value };
      saveJournal();
      hydrated = true;
      await flush();
    },
  };
}
