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

export type StoreForwardHistoryProfile = 'conservative' | 'aggressive';

/** Store & Forward auto-history aggressiveness profile. */
export function getStoreForwardHistoryProfile(): StoreForwardHistoryProfile {
  const parsed = parseStoredJson<{ storeForwardHistoryProfile?: StoreForwardHistoryProfile }>(
    getAppSettingsRaw(),
    'getStoreForwardHistoryProfile',
  );
  const profile = parsed?.storeForwardHistoryProfile;
  if (profile === 'aggressive' || profile === 'conservative') return profile;
  return DEFAULT_APP_SETTINGS_SHARED.storeForwardHistoryProfile;
}

/** App → distance unit (miles or km). */
export function getDistanceUnit(): 'miles' | 'km' {
  const parsed = parseStoredJson<{ distanceUnit?: unknown }>(
    getAppSettingsRaw(),
    'getDistanceUnit',
  );
  return parsed?.distanceUnit === 'km' ? 'km' : DEFAULT_APP_SETTINGS_SHARED.distanceUnit;
}

/** Whether mesh-client may look up host GPS and send the user's location on any protocol. */
export function isShareMyLocationEnabled(): boolean {
  const parsed = parseStoredJson<{ shareMyLocation?: boolean }>(
    getAppSettingsRaw(),
    'isShareMyLocationEnabled',
  );
  return parsed?.shareMyLocation ?? DEFAULT_APP_SETTINGS_SHARED.shareMyLocation;
}

/** Whether chat location share also sends a Meshtastic Waypoint packet. */
export function isShareLocationSendWaypointEnabled(): boolean {
  const parsed = parseStoredJson<{ shareLocationSendWaypoint?: boolean }>(
    getAppSettingsRaw(),
    'isShareLocationSendWaypointEnabled',
  );
  return parsed?.shareLocationSendWaypoint ?? DEFAULT_APP_SETTINGS_SHARED.shareLocationSendWaypoint;
}

/** Whether Chat shows the MECP compose button (App → MECP; default off). */
export function isMecpComposeEnabled(): boolean {
  const parsed = parseStoredJson<{ mecpComposeEnabled?: boolean }>(
    getAppSettingsRaw(),
    'isMecpComposeEnabled',
  );
  return parsed?.mecpComposeEnabled ?? DEFAULT_APP_SETTINGS_SHARED.mecpComposeEnabled;
}

export interface WeatherFilterSettings {
  hideInChannels: boolean;
  pattern: string;
}

/** Chat weather filter: hide weather posts in channels and the optional custom pattern. */
export function getWeatherFilterSettings(): WeatherFilterSettings {
  const parsed = parseStoredJson<{
    weatherFilterHideInChannels?: unknown;
    weatherFilterPattern?: unknown;
  }>(getAppSettingsRaw(), 'getWeatherFilterSettings');
  return {
    hideInChannels:
      typeof parsed?.weatherFilterHideInChannels === 'boolean'
        ? parsed.weatherFilterHideInChannels
        : DEFAULT_APP_SETTINGS_SHARED.weatherFilterHideInChannels,
    pattern:
      typeof parsed?.weatherFilterPattern === 'string'
        ? parsed.weatherFilterPattern
        : DEFAULT_APP_SETTINGS_SHARED.weatherFilterPattern,
  };
}

/** Whether forecast places missing offline may be looked up online (App → Weather; default off). */
export function isWeatherOnlinePlaceLookupEnabled(): boolean {
  const parsed = parseStoredJson<{ weatherOnlinePlaceLookup?: unknown }>(
    getAppSettingsRaw(),
    'isWeatherOnlinePlaceLookupEnabled',
  );
  return typeof parsed?.weatherOnlinePlaceLookup === 'boolean'
    ? parsed.weatherOnlinePlaceLookup
    : DEFAULT_APP_SETTINGS_SHARED.weatherOnlinePlaceLookup;
}

export interface OperationalAlertSettings {
  /** null = protocol capability defaults. */
  nodeSilenceAlertMinutes: number | null;
  nodeBatteryLowThreshold: number;
  notifyOnLinkDown: boolean;
  /** Standing banner + window attention for unseen MAYDAY/URGENT (Incident Command station). */
  mecpStandingAlertEnabled: boolean;
  /** Repeat interval for unseen MAYDAY/URGENT alerts; null = off. Requires the standing alert. */
  mecpRepeatAlertMinutes: number | null;
}

export const MECP_REPEAT_ALERT_MAX_MINUTES = 60;

/** Watched-node silence / battery, RF link-down and unseen-MECP repeat settings (App tab). */
export function getOperationalAlertSettings(): OperationalAlertSettings {
  const parsed = parseStoredJson<{
    nodeSilenceAlertMinutes?: unknown;
    nodeBatteryLowThreshold?: unknown;
    notifyOnLinkDown?: unknown;
    mecpRepeatAlertMinutes?: unknown;
    mecpStandingAlertEnabled?: unknown;
  }>(getAppSettingsRaw(), 'getOperationalAlertSettings');
  const silence = parsed?.nodeSilenceAlertMinutes;
  const battery = parsed?.nodeBatteryLowThreshold;
  const repeat = parsed?.mecpRepeatAlertMinutes;
  const mecpRepeatAlertMinutes =
    typeof repeat === 'number' && Number.isFinite(repeat) && repeat >= 1
      ? Math.min(MECP_REPEAT_ALERT_MAX_MINUTES, Math.floor(repeat))
      : DEFAULT_APP_SETTINGS_SHARED.mecpRepeatAlertMinutes;
  // Users who opted into repeats before the standing toggle existed keep their station mode.
  const mecpStandingAlertEnabled =
    typeof parsed?.mecpStandingAlertEnabled === 'boolean'
      ? parsed.mecpStandingAlertEnabled
      : mecpRepeatAlertMinutes != null || DEFAULT_APP_SETTINGS_SHARED.mecpStandingAlertEnabled;
  return {
    mecpStandingAlertEnabled,
    mecpRepeatAlertMinutes,
    nodeSilenceAlertMinutes:
      typeof silence === 'number' && Number.isFinite(silence) && silence > 0
        ? silence
        : DEFAULT_APP_SETTINGS_SHARED.nodeSilenceAlertMinutes,
    nodeBatteryLowThreshold:
      typeof battery === 'number' && Number.isFinite(battery) && battery > 0 && battery <= 100
        ? battery
        : DEFAULT_APP_SETTINGS_SHARED.nodeBatteryLowThreshold,
    notifyOnLinkDown:
      typeof parsed?.notifyOnLinkDown === 'boolean'
        ? parsed.notifyOnLinkDown
        : DEFAULT_APP_SETTINGS_SHARED.notifyOnLinkDown,
  };
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
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('mesh-client:appSettings'));
    }
  } catch (e) {
    console.warn('[appSettingsStorage] mergeAppSettingsPartial failed ' + errLikeToLogString(e));
  }
}
