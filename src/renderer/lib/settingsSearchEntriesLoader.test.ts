import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SETTING_SEARCH_ENTRIES } from './settingsSearchEntries';

describe('loadSettingSearchEntries', () => {
  afterEach(() => {
    vi.doUnmock('./settingsSearchEntries');
    vi.resetModules();
  });

  it('resolves the full registry and reuses one load', async () => {
    const { loadSettingSearchEntries } = await import('./settingsSearchEntriesLoader');
    const first = loadSettingSearchEntries();
    expect(loadSettingSearchEntries()).toBe(first);
    await expect(first).resolves.toEqual(SETTING_SEARCH_ENTRIES);
  });

  it('retries after a failed chunk load instead of caching the rejection', async () => {
    vi.resetModules();
    let fail = true;
    vi.doMock('./settingsSearchEntries', () => {
      if (fail) throw new Error('chunk load failed');
      return { SETTING_SEARCH_ENTRIES: [] };
    });
    const { loadSettingSearchEntries } = await import('./settingsSearchEntriesLoader');
    await expect(loadSettingSearchEntries()).rejects.toThrow();
    fail = false;
    vi.resetModules();
    await expect(loadSettingSearchEntries()).resolves.toEqual([]);
  });

  it('keeps the registry out of the App startup chunk', () => {
    const appSource = readFileSync(join(__dirname, '../App.tsx'), 'utf-8');
    expect(appSource).not.toMatch(/from '\.\/lib\/settingsSearchEntries'/);
    expect(appSource).toMatch(/loadSettingSearchEntries/);
  });
});
