import { isRendererPreferenceKey } from './rendererPreferences';

/** Chromium renderer origin; unrelated to the OS-level lxm: deep-link handler. */
export const RENDERER_SCHEME = 'mesh-client';
export const RENDERER_HOST = 'renderer';
export const RENDERER_INDEX_URL = `${RENDERER_SCHEME}://${RENDERER_HOST}/index.html`;
export const RENDERER_MIGRATION_URL = `${RENDERER_SCHEME}://${RENDERER_HOST}/migration.html`;

export const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const;

export const LATEST_RENDERER_ORIGIN_MIGRATION = 1;
export const RENDERER_ORIGIN_EXPORT_FORMAT_VERSION = 1;
export const ENV_FORCE_FILE_ORIGIN = 'MESH_CLIENT_FORCE_FILE_ORIGIN';
export const ENV_SKIP_ORIGIN_MIGRATION = 'MESH_CLIENT_SKIP_ORIGIN_MIGRATION';
export const ENV_FORCE_ORIGIN_REPAIR = 'MESH_CLIENT_FORCE_ORIGIN_REPAIR';

export const DURABLE_RENDERER_STORAGE_KEYS = {
  chatLastRead: {
    meshtastic: 'chatLastRead:meshtastic',
    meshcore: 'chatLastRead:meshcore',
    reticulum: 'chatLastRead:reticulum',
  },
  roomsLastRead: 'roomsLastRead:meshcore',
  rrcLastRead: 'rrcLastRead',
  mecpBlockedSenders: 'mecpBlockedSenders',
  takRelayPrefs: 'takRelayPrefs',
  preferences: 'rendererPreferences',
} as const;

export const DURABLE_RENDERER_STORAGE_MIGRATIONS = [
  ['mesh-client:lastRead:meshtastic', DURABLE_RENDERER_STORAGE_KEYS.chatLastRead.meshtastic],
  ['mesh-client:lastRead:meshcore', DURABLE_RENDERER_STORAGE_KEYS.chatLastRead.meshcore],
  ['mesh-client:lastRead:reticulum', DURABLE_RENDERER_STORAGE_KEYS.chatLastRead.reticulum],
  ['mesh-client:roomsLastRead:meshcore', DURABLE_RENDERER_STORAGE_KEYS.roomsLastRead],
  ['mesh-client:lastRead:rrc', DURABLE_RENDERER_STORAGE_KEYS.rrcLastRead],
  ['mesh-client:mecpBlockedSenders', DURABLE_RENDERER_STORAGE_KEYS.mecpBlockedSenders],
  ['mesh-client:takRelayPrefs', DURABLE_RENDERER_STORAGE_KEYS.takRelayPrefs],
  ['mesh-client:rendererPreferences', DURABLE_RENDERER_STORAGE_KEYS.preferences],
] as const;

export const DURABLE_RENDERER_SETTING_MAX_LENGTH = 1024 * 1024;

/** Missing exported keys trigger repair even when the migration marker survives. */
export const CRITICAL_LOCALSTORAGE_KEY_PREFIXES = [
  'mesh-client:lastRead',
  'mesh-client:roomsLastRead',
  'mesh-client:appSettings',
  'mesh-client:incidents',
  'mesh-client:chatMacros',
  'mesh-client:mecpBlockedSenders',
  'mesh-client:watchedNodes',
  'mesh-client:takRelayPrefs',
  'mesh-client:botSenders',
  'mesh-client:reticulumSetupGuide',
  'mesh-client:protocol',
  'mesh-client:lastConnection',
  'mesh-client:lastBleDevice',
  'mesh-client:lastSerialPort',
  'mesh-client:launcherPins',
  'mesh-client:notifMuted',
] as const;

export const RENDERER_STORAGE_DELETION_PREFIX = 'mesh-client:deletedStorage:';
export const RENDERER_STORAGE_DELETION_SETTING_PREFIX = 'rendererDeletedStorage:';

export function isCriticalRendererStorageKey(key: string): boolean {
  // Preferences added by any panel must not silently fall outside migration health checks.
  // Journals are control state, not preferences; historical copies must never be replayed.
  return (
    isRendererPreferenceKey(key) ||
    key.startsWith('mesh-client:credentialCompatibility:') ||
    CRITICAL_LOCALSTORAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

export function isRendererStorageDeletionSetting(key: string): boolean {
  return (
    key.startsWith(RENDERER_STORAGE_DELETION_SETTING_PREFIX) &&
    key.length <= 256 &&
    isCriticalRendererStorageKey(key.slice(RENDERER_STORAGE_DELETION_SETTING_PREFIX.length))
  );
}
