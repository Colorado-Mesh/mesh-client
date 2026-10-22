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
export const ENV_USE_CUSTOM_PROTOCOL = 'MESH_CLIENT_USE_CUSTOM_PROTOCOL';

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
} as const;

export const DURABLE_RENDERER_STORAGE_MIGRATIONS = [
  ['mesh-client:lastRead:meshtastic', DURABLE_RENDERER_STORAGE_KEYS.chatLastRead.meshtastic],
  ['mesh-client:lastRead:meshcore', DURABLE_RENDERER_STORAGE_KEYS.chatLastRead.meshcore],
  ['mesh-client:lastRead:reticulum', DURABLE_RENDERER_STORAGE_KEYS.chatLastRead.reticulum],
  ['mesh-client:roomsLastRead:meshcore', DURABLE_RENDERER_STORAGE_KEYS.roomsLastRead],
  ['mesh-client:lastRead:rrc', DURABLE_RENDERER_STORAGE_KEYS.rrcLastRead],
  ['mesh-client:mecpBlockedSenders', DURABLE_RENDERER_STORAGE_KEYS.mecpBlockedSenders],
  ['mesh-client:takRelayPrefs', DURABLE_RENDERER_STORAGE_KEYS.takRelayPrefs],
] as const;

export const DURABLE_RENDERER_SETTING_MAX_LENGTH = 1024 * 1024;
