import { describe, expect, it } from 'vitest';

import { matchesSettingsSearchExemption } from './settingsSearch';
import {
  SETTING_SEARCH_ENTRIES,
  SETTINGS_BEARING_FILES,
  SETTINGS_SEARCH_EXEMPT,
  SETTINGS_SEARCH_SHARED_EXEMPT,
  SETTINGS_SEARCH_SURFACES,
} from './settingsSearchEntries';
import {
  collectAnchorIds,
  collectTranslationKeys,
  readComponentSources,
  readRepoFile,
} from './settingsSearchTestHelpers';

const indexedKeys = new Set(
  SETTING_SEARCH_ENTRIES.flatMap((entry) =>
    entry.sectionKey ? [entry.labelKey, entry.sectionKey] : [entry.labelKey],
  ),
);
const sharedPatterns = Object.keys(SETTINGS_SEARCH_SHARED_EXEMPT);

const keysByFile = new Map<string, Set<string>>();
function keysOf(path: string): Set<string> {
  let keys = keysByFile.get(path);
  if (!keys) {
    keys = collectTranslationKeys(readRepoFile(path));
    keysByFile.set(path, keys);
  }
  return keys;
}

const matchesAny = (patterns: readonly string[], key: string) =>
  patterns.some((pattern) => matchesSettingsSearchExemption(pattern, key));

// Exemptions are scoped: a surface's patterns only cover the files that surface sweeps, so a
// broad pattern written for one panel cannot hide an unindexed setting in another.
const sweptCases = SETTINGS_SEARCH_SURFACES.flatMap((surface) =>
  surface.files
    .filter((file) => file.sweepAllKeys)
    .map((file) => ({ path: file.path, patterns: Object.keys(surface.exempt) })),
);

describe('settings search coverage (every option is indexed or exempted)', () => {
  it.each(sweptCases)('$path: every t() key is indexed or exempted', ({ path, patterns }) => {
    const uncovered = [...keysOf(path)].filter(
      (key) =>
        !indexedKeys.has(key) && !matchesAny(sharedPatterns, key) && !matchesAny(patterns, key),
    );
    expect(uncovered).toEqual([]);
  });

  it('every exemption has a reason and a literal namespace', () => {
    const bad = Object.entries(SETTINGS_SEARCH_EXEMPT).filter(
      ([pattern, reason]) => reason.trim() === '' || !/^[a-zA-Z][\w-]*\./.test(pattern),
    );
    expect(bad).toEqual([]);
  });

  it('no exemption is stale (each matches a key in its own surface’s swept files)', () => {
    const stale = SETTINGS_SEARCH_SURFACES.flatMap((surface) => {
      const keys = surface.files
        .filter((file) => file.sweepAllKeys)
        .flatMap((file) => [...keysOf(file.path)]);
      return Object.keys(surface.exempt).filter(
        (pattern) => !keys.some((key) => matchesSettingsSearchExemption(pattern, key)),
      );
    });
    const allSweptKeys = SETTINGS_BEARING_FILES.filter((file) => file.sweepAllKeys).flatMap(
      (file) => [...keysOf(file.path)],
    );
    const staleShared = sharedPatterns.filter(
      (pattern) => !allSweptKeys.some((key) => matchesSettingsSearchExemption(pattern, key)),
    );
    expect([...stale, ...staleShared]).toEqual([]);
  });

  it('every component file with a literal anchor is listed in SETTINGS_BEARING_FILES', () => {
    const listed = new Set(SETTINGS_BEARING_FILES.map((file) => file.path));
    const missing = readComponentSources()
      .filter(({ source }) => collectAnchorIds(source).length > 0)
      .map(({ path }) => path)
      .filter((path) => !listed.has(path));
    expect(missing).toEqual([]);
  });
});
