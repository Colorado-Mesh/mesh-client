import { MS_PER_MINUTE } from '../../shared/timeConstants';

export {
  CHAT_COMPACT_CONTINUATION_TIME_GAP_MS,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
} from '../../shared/timeConstants';

/** MeshCore Ping (`tracePath`) end-to-end cap (queue wait + radio); matches `useMeshCore` `withTimeout`. */
export const MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS = 180_000;

/**
 * Max wait for `RESP_CODE_SENT` after `CMD_SEND_TRACE_PATH`. If the companion never acks, the
 * multiplex must reject so `runSerialized` does not stall and pending tags are cleared.
 */
export const MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS = 45_000;

/** Extra wait after SENT for room server login over RF (multi-hop); meshcore.js adds this to estTimeout. */
export const MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_MS = 45_000;

/** Post-SENT wait when the room server is direct on mesh (0 hops). LAN/TCP users often hit this path. */
export const MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_DIRECT_MS = 15_000;

/**
 * Base post-SENT extra wait before hop scaling in `computeRoomLoginExtraTimeoutMs`.
 * Matches outbound DM ACK timeout base in `useMeshcoreRuntime` (`3s base + per-hop increment`).
 */
export const MESHCORE_ROOM_LOGIN_HOP_BASE_MS = 3_000;

/** Per-hop increment for post-SENT extra wait; each relay adds airtime and queueing on the path. */
export const MESHCORE_ROOM_LOGIN_HOP_INCREMENT_MS = 2_500;

/**
 * Minimum LoginSuccess/LoginFail wait for 1+ hop paths in `computeRoomLoginResponseWaitMs`.
 * Aligns with the RF extra-timeout floor; hop floor uses a larger per-hop increment below.
 */
export const MESHCORE_ROOM_LOGIN_RESPONSE_HOP_BASE_MS = MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_MS;

/** Per-hop increment for LoginSuccess/LoginFail floor (response may re-traverse the mesh). */
export const MESHCORE_ROOM_LOGIN_RESPONSE_HOP_INCREMENT_MS = 20_000;

/** Max wait for `RESP_SENT` after SendLogin before rejecting (companion never acked the command). */
export const MESHCORE_ROOM_LOGIN_SENT_WAIT_MS = MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS;

/** SendLogin SENT ack wait when companion is TCP or USB serial (local link, not BLE). */
export const MESHCORE_ROOM_LOGIN_SENT_WAIT_DIRECT_MS = 15_000;

/** Companion transport for room login timeout selection. */
export type MeshcoreCompanionTransport = 'ble' | 'serial' | 'tcp';

/** Hop-scaled floor for room login response wait (matches outbound DM ACK formula in useMeshcoreRuntime). */
export function computeRoomLoginExtraTimeoutMs(hopsAway?: number | null): number {
  if (hopsAway == null || !Number.isFinite(hopsAway)) {
    return MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_MS;
  }
  const hops = Math.trunc(hopsAway);
  if (hops <= 0) {
    return MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_DIRECT_MS;
  }
  const hopScaled = MESHCORE_ROOM_LOGIN_HOP_BASE_MS + hops * MESHCORE_ROOM_LOGIN_HOP_INCREMENT_MS;
  return Math.max(MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_MS, hopScaled);
}

/** Hard cap for multi-hop room login response wait. Without this, the hop floor in
 * `computeRoomLoginResponseWaitMs` grows unbounded and can exceed 6 minutes. */
export const MESHCORE_ROOM_LOGIN_RESPONSE_WAIT_CAP_MS = 90_000;

/**
 * Total wait for LoginSuccess/LoginFail after SendLogin SENT.
 * Firmware `estTimeout` is often too low on multi-hop paths; apply a hop-scaled floor.
 */
export function computeRoomLoginResponseWaitMs(
  hopsAway: number | null | undefined,
  estTimeoutMs: number,
): number {
  const est = Number.isFinite(estTimeoutMs) && estTimeoutMs > 0 ? Math.trunc(estTimeoutMs) : 0;
  const extra = computeRoomLoginExtraTimeoutMs(hopsAway);
  const hops =
    hopsAway != null && Number.isFinite(hopsAway) ? Math.max(0, Math.trunc(hopsAway)) : 0;
  const hopFloor =
    hops <= 0
      ? 0
      : MESHCORE_ROOM_LOGIN_RESPONSE_HOP_BASE_MS +
        hops * MESHCORE_ROOM_LOGIN_RESPONSE_HOP_INCREMENT_MS;
  return Math.min(MESHCORE_ROOM_LOGIN_RESPONSE_WAIT_CAP_MS, Math.max(est + extra, hopFloor));
}

/** Max wall time for route resolve (flood + trace) before SendLogin. */
export const MESHCORE_ROOM_LOGIN_ROUTE_RESOLVE_MAX_MS = 90_000;

/** getContacts / setContactPath during login path sync. */
export const MESHCORE_ROOM_LOGIN_PATH_SYNC_TIMEOUT_MS = 25_000;

/** Entire loginRoom (resolve + sync + RPC) wall clock. */
export const MESHCORE_ROOM_LOGIN_TOTAL_TIMEOUT_MS = 120_000;

/** Max wait for SendLogin `RESP_SENT` before rejecting; shorter on TCP/serial companion links. */
export function computeRoomLoginSentWaitMs(
  companionTransport: MeshcoreCompanionTransport = 'ble',
): number {
  return companionTransport === 'ble'
    ? MESHCORE_ROOM_LOGIN_SENT_WAIT_MS
    : MESHCORE_ROOM_LOGIN_SENT_WAIT_DIRECT_MS;
}

/** Cap wait for SendLogin / room post `sendTextMessage` Sent response (meshcore.js has no timeout). */
export const MESHCORE_ROOM_POST_SENT_TIMEOUT_MS = 45_000;

/** RF vs MQTT duplicate merge for channel/DM text (delayed dual ingress). */
export const MESHCORE_CROSS_TRANSPORT_DEDUP_WINDOW_MS = 5 * MS_PER_MINUTE;

/** Same broadcast channel message heard twice on RF (repeater re-hear) within this window. */
export const MESHCORE_CHANNEL_RF_DEDUP_WINDOW_MS = 5 * MS_PER_MINUTE;

/** Same DM body re-heard on RF (multi-path / repeater echo) within this window. */
export const MESHCORE_DM_RF_DEDUP_WINDOW_MS = 2 * MS_PER_MINUTE;

/** PacketRouter tapback optimistic row match before Meshtastic RF echo re-key (temp packet_id → real id).
 * Wider than room post dedup (1 min) because client Date.now vs radio rxTime can skew several minutes. */
export const MESHTASTIC_TAPBACK_OPTIMISTIC_DEDUP_WINDOW_MS = 10 * MS_PER_MINUTE;

/** Room post dedup window: optimistic client timestamp vs firmware echo / replay overlap. */
export const MESHCORE_ROOM_POST_DEDUP_WINDOW_MS = MS_PER_MINUTE;

/**
 * Outbound tapback vs RF/MQTT echo of `@[Name] emoji`.
 * Wider than room post dedup (1 min) because client Date.now vs radio rxTime can skew several minutes.
 */
export const MESHCORE_TAPBACK_ECHO_DEDUP_WINDOW_MS = 10 * MS_PER_MINUTE;

/** Room login attempts before giving up (matches MeshMonitor loginToRoom). */
export const MESHCORE_ROOM_LOGIN_MAX_ATTEMPTS = 2;

/** Delay between failed room login attempts. */
export const MESHCORE_ROOM_LOGIN_RETRY_DELAY_MS = 2_000;

/** Background room sync scheduler tick interval. */
export const MESHCORE_ROOM_SYNC_TICK_MS = 60_000;

/** Periodic poll for local radio stats while connected (useMeshcoreRuntime). */
export const MESHCORE_STATS_POLL_MS = 30_000;

/** Safety-net poll for queued waiting messages when event 131 may have been missed. */
export const MESHCORE_WAITING_MESSAGES_POLL_MS = 5 * MS_PER_MINUTE;

/** Minimum spacing between mesh TX operations used by room sync (login counts as TX). */
export const MESHCORE_ROOM_SYNC_MIN_MESH_TX_SPACING_MS = 60_000;

/** Minimum auto-sync interval per room (minutes). */
export const MESHCORE_ROOM_SYNC_MIN_INTERVAL_MINUTES = 60;

/** Max wait for scheduler background route resolve (contacts only, no trace). */
export const MESHCORE_ROOM_SYNC_ROUTE_RESOLVE_FAST_MS = 15_000;

/** Delay before one retry of getMetadata after configure (NodeDB flood can starve BLE). */
export const MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS = 8_000;

/**
 * Raw packet log: startup (and similar) can deliver two distinct LOG_RX frames for the same node's
 * FLOOD ADVERT within seconds; coalesce so the sniffer shows one row (newest wins).
 */
export const MESHCORE_RAW_SELF_FLOOD_ADVERT_COALESCE_MS = 8_000;

/** Delay before local SDK LoRa getConfig after configure (avoids BLE contention with remote admin). */
export const MESHTASTIC_LOCAL_LORA_CONFIG_DELAY_MS = 2_500;

/** Grace delay before transport teardown/reconnect after DeviceRestarting (Serial/BLE). */
export const MESHTASTIC_POST_REBOOT_RECONNECT_DELAY_MS = 15_000;

/** Max wait before MeshCore `getContacts` when Meshtastic Noble BLE is still configuring. */
export const MESHCORE_DUAL_NOBLE_BLE_GET_CONTACTS_DEFER_MS = 4_000;

/** After macOS/Windows wake, wait for Meshtastic Noble configure before MeshCore BLE reconnect. */
export const POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS = 30_000;

/** Poll interval inside `awaitDualNobleBleMeshtasticSettle`. */
export const MESHCORE_DUAL_NOBLE_BLE_POLL_MS = 200;

/** BlueZ is slower than macOS CBCentralManager — requestDevice / reuse granted device. */
export const MESHCORE_WEB_BLUETOOTH_REQUEST_DEVICE_TIMEOUT_MS = 60_000;

/** Web Bluetooth transport connect (Linux MeshCore companion). */
export const MESHCORE_WEB_BLUETOOTH_CONNECT_TIMEOUT_MS = 60_000;

/** MeshCore BLE protocol handshake after Web Bluetooth connect. */
export const MESHCORE_WEB_BLUETOOTH_HANDSHAKE_TIMEOUT_MS = 20_000;

/** Exponential backoff cap for RF auto-reconnect (2s × 2^attempt, max this value). */
export const MESHCORE_MAX_RECONNECT_DELAY_MS = 32_000;
