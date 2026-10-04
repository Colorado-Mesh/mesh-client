import type { SettingSearchEntry } from './settingsSearch';

/**
 * The registry (with its per-file sweep and exemption maps) is large and only needed once the
 * launcher searches settings, so it is loaded as its own chunk instead of inflating App startup.
 */
let entriesPromise: Promise<readonly SettingSearchEntry[]> | null = null;

export function loadSettingSearchEntries(): Promise<readonly SettingSearchEntry[]> {
  entriesPromise ??= import('./settingsSearchEntries').then(
    (mod) => mod.SETTING_SEARCH_ENTRIES,
    (err: unknown) => {
      entriesPromise = null;
      throw err;
    },
  );
  return entriesPromise;
}
