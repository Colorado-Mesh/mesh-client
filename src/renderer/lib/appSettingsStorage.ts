import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { DEFAULT_APP_SETTINGS_SHARED } from './defaultAppSettings';
import { parseStoredJson } from './parseStoredJson';

/** Current localStorage key for merged app + diagnostics preference JSON. */
export const APP_SETTINGS_STORAGE_KEY = 'mesh-client:appSettings';

export const LEGACY_APP_SETTINGS_STORAGE_KEY = 'mesh-client:adminSettings';

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
  } catch (e: unknown) {
    console.debug('[renderer/lib/appSettingsStorage] catch:', e);
  }
}

export function getAppSettingsRaw(): string | null {
  // Eager module readers run before secure startup. Read the legacy source without copying
  // any inline credentials; canonical preparation and secure migration own its retirement.
  return (
    localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ??
    localStorage.getItem(LEGACY_APP_SETTINGS_STORAGE_KEY)
  );
}

export function setAppSettingsRaw(json: string): void {
  try {
    migrateLegacyAppSettingsIfNeeded();
    localStorage.setItem(APP_SETTINGS_STORAGE_KEY, json);
  } catch (e: unknown) {
    console.debug('[renderer/lib/appSettingsStorage] catch:', e);
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

/** Persisted app choice; absence stays distinct when preserving native configuration. */
export function getShareMyLocationPreference(): boolean | undefined {
  const parsed = parseStoredJson<{ shareMyLocation?: unknown }>(
    getAppSettingsRaw(),
    'isShareMyLocationEnabled',
  );
  return typeof parsed?.shareMyLocation === 'boolean' ? parsed.shareMyLocation : undefined;
}

export function isShareMyLocationEnabled(): boolean {
  return getShareMyLocationPreference() === true;
}

/** Whether chat location share also sends a Meshtastic Waypoint packet. */
export function isShareLocationSendWaypointEnabled(): boolean {
  const parsed = parseStoredJson<{ shareLocationSendWaypoint?: boolean }>(
    getAppSettingsRaw(),
    'isShareLocationSendWaypointEnabled',
  );
  return parsed?.shareLocationSendWaypoint ?? DEFAULT_APP_SETTINGS_SHARED.shareLocationSendWaypoint;
}

/** Whether RRC badges/sounds fire for every room msg/action (false = IRC-style mention/DM). */
export function isRrcUnreadAllRoomMessagesEnabled(): boolean {
  const parsed = parseStoredJson<{ rrcUnreadAllRoomMessages?: unknown }>(
    getAppSettingsRaw(),
    'isRrcUnreadAllRoomMessagesEnabled',
  );
  return typeof parsed?.rrcUnreadAllRoomMessages === 'boolean'
    ? parsed.rrcUnreadAllRoomMessages
    : DEFAULT_APP_SETTINGS_SHARED.rrcUnreadAllRoomMessages;
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
export interface WordFilterSettings {
  enabled: boolean;
  words: string[];
}

/** Chat word filter: enable flag and blocked word list. */
export function getWordFilterSettings(): WordFilterSettings {
  const parsed = parseStoredJson<{
    wordFilterEnabled?: unknown;
    wordFilterWords?: unknown;
  }>(getAppSettingsRaw(), 'getWordFilterSettings');
  const wordsRaw = parsed?.wordFilterWords;
  const words = Array.isArray(wordsRaw)
    ? wordsRaw.filter((w): w is string => typeof w === 'string')
    : DEFAULT_APP_SETTINGS_SHARED.wordFilterWords;
  return {
    enabled:
      typeof parsed?.wordFilterEnabled === 'boolean'
        ? parsed.wordFilterEnabled
        : DEFAULT_APP_SETTINGS_SHARED.wordFilterEnabled,
    words,
  };
}

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

export function isInternetWeatherEnabled(): boolean {
  const parsed = parseStoredJson<{ internetWeatherEnabled?: unknown }>(
    getAppSettingsRaw(),
    'isInternetWeatherEnabled',
  );
  return typeof parsed?.internetWeatherEnabled === 'boolean'
    ? parsed.internetWeatherEnabled
    : DEFAULT_APP_SETTINGS_SHARED.internetWeatherEnabled;
}

export function setInternetWeatherEnabled(enabled: boolean): void {
  mergeAppSetting('internetWeatherEnabled', enabled, 'setInternetWeatherEnabled');
}

export function getWeatherUnits(): {
  wind: 'kmh' | 'mph' | 'ms' | 'kn';
  precip: 'mm' | 'in';
} {
  const parsed = parseStoredJson<{
    mapWeatherWindUnit?: unknown;
    mapWeatherPrecipUnit?: unknown;
  }>(getAppSettingsRaw(), 'getWeatherUnits');
  const wind =
    parsed?.mapWeatherWindUnit === 'kmh' ||
    parsed?.mapWeatherWindUnit === 'mph' ||
    parsed?.mapWeatherWindUnit === 'ms' ||
    parsed?.mapWeatherWindUnit === 'kn'
      ? parsed.mapWeatherWindUnit
      : DEFAULT_APP_SETTINGS_SHARED.mapWeatherWindUnit;
  const precip =
    parsed?.mapWeatherPrecipUnit === 'mm' || parsed?.mapWeatherPrecipUnit === 'in'
      ? parsed.mapWeatherPrecipUnit
      : DEFAULT_APP_SETTINGS_SHARED.mapWeatherPrecipUnit;
  return { wind, precip };
}

export function getRadarPreferences(): {
  provider: 'auto' | 'rainviewer' | 'iem-nexrad';
  opacity: number;
  showCoverage: boolean;
} {
  const parsed = parseStoredJson<{
    mapWeatherRadarProvider?: unknown;
    mapWeatherRadarOpacity?: unknown;
    mapWeatherRadarCoverage?: unknown;
  }>(getAppSettingsRaw(), 'getRadarPreferences');
  const provider =
    parsed?.mapWeatherRadarProvider === 'auto' ||
    parsed?.mapWeatherRadarProvider === 'rainviewer' ||
    parsed?.mapWeatherRadarProvider === 'iem-nexrad'
      ? parsed.mapWeatherRadarProvider
      : DEFAULT_APP_SETTINGS_SHARED.mapWeatherRadarProvider;
  const rawOpacity =
    typeof parsed?.mapWeatherRadarOpacity === 'number' &&
    Number.isFinite(parsed.mapWeatherRadarOpacity)
      ? parsed.mapWeatherRadarOpacity
      : DEFAULT_APP_SETTINGS_SHARED.mapWeatherRadarOpacity;
  const opacity = Math.min(0.9, Math.max(0.2, rawOpacity));
  const showCoverage =
    typeof parsed?.mapWeatherRadarCoverage === 'boolean'
      ? parsed.mapWeatherRadarCoverage
      : DEFAULT_APP_SETTINGS_SHARED.mapWeatherRadarCoverage;
  return { provider, opacity, showCoverage };
}

export interface OperationalAlertSettings {
  /** null = protocol capability defaults. */
  nodeSilenceAlertMinutes: number | null;
  nodeBatteryLowThreshold: number;
  notifyOnLinkDown: boolean;
  /** Desktop + sound for new error-severity diagnostic rows (default off). */
  notifyOnDiagnosticErrors: boolean;
  /** Standing banner + window attention for unseen MAYDAY/URGENT (Incident Command station). */
  mecpStandingAlertEnabled: boolean;
  /** Repeat interval for unseen MAYDAY/URGENT alerts; null = off. Requires the standing alert. */
  mecpRepeatAlertMinutes: number | null;
}

export const MECP_REPEAT_ALERT_MAX_MINUTES = 60;

/** Watched-node silence / battery, RF link-down and unseen-MECP repeat settings (App tab). */
function clampRepeatAlertMinutes(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.min(MECP_REPEAT_ALERT_MAX_MINUTES, Math.floor(value))
    : DEFAULT_APP_SETTINGS_SHARED.mecpRepeatAlertMinutes;
}

function positiveNumberOrDefault(value: unknown, fallback: number, max?: number): number;
function positiveNumberOrDefault(
  value: unknown,
  fallback: number | null,
  max?: number,
): number | null;
function positiveNumberOrDefault(
  value: unknown,
  fallback: number | null,
  max?: number,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  if (max != null && value > max) return fallback;
  return value;
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Watched-node silence / battery, RF link-down and unseen-MECP repeat settings (App tab). */
export function getOperationalAlertSettings(): OperationalAlertSettings {
  const parsed = parseStoredJson<{
    nodeSilenceAlertMinutes?: unknown;
    nodeBatteryLowThreshold?: unknown;
    notifyOnLinkDown?: unknown;
    notifyOnDiagnosticErrors?: unknown;
    mecpRepeatAlertMinutes?: unknown;
    mecpStandingAlertEnabled?: unknown;
  }>(getAppSettingsRaw(), 'getOperationalAlertSettings');
  const mecpRepeatAlertMinutes = clampRepeatAlertMinutes(parsed?.mecpRepeatAlertMinutes);
  // Users who opted into repeats before the standing toggle existed keep their station mode.
  const mecpStandingAlertEnabled = booleanOrDefault(
    parsed?.mecpStandingAlertEnabled,
    mecpRepeatAlertMinutes != null || DEFAULT_APP_SETTINGS_SHARED.mecpStandingAlertEnabled,
  );
  return {
    mecpStandingAlertEnabled,
    mecpRepeatAlertMinutes,
    nodeSilenceAlertMinutes: positiveNumberOrDefault(
      parsed?.nodeSilenceAlertMinutes,
      DEFAULT_APP_SETTINGS_SHARED.nodeSilenceAlertMinutes,
    ),
    nodeBatteryLowThreshold: positiveNumberOrDefault(
      parsed?.nodeBatteryLowThreshold,
      DEFAULT_APP_SETTINGS_SHARED.nodeBatteryLowThreshold,
      100,
    ),
    notifyOnLinkDown: booleanOrDefault(
      parsed?.notifyOnLinkDown,
      DEFAULT_APP_SETTINGS_SHARED.notifyOnLinkDown,
    ),
    notifyOnDiagnosticErrors: booleanOrDefault(
      parsed?.notifyOnDiagnosticErrors,
      DEFAULT_APP_SETTINGS_SHARED.notifyOnDiagnosticErrors,
    ),
  };
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
  void window.electronAPI.appSettings
    .set('reticulumAutostart', enabled ? '1' : '0')
    .catch((e: unknown) => {
      console.warn(
        'mcL0779 [appSettingsStorage] persist reticulumAutostart failed ' + errLikeToLogString(e),
      );
    });
}

/** Whether an announce from a peer should retry that peer's failed LXMF messages. */
export function isReticulumAutoResendOnAnnounceEnabled(): boolean {
  const parsed = parseStoredJson<{ reticulumAutoResendOnAnnounce?: boolean }>(
    getAppSettingsRaw(),
    'isReticulumAutoResendOnAnnounceEnabled',
  );
  return typeof parsed?.reticulumAutoResendOnAnnounce === 'boolean'
    ? parsed.reticulumAutoResendOnAnnounce
    : DEFAULT_APP_SETTINGS_SHARED.reticulumAutoResendOnAnnounce;
}

export function setReticulumAutoResendOnAnnounceEnabled(enabled: boolean): void {
  mergeAppSetting(
    'reticulumAutoResendOnAnnounce',
    enabled,
    'setReticulumAutoResendOnAnnounceEnabled',
  );
  void window.electronAPI.appSettings
    .set('reticulumAutoResendOnAnnounce', enabled ? '1' : '0')
    .catch((e: unknown) => {
      console.warn(
        'mcL0780 [appSettingsStorage] persist reticulumAutoResendOnAnnounce failed ' +
          errLikeToLogString(e),
      );
    });
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
    console.warn(
      'mcL0781 [appSettingsStorage] mergeAppSettingsPartial failed ' + errLikeToLogString(e),
    );
  }
}
