/** Time duration constants in milliseconds. */
export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/**
 * Compact chat: merged consecutive bubbles from the same sender show a muted timestamp when the gap
 * from the previous message is at least this long (same calendar day; day separators still break groups).
 */
export const CHAT_COMPACT_CONTINUATION_TIME_GAP_MS = 5 * MS_PER_MINUTE;

/** MeshCore Ping (`tracePath`) end-to-end cap (queue wait + radio); matches `useMeshCore` `withTimeout`. */
export const MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS = 180_000;

/**
 * Max wait for `RESP_CODE_SENT` after `CMD_SEND_TRACE_PATH`. If the companion never acks, the
 * multiplex must reject so `runSerialized` does not stall and pending tags are cleared.
 */
export const MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS = 45_000;

/** Extra wait after SENT for room server login over RF (multi-hop); meshcore.js adds this to estTimeout. */
export const MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_MS = 45_000;

/** Cap wait for SendLogin / room post `sendTextMessage` Sent response (meshcore.js has no timeout). */
export const MESHCORE_ROOM_POST_SENT_TIMEOUT_MS = 45_000;

/** Room login attempts before giving up (matches MeshMonitor loginToRoom). */
export const MESHCORE_ROOM_LOGIN_MAX_ATTEMPTS = 3;

/** Delay between failed room login attempts. */
export const MESHCORE_ROOM_LOGIN_RETRY_DELAY_MS = 2_000;

/** Background room sync scheduler tick interval. */
export const MESHCORE_ROOM_SYNC_TICK_MS = 60_000;

/** Minimum spacing between mesh TX operations used by room sync (login counts as TX). */
export const MESHCORE_ROOM_SYNC_MIN_MESH_TX_SPACING_MS = 60_000;

/** Minimum auto-sync interval per room (minutes). */
export const MESHCORE_ROOM_SYNC_MIN_INTERVAL_MINUTES = 60;

/**
 * Raw packet log: startup (and similar) can deliver two distinct LOG_RX frames for the same node's
 * FLOOD ADVERT within seconds; coalesce so the sniffer shows one row (newest wins).
 */
export const MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS = 8_000;

/** Delay before local SDK LoRa getConfig after configure (avoids BLE contention with remote admin). */
export const MESHTASTIC_LOCAL_LORA_CONFIG_DELAY_MS = 2_500;

/** Grace delay before transport teardown/reconnect after DeviceRestarting (Serial/BLE). */
export const MESHTASTIC_POST_REBOOT_RECONNECT_DELAY_MS = 15_000;
