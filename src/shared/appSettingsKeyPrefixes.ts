/**
 * Prefixed `app_settings` keys allowed by main IPC (`isAppSettingsKeyAllowed`).
 * Renderer storage modules must use these same prefix strings.
 */
export const MESHTASTIC_REMOTE_ADMIN_KEY_SETTING_PREFIX = 'meshtasticRemoteAdminKey:';

/** MeshCore Rooms tab — sync prefs / last-post stamps / credentials. */
export const MESHCORE_ROOM_SYNC_SETTING_PREFIX = 'meshcoreRoomSync:';
export const MESHCORE_ROOM_LAST_POST_SETTING_PREFIX = 'meshcoreRoomLastPost:';
export const MESHCORE_ROOM_CREDENTIAL_SETTING_PREFIX = 'meshcoreRoomCredential:';

/** MeshCore Repeaters tab — per-node admin passwords. */
export const MESHCORE_REPEATER_CREDENTIAL_SETTING_PREFIX = 'meshcoreRepeaterCredential:';
