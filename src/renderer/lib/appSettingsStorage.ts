import { parseStoredJson } from './parseStoredJson';

/** Current localStorage key for merged app + diagnostics preference JSON. */
export const APP_SETTINGS_STORAGE_KEY = 'mesh-client:appSettings';

const LEGACY_APP_SETTINGS_STORAGE_KEY = 'mesh-client:adminSettings';

/**
 * One-time copy from legacy `mesh-client:adminSettings` so existing installs keep settings.
 */
export function migrateLegacyAppSettingsIfNeeded(): void {
  try {
    if (localStorage.getItem(APP_SETTINGS_STORAGE_KEY) != null) return;
    const legacy = localStorage.getItem(LEGACY_APP_SETTINGS_STORAGE_KEY);
    if (legacy == null) return;
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_APP_SETTINGS_STORAGE_KEY);
  } catch {
    // catch-no-log-ok localStorage unavailable in private/restricted environments
  }
}

export function getAppSettingsRaw(): string | null {
  migrateLegacyAppSettingsIfNeeded();
  return localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
}

export function setAppSettingsRaw(json: string): void {
  try {
    migrateLegacyAppSettingsIfNeeded();
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, json);
  } catch {
    // catch-no-log-ok localStorage quota or private mode
  }
}

export function mergeAppSetting(key: string, value: unknown, parseContext: string): void {
  try {
    migrateLegacyAppSettingsIfNeeded();
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    const s = parseStoredJson<Record<string, unknown>>(raw, parseContext) ?? {};
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ ...s, [key]: value }));
  } catch (e) {
    console.warn('[appSettingsStorage] mergeAppSetting failed', key, e);
  }
}
