import { beforeEach, describe, expect, it } from 'vitest';

import {
  APP_SETTINGS_STORAGE_KEY,
  getAppSettingsRaw,
  mergeAppSetting,
  setAppSettingsRaw,
} from './appSettingsStorage';

const LEGACY_KEY = 'mesh-client:adminSettings';

describe('appSettingsStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('migrates legacy adminSettings into appSettings on first read', () => {
    const payload = JSON.stringify({ foo: 1, congestionHalosEnabled: true });
    localStorage.setItem(LEGACY_KEY, payload);
    expect(getAppSettingsRaw()).toBe(payload);
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toBe(payload);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('does not overwrite existing appSettings when legacy exists', () => {
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ a: 2 }));
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ b: 3 }));
    expect(getAppSettingsRaw()).toBe(JSON.stringify({ a: 2 }));
    expect(localStorage.getItem(LEGACY_KEY)).toBe(JSON.stringify({ b: 3 }));
  });

  it('mergeAppSetting migrates legacy then merges', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ existing: true }));
    mergeAppSetting('newKey', 42, 'appSettingsStorage.test merge');
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed.existing).toBe(true);
    expect(parsed.newKey).toBe(42);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('setAppSettingsRaw replaces after migrating legacy', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ old: 1 }));
    setAppSettingsRaw(JSON.stringify({ fresh: 2 }));
    expect(JSON.parse(getAppSettingsRaw() ?? '{}')).toEqual({ fresh: 2 });
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
