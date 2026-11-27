/**
 * MeshCore MQTT multi-connection contract (chat broker + publish-only analyzer feeds).
 *
 * The chat connection is bidirectional (subscribe + chat publish); every other connection is a
 * publish-only packet-analyzer feed. Keeping the limits here lets main and renderer agree without
 * importing each other.
 */

export type MeshcoreMqttConnectionRole = 'chat' | 'feed';

/** Synthetic connection id for the single chat broker. */
export const MESHCORE_MQTT_CHAT_CONNECTION_ID = 'chat';

/**
 * Hard cap on simultaneous MeshCore MQTT sockets. The chat broker occupies one slot, so a user can
 * run up to three analyzer feeds at once. Each feed is a TLS socket plus its own reconnect timers.
 */
export const MAX_MESHCORE_MQTT_CONNECTIONS = 4;

/** Saved publish-feed limit (8 matches the number of built-in MeshCore broker presets). */
export const MAX_MESHCORE_MQTT_PUBLISH_FEEDS = 8;

/** Enabled publish feeds allowed while the chat broker holds the fourth slot. */
export const MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS = MAX_MESHCORE_MQTT_CONNECTIONS - 1;
