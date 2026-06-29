import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { DEFAULT_APP_SETTINGS_SHARED } from './defaultAppSettings';
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
  mergeAppSettingsPartial({ [key]: value }, parseContext);
}

/** Whether MeshCore Open wire formats (keyed replies, r: reactions, g: GIFs) are enabled. */
export function isMeshcoreOpenWireCompatEnabled(): boolean {
  const parsed = parseStoredJson<{ meshcoreOpenWireCompatEnabled?: boolean }>(
    getAppSettingsRaw(),
    'isMeshcoreOpenWireCompatEnabled',
  );
  return (
    parsed?.meshcoreOpenWireCompatEnabled ??
    DEFAULT_APP_SETTINGS_SHARED.meshcoreOpenWireCompatEnabled
  );
}

/** Whether the Reticulum sidecar should start when the Reticulum connection panel mounts. */
export function isReticulumAutostartEnabled(): boolean {
  const parsed = parseStoredJson<{ reticulumAutostart?: boolean }>(
    getAppSettingsRaw(),
    'isReticulumAutostartEnabled',
  );
  return parsed?.reticulumAutostart ?? DEFAULT_APP_SETTINGS_SHARED.reticulumAutostart;
}

export function setReticulumAutostartEnabled(enabled: boolean): void {
  mergeAppSetting('reticulumAutostart', enabled, 'setReticulumAutostartEnabled');
  void window.electronAPI.appSettings.set('reticulumAutostart', enabled ? '1' : '0');
}

/** Merge keys into existing app settings without dropping unrelated persisted fields. */
export function mergeAppSettingsPartial(
  partial: Record<string, unknown>,
  parseContext: string,
): void {
  try {
    migrateLegacyAppSettingsIfNeeded();
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    const existing = parseStoredJson<Record<string, unknown>>(raw, parseContext) ?? {};
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify({ ...existing, ...partial }));
  } catch (e) {
    console.warn('[appSettingsStorage] mergeAppSettingsPartial failed ' + errLikeToLogString(e));
  }
}
