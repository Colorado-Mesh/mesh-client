import { sanitizeLogMessage } from '@/main/sanitize-log-message';

import { isValidLatLon } from '../../../shared/geoCoords';
import { meshcoreContactDisplayName } from '../../../shared/meshcoreContactSanitize';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from '../../lib/chatInMemoryBuffer';
import type {
  MeshCoreConnection,
  MeshcoreContactDbRow,
  MeshCoreContactRaw,
} from '../../lib/meshcore/meshcoreHookTypes';
import { registerMeshcorePubKey } from '../../lib/meshcore/meshcorePubKeyRegistry';
import {
  meshcoreChatMessagesForDisplay,
  normalizeMeshcoreIncomingText,
} from '../../lib/meshcoreChannelText';
import {
  CONTACT_TYPE_LABELS,
  isMeshcoreTransportStatusChatLine,
  MESHCORE_COORD_SCALE,
  MESHCORE_SENDER_RECONCILE_MAX_PAYLOAD_LEN,
  MESHCORE_UNKNOWN_SENDER_STUB_ID,
  meshcoreChatStubNodeIdFromDisplayName,
  meshcoreInferHopsFromOutPath,
  meshcoreIsChatStubNodeId,
  meshcoreIsSyntheticPlaceholderPubKeyHex,
  meshcoreMergeChannelDisplayNameOntoNode,
  minimalMeshcoreChatNode,
  pubkeyToNodeId,
} from '../../lib/meshcoreUtils';
import {
  effectiveMessageTimestampMs,
  mergeMeshcoreLastHeardFromAdvert,
} from '../../lib/nodeStatus';
import {
  MESHCORE_CHANNEL_RF_DEDUP_WINDOW_MS,
  MESHCORE_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
  MESHCORE_DM_RF_DEDUP_WINDOW_MS,
  MESHCORE_ROOM_POST_DEDUP_WINDOW_MS,
  MESHCORE_TAPBACK_ECHO_DEDUP_WINDOW_MS,
} from '../../lib/timeConstants';

export {
  MESHCORE_CHANNEL_RF_DEDUP_WINDOW_MS,
  MESHCORE_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
  MESHCORE_DM_RF_DEDUP_WINDOW_MS,
  MESHCORE_ROOM_POST_DEDUP_WINDOW_MS,
  MESHCORE_TAPBACK_ECHO_DEDUP_WINDOW_MS,
} from '../../lib/timeConstants';
import type { ChatMessage, DeviceState, MeshNode } from '../../lib/types';

/** MeshCore expected ACK CRCs are uint32; meshcore.js / BLE may surface them as signed. Normalize for Map keys, React state, and SQLite packet_id. */
export function meshcoreDmAckKeyU32(crc: number): number {
  return crc >>> 0;
}

/**
 * Firmware `estTimeout` is sometimes only a few seconds; multi-hop / repeater paths often exceed
 * that before event 130. Wait at least this long before marking outbound DM as failed.
 */
export const MESHCORE_DM_ACK_TIMEOUT_MIN_MS = 45_000;

/** Register pending DM ACK under every JS number the stack might use for the same CRC (signed vs unsigned). */
export function meshcorePendingDmAckMapKeys(ackCrc: number): number[] {
  return Array.from(new Set([ackCrc, meshcoreDmAckKeyU32(ackCrc)]));
}

/** Try device-reported codes in both representations when looking up a pending send. */
export function meshcoreDeviceAckLookupKeys(codeFromDevice: number): number[] {
  return Array.from(new Set([codeFromDevice, meshcoreDmAckKeyU32(codeFromDevice)]));
}

export interface PendingDmAckEntry {
  timeoutId: ReturnType<typeof setTimeout>;
  /** Every `pendingAcksRef` key that references this entry. */
  mapKeys: number[];
  /** Same as `ChatMessage.packetId` / DB `packet_id` for this send (uint32). */
  canonicalPacketIdU32: number;
  /** Destination node for path outcome attribution. */
  destNodeId?: number;
  /** Path hash of the route used for this send (empty string = flood). */
  pathHash?: string;
}

export function meshcoreContactRawFromDevice(c: MeshCoreContactRaw): MeshCoreContactRaw {
  const f = (c as { flags?: number }).flags;
  const flags = typeof f === 'number' && Number.isFinite(f) ? f & 0xff : 0;
  return { ...c, flags };
}

export function contactToDbRow(
  contact: MeshCoreContactRaw,
  nickname?: string | null,
  onRadio = 0,
  lastSyncedFromRadio?: string | null,
  mergedHopsAway?: number,
) {
  return {
    node_id: pubkeyToNodeId(contact.publicKey),
    public_key: Array.from(contact.publicKey)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(''),
    adv_name: contact.advName ?? null,
    contact_type: contact.type,
    last_advert: contact.lastAdvert ?? null,
    adv_lat: contact.advLat !== 0 ? contact.advLat / MESHCORE_COORD_SCALE : null,
    adv_lon: contact.advLon !== 0 ? contact.advLon / MESHCORE_COORD_SCALE : null,
    nickname: nickname ?? null,
    contact_flags: contact.flags & 0xff,
    hops_away: mergedHopsAway ?? meshcoreInferHopsFromOutPath(contact) ?? null,
    on_radio: onRadio ?? 0,
    last_synced_from_radio: lastSyncedFromRadio ?? null,
  };
}

function meshcoreReceivedViaFromDb(raw: unknown): NonNullable<ChatMessage['receivedVia']> {
  if (raw === 'mqtt' || raw === 'both') return raw;
  return 'rf';
}

/** MeshCore chat channel index for room server BBS posts (not DMs at -1). */
export const MESHCORE_ROOM_MESSAGE_CHANNEL = -2;

/** Room BBS posts use `roomServerId` / channel -2; they must not appear in Chat DM tabs. */
export function isMeshcoreRoomChatMessage(msg: {
  roomServerId?: number;
  channel?: number;
}): boolean {
  return msg.roomServerId != null || msg.channel === MESHCORE_ROOM_MESSAGE_CHANNEL;
}

export function messageToDbRow(
  msg: ChatMessage,
): Parameters<typeof window.electronAPI.db.saveMeshcoreMessage>[0] {
  const received_via =
    msg.receivedVia === 'rf' || msg.receivedVia === 'mqtt' || msg.receivedVia === 'both'
      ? msg.receivedVia
      : null;
  return {
    sender_id: msg.sender_id !== 0 ? msg.sender_id : null,
    sender_name: msg.sender_name ?? null,
    payload: msg.payload,
    channel_idx: msg.channel,
    timestamp: msg.timestamp,
    status: msg.status ?? 'acked',
    packet_id: msg.packetId ?? null,
    emoji: msg.emoji ?? null,
    reply_id: msg.replyId ?? null,
    to_node: msg.to ?? null,
    received_via,
    rx_packet_fingerprint: msg.rxPacketFingerprintHex ?? null,
    reply_preview_text: msg.replyPreviewText ?? null,
    reply_preview_sender: msg.replyPreviewSender ?? null,
    rx_hops: msg.rxHops != null && Number.isFinite(msg.rxHops) ? Math.trunc(msg.rxHops) : null,
    room_server_id: msg.roomServerId ?? null,
  };
}

// Contact list streaming is O(N contacts) — use a generous timeout across all platforms.
export const MESHCORE_INIT_TIMEOUT_MS = 60_000;
/** Companion Ok/Err for `sendFloodAdvert` — meshcore.js has no internal timeout. */
export const MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS = 25_000;
/** Max time to wait for PathUpdated (129) after a flood advert when priming trace route. */
export const MESHCORE_TRACE_PRIME_WAIT_MS = 12_000;

/** Shown when multi-hop trace cannot run until the radio reports a route; UI auto-clears after {@link MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS}. */
export const MESHCORE_PING_NO_ROUTE_ERROR_MSG =
  'No route from radio yet — multi-hop trace needs a synced path. Wait for contact updates or reconnect.';
export const MESHCORE_PING_NO_ROUTE_ERROR_DISPLAY_MS = 20_000;

/** Clears {@link MESHCORE_PING_NO_ROUTE_ERROR_MSG} for `nodeId` if unchanged (traceRoute expiry). */
export function meshcorePingNoRouteErrorExpiryUpdate(
  prev: Map<number, string>,
  nodeId: number,
): Map<number, string> {
  const next = new Map(prev);
  if (next.get(nodeId) === MESHCORE_PING_NO_ROUTE_ERROR_MSG) {
    next.delete(nodeId);
  }
  return next;
}

export function serializeErrorLike(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof (value as Record<string, unknown>).message === 'string')
    return (value as Record<string, unknown>).message as string;
  try {
    return JSON.stringify(value);
  } catch {
    // catch-no-log-ok stringify fallback for arbitrary error payloads
    return '[unserializable]';
  }
}

/** One string for Electron's renderer console forwarder (avoids "[object Object]" in disk logs). */
export function formatStructuredLogDetail(detail: Record<string, unknown>): string {
  try {
    return sanitizeLogMessage(JSON.stringify(detail));
  } catch {
    // catch-no-log-ok stringify fallback for circular / non-serializable log payloads
    return sanitizeLogMessage('{}');
  }
}

/** Wait for companion push 0x81 (129 PathUpdated) for a specific node's pubkey. */
export function waitForMeshcorePath129ForNode(
  conn: Pick<MeshCoreConnection, 'on' | 'off'>,
  nodeId: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      conn.off(129, on129);
      resolve(ok);
    };
    const on129 = (data: unknown) => {
      const d = data as { publicKey?: Uint8Array };
      if (d.publicKey?.length !== 32) return;
      if (pubkeyToNodeId(d.publicKey) !== nodeId) return;
      finish(true);
    };
    const t = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    conn.on(129, on129);
  });
}
export const MANUAL_CONTACTS_KEY = 'mesh-client:meshcoreManualContacts';

export const INITIAL_STATE: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  connectionType: null,
};

export const MAX_DEVICE_LOGS = 500;

/** Repeater RPCs (tracePath, getStatus, getTelemetry, sendBinaryRequest neighbours). */
const MESHCORE_REPEATER_RPC_TIMEOUT_MS = 120_000;
export const MESHCORE_STATUS_TIMEOUT_MS = MESHCORE_REPEATER_RPC_TIMEOUT_MS;
export const MESHCORE_TELEMETRY_TIMEOUT_MS = MESHCORE_REPEATER_RPC_TIMEOUT_MS;
export const MESHCORE_NEIGHBORS_TIMEOUT_MS = MESHCORE_REPEATER_RPC_TIMEOUT_MS;
export const MESHCORE_TRACE_TIMEOUT_MS = MESHCORE_REPEATER_RPC_TIMEOUT_MS;
export const MAX_TELEMETRY_POINTS = 50;

export const MAX_ENV_TELEMETRY_POINTS = 50;

/** @see @liamcottle/meshcore.js Constants.ResponseCodes.DeviceInfo */
export const MESHCORE_RESPONSE_DEVICE_INFO = 13;

/** Companion protocol version byte sent with CMD DeviceQuery; must match meshcore.js onConnected. */
export const MESHCORE_DEVICE_QUERY_APP_VER = 1;

/**
 * Normalizes an error from a MeshCore RPC call into a proper Error object.
 * Handles edge cases like undefined errors, errors without messages, and non-Error objects.
 */
export function normalizeMeshCoreError(e: unknown, fallbackMessage: string): Error {
  if (e === undefined || (e instanceof Error && !e.message)) {
    return new Error(fallbackMessage);
  }
  if (e instanceof Error) {
    return e;
  }
  return new Error(typeof e === 'string' ? e : 'Unknown error');
}

/** meshcore.js `tracePath` may reject with `undefined`; avoid `String(object)` pitfalls. */
export function meshcoreTraceRouteRejectReason(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e === undefined || e === null) return 'radio rejected trace (no detail)';
  if (typeof e === 'string') return e;
  if (typeof e === 'number' || typeof e === 'boolean' || typeof e === 'bigint') return String(e);
  try {
    return JSON.stringify(e);
  } catch {
    // catch-no-log-ok JSON.stringify throws on circular/non-serializable values
    return 'unknown error';
  }
}

export function meshcoreMessageDedupeKey(msg: ChatMessage): string {
  const body = msg.meshcoreDedupeKey ?? msg.payload;
  return [
    msg.sender_id,
    msg.to ?? '',
    msg.channel,
    msg.timestamp,
    body,
    msg.emoji ?? '',
    msg.replyId ?? '',
  ].join('|');
}

const MESHCORE_CROSS_TRANSPORT_SCAN_LIMIT = 200;

function normalizeMeshcoreSenderNameForDedup(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

function meshcoreSenderMatchesForDedup(a: ChatMessage, b: ChatMessage): boolean {
  if (a.sender_id === b.sender_id) return true;
  const aStub = meshcoreIsChatStubNodeId(a.sender_id);
  const bStub = meshcoreIsChatStubNodeId(b.sender_id);
  if (!aStub && !bStub) return false;
  const aName = normalizeMeshcoreSenderNameForDedup(a.sender_name);
  const bName = normalizeMeshcoreSenderNameForDedup(b.sender_name);
  return aName.length > 0 && aName === bName;
}

function meshcoreTransportsAreCross(existing: ChatMessage, incoming: ChatMessage): boolean {
  const existingVia = existing.receivedVia;
  const incomingVia = incoming.receivedVia;
  if (!existingVia || !incomingVia) return false;
  if (existingVia === incomingVia || existingVia === 'both' || incomingVia === 'both') return false;
  return true;
}

function meshcoreReceivedViaMerged(
  existing: ChatMessage['receivedVia'],
  incoming: ChatMessage['receivedVia'],
): ChatMessage['receivedVia'] {
  if (existing === 'both' || incoming === 'both') return 'both';
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (existing !== incoming) return 'both';
  return existing;
}

export function meshcoreCrossTransportMatch(
  existing: ChatMessage,
  incoming: ChatMessage,
  windowMs: number = MESHCORE_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
): boolean {
  if (!meshcoreTransportsAreCross(existing, incoming)) return false;
  if (!meshcoreSenderMatchesForDedup(existing, incoming)) return false;
  if (existing.channel !== incoming.channel) return false;
  if ((existing.to ?? undefined) !== (incoming.to ?? undefined)) return false;
  if ((existing.emoji ?? undefined) !== (incoming.emoji ?? undefined)) return false;
  if ((existing.replyId ?? undefined) !== (incoming.replyId ?? undefined)) return false;
  const existingBody = existing.meshcoreDedupeKey ?? existing.payload;
  const incomingBody = incoming.meshcoreDedupeKey ?? incoming.payload;
  if (existingBody !== incomingBody && existing.payload !== incoming.payload) return false;
  if (Math.abs(existing.timestamp - incoming.timestamp) > windowMs) return false;
  return true;
}

function meshcoreIsBroadcastChannelMessage(msg: ChatMessage): boolean {
  return msg.channel != null && msg.channel >= 0 && msg.roomServerId == null;
}

function meshcoreReceivedViaIncludesRf(via: ChatMessage['receivedVia']): boolean {
  return via === 'rf' || via === 'both';
}

/** Same broadcast channel text heard again on RF (repeater re-hear), not RF/MQTT cross-path. */
export function meshcoreChannelRfMatch(
  existing: ChatMessage,
  incoming: ChatMessage,
  windowMs: number = MESHCORE_CHANNEL_RF_DEDUP_WINDOW_MS,
): boolean {
  if (
    !meshcoreIsBroadcastChannelMessage(existing) ||
    !meshcoreIsBroadcastChannelMessage(incoming)
  ) {
    return false;
  }
  if (existing.emoji != null || incoming.emoji != null) return false;
  if (!meshcoreReceivedViaIncludesRf(existing.receivedVia)) return false;
  if (incoming.receivedVia !== 'rf') return false;
  if (meshcoreTransportsAreCross(existing, incoming)) return false;
  if (!meshcoreSenderMatchesForDedup(existing, incoming)) return false;
  if (existing.channel !== incoming.channel) return false;
  if ((existing.to ?? undefined) !== (incoming.to ?? undefined)) return false;
  if ((existing.replyId ?? undefined) !== (incoming.replyId ?? undefined)) return false;
  const existingBody = existing.meshcoreDedupeKey ?? existing.payload;
  const incomingBody = incoming.meshcoreDedupeKey ?? incoming.payload;
  if (existingBody !== incomingBody && existing.payload !== incoming.payload) return false;
  if (Math.abs(existing.timestamp - incoming.timestamp) > windowMs) return false;
  return true;
}

export function findMeshcoreChannelRfDuplicate(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
  windowMs: number = MESHCORE_CHANNEL_RF_DEDUP_WINDOW_MS,
): ChatMessage | undefined {
  const start = Math.max(0, messages.length - MESHCORE_CROSS_TRANSPORT_SCAN_LIMIT);
  for (let i = messages.length - 1; i >= start; i--) {
    const existing = messages[i];
    if (meshcoreChannelRfMatch(existing, incoming, windowMs)) {
      return existing;
    }
  }
  return undefined;
}

function meshcoreIsDmMessage(msg: ChatMessage): boolean {
  return msg.channel === -1 && msg.to != null;
}

/** Same DM text heard again on RF (repeater / multi-path echo), not RF/MQTT cross-path. */
export function meshcoreDmRfMatch(
  existing: ChatMessage,
  incoming: ChatMessage,
  windowMs: number = MESHCORE_DM_RF_DEDUP_WINDOW_MS,
): boolean {
  if (!meshcoreIsDmMessage(existing) || !meshcoreIsDmMessage(incoming)) return false;
  if (existing.emoji != null || incoming.emoji != null) return false;
  if (existing.receivedVia !== 'rf' || incoming.receivedVia !== 'rf') return false;
  if (meshcoreTransportsAreCross(existing, incoming)) return false;
  if (!meshcoreSenderMatchesForDedup(existing, incoming)) return false;
  if ((existing.to ?? undefined) !== (incoming.to ?? undefined)) return false;
  if ((existing.replyId ?? undefined) !== (incoming.replyId ?? undefined)) return false;
  const existingBody = existing.meshcoreDedupeKey ?? existing.payload;
  const incomingBody = incoming.meshcoreDedupeKey ?? incoming.payload;
  if (existingBody !== incomingBody && existing.payload !== incoming.payload) return false;
  if (Math.abs(existing.timestamp - incoming.timestamp) > windowMs) return false;
  return true;
}

export function findMeshcoreDmRfDuplicate(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
  windowMs: number = MESHCORE_DM_RF_DEDUP_WINDOW_MS,
): ChatMessage | undefined {
  const start = Math.max(0, messages.length - MESHCORE_CROSS_TRANSPORT_SCAN_LIMIT);
  for (let i = messages.length - 1; i >= start; i--) {
    const existing = messages[i];
    if (meshcoreDmRfMatch(existing, incoming, windowMs)) {
      return existing;
    }
  }
  return undefined;
}

function meshcoreRoomServerIdForDedup(msg: ChatMessage): number | undefined {
  if (msg.roomServerId != null) return msg.roomServerId;
  if (msg.channel === MESHCORE_ROOM_MESSAGE_CHANNEL && msg.to != null) return msg.to;
  return undefined;
}

/** Same room, author, and body within a clock-skew window (RF echo / dual ingress). */
export function meshcoreRoomPostMatch(
  existing: ChatMessage,
  incoming: ChatMessage,
  windowMs: number = MESHCORE_ROOM_POST_DEDUP_WINDOW_MS,
): boolean {
  const existingRoom = meshcoreRoomServerIdForDedup(existing);
  const incomingRoom = meshcoreRoomServerIdForDedup(incoming);
  if (existingRoom == null || incomingRoom == null) return false;
  if (existingRoom !== incomingRoom) return false;
  if (!meshcoreSenderMatchesForDedup(existing, incoming)) return false;
  const existingBody = existing.meshcoreDedupeKey ?? existing.payload;
  const incomingBody = incoming.meshcoreDedupeKey ?? incoming.payload;
  if (existingBody !== incomingBody && existing.payload !== incoming.payload) return false;
  if (Math.abs(existing.timestamp - incoming.timestamp) > windowMs) return false;
  return true;
}

export function findMeshcoreRoomPostDuplicate(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
  windowMs: number = MESHCORE_ROOM_POST_DEDUP_WINDOW_MS,
): ChatMessage | undefined {
  const start = Math.max(0, messages.length - MESHCORE_CROSS_TRANSPORT_SCAN_LIMIT);
  for (let i = messages.length - 1; i >= start; i--) {
    const existing = messages[i];
    if (meshcoreRoomPostMatch(existing, incoming, windowMs)) {
      return existing;
    }
  }
  return undefined;
}

/** Outbound tapback (local optimistic) vs RF/MQTT echo of `@[Name] emoji` — same transport allowed. */
export function meshcoreTapbackEchoMatch(
  existing: ChatMessage,
  incoming: ChatMessage,
  windowMs: number = MESHCORE_TAPBACK_ECHO_DEDUP_WINDOW_MS,
): boolean {
  if (existing.emoji == null || incoming.emoji == null) return false;
  if ((existing.replyId ?? undefined) !== (incoming.replyId ?? undefined)) return false;
  if (existing.channel !== incoming.channel) return false;
  if ((existing.to ?? undefined) !== (incoming.to ?? undefined)) return false;
  if (existing.emoji !== incoming.emoji) return false;
  if (!meshcoreSenderMatchesForDedup(existing, incoming)) return false;
  if (Math.abs(existing.timestamp - incoming.timestamp) > windowMs) return false;
  return true;
}

export function findMeshcoreTapbackEchoDuplicate(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
  windowMs: number = MESHCORE_TAPBACK_ECHO_DEDUP_WINDOW_MS,
): ChatMessage | undefined {
  const start = Math.max(0, messages.length - MESHCORE_CROSS_TRANSPORT_SCAN_LIMIT);
  for (let i = messages.length - 1; i >= start; i--) {
    const existing = messages[i];
    if (meshcoreTapbackEchoMatch(existing, incoming, windowMs)) {
      return existing;
    }
  }
  return undefined;
}

export function findMeshcoreCrossTransportDuplicate(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
  windowMs: number = MESHCORE_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
): ChatMessage | undefined {
  const start = Math.max(0, messages.length - MESHCORE_CROSS_TRANSPORT_SCAN_LIMIT);
  for (let i = messages.length - 1; i >= start; i--) {
    const existing = messages[i];
    if (meshcoreCrossTransportMatch(existing, incoming, windowMs)) {
      return existing;
    }
  }
  return undefined;
}

export function mapMeshcoreCrossTransportUpgrade(
  messages: readonly ChatMessage[],
  incoming: ChatMessage,
  windowMs: number = MESHCORE_CROSS_TRANSPORT_DEDUP_WINDOW_MS,
): { messages: ChatMessage[]; matched: boolean } {
  let matched = false;
  const next = messages.map((m) => {
    if (!meshcoreCrossTransportMatch(m, incoming, windowMs)) return m;
    matched = true;
    return {
      ...m,
      receivedVia: meshcoreReceivedViaMerged(m.receivedVia, incoming.receivedVia),
    };
  });
  return { messages: matched ? next : [...messages], matched };
}

/** Match DB vs live without `meshcoreDedupeKey` (DB rows only have normalized payload). */
function meshcoreLoosePersistenceMatchKey(msg: ChatMessage): string {
  const roomKey =
    msg.roomServerId != null
      ? String(msg.roomServerId)
      : msg.channel === MESHCORE_ROOM_MESSAGE_CHANNEL && msg.to != null
        ? String(msg.to)
        : '';
  return [
    msg.sender_id,
    msg.channel,
    msg.timestamp,
    msg.payload,
    msg.to ?? '',
    roomKey,
    msg.emoji ?? '',
    msg.replyId ?? '',
  ].join('|');
}

/** RF/MQTT can deliver lines before `getMeshcoreMessages` resolves; replacing state would drop them. */
export function mergeMeshcoreDbHydrationWithLive(
  prev: ChatMessage[],
  fromDb: ChatMessage[],
  opts?: { replaceFromDb?: boolean },
): ChatMessage[] {
  if (opts?.replaceFromDb) {
    const sorted = [...fromDb];
    sorted.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return (a.id ?? 0) - (b.id ?? 0);
    });
    return trimChatMessagesToMax(sorted, MAX_IN_MEMORY_CHAT_MESSAGES);
  }
  const dbLoose = new Set(fromDb.map(meshcoreLoosePersistenceMatchKey));
  const inFlight = prev.filter((m) => {
    if (m.id != null) return !fromDb.some((d) => d.id === m.id);
    return !dbLoose.has(meshcoreLoosePersistenceMatchKey(m));
  });
  const merged = [...fromDb, ...inFlight];
  merged.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return (a.id ?? 0) - (b.id ?? 0);
  });
  return trimChatMessagesToMax(merged, MAX_IN_MEMORY_CHAT_MESSAGES);
}

/** Hop metadata row from shared `nodes` table. */
export interface MeshcoreSavedNodeHopRow {
  node_id: number;
  hops_away: number | null;
  hops: number | null;
}

/**
 * Build a MeshNode map from persisted MeshCore contacts + hop counts (+ optional message stubs).
 * Mirrors mount hydration in `useMeshcoreRuntime.reloadMeshcoreNodesFromDb`.
 */
export function buildMeshcoreNodeMapFromDb(
  dbContacts: MeshcoreContactDbRow[],
  savedNodes: MeshcoreSavedNodeHopRow[],
  messages: ChatMessage[] = [],
): Map<number, MeshNode> {
  const initial = new Map<number, MeshNode>();
  for (const row of dbContacts) {
    const coords = isValidLatLon(row.adv_lat, row.adv_lon)
      ? { latitude: row.adv_lat!, longitude: row.adv_lon! }
      : { latitude: null as number | null, longitude: null as number | null };
    const node: MeshNode = {
      node_id: row.node_id,
      long_name: meshcoreContactDisplayName(row.node_id, row.adv_name, row.nickname),
      short_name: '',
      hw_model: CONTACT_TYPE_LABELS[row.contact_type] ?? 'Unknown',
      battery: 0,
      snr: row.last_snr ?? 0,
      rssi: row.last_rssi ?? 0,
      last_heard: mergeMeshcoreLastHeardFromAdvert(row.last_advert, undefined),
      latitude: coords.latitude,
      longitude: coords.longitude,
      favorited: row.favorited === 1,
      hops_away: row.hops_away ?? undefined,
    };
    initial.set(row.node_id, node);
  }
  for (const n of savedNodes) {
    const hopCount = n.hops ?? n.hops_away;
    if (hopCount != null) {
      const existing = initial.get(n.node_id);
      if (existing && existing.hops_away === undefined) {
        initial.set(n.node_id, { ...existing, hops_away: hopCount });
      }
    }
  }
  const mergedInitial = mergeStubNodesFromMeshcoreMessages(initial, messages);
  for (const n of savedNodes) {
    const hopCount = n.hops ?? n.hops_away;
    if (hopCount == null) continue;
    const existing = mergedInitial.get(n.node_id);
    if (existing && existing.hops_away === undefined) {
      mergedInitial.set(n.node_id, { ...existing, hops_away: hopCount });
    }
  }
  return mergedInitial;
}

/** Row shape from `db:getMeshcoreMessages` — shared by initConn, mount load, refreshMessagesFromDb. */
export interface MeshcoreMessageDbRow {
  id: number;
  sender_id: number | null;
  sender_name: string | null;
  payload: string;
  channel_idx: number;
  timestamp: number;
  status: string;
  packet_id: number | null;
  emoji: number | null;
  reply_id: number | null;
  to_node: number | null;
  received_via?: string | null;
  rx_packet_fingerprint?: string | null;
  reply_preview_text?: string | null;
  reply_preview_sender?: string | null;
  rx_hops?: number | null;
  room_server_id?: number | null;
}

/**
 * Legacy DB rows may store the full RF line `DisplayName: body` with no usable sender_name.
 * Only then run wire-style normalize; otherwise persisted payload is already display text
 * (re-applying normalize breaks any body containing `:` e.g. `Re: …`, `12:30 …`).
 */
function shouldLegacyNormalizeMeshcoreDbPayload(
  senderName: string | null | undefined,
  payload: string,
): boolean {
  if (senderName && senderName !== 'Unknown') return false;
  const t = payload.trim();
  const ci = t.indexOf(':');
  if (ci <= 0 || t[ci + 1] !== ' ' || ci >= t.length - 1) return false;
  const left = t.slice(0, ci).trim();
  const right = t.slice(ci + 1).trim();
  if (left.length < 6 || right.length < 1) return false;
  if (left.includes('\n')) return false;
  return true;
}

function coerceOptionalDbInt(v: number | string | null | undefined): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function safeEmojiCodepoint(v: number | string | null | undefined): number | undefined {
  const n = coerceOptionalDbInt(v);
  if (n != null && n >= 1 && n <= 0x10ffff) return n;
  return undefined;
}

/** 32-byte pubkey from `meshcore_contacts.public_key` hex, or null if synthetic / invalid length. */
export function meshcoreFullPubKeyBytesFromContactDbHex(raw: string): Uint8Array | null {
  const hex = raw.replace(/\s/g, '');
  if (meshcoreIsSyntheticPlaceholderPubKeyHex(hex)) return null;
  if (hex.length !== 64) return null;
  const pairs = hex.match(/.{2}/g);
  if (pairs?.length !== 32) return null;
  return new Uint8Array(pairs.map((b) => parseInt(b, 16)));
}

/** Pre-seed global pubkey registry from SQLite before PacketRouter subscribe (DM prefix decode). */
export function registerMeshcorePubKeysFromContactDbRows(
  rows: readonly Pick<MeshcoreContactDbRow, 'node_id' | 'public_key'>[],
): void {
  for (const row of rows) {
    const bytes = meshcoreFullPubKeyBytesFromContactDbHex(row.public_key);
    if (!bytes) continue;
    registerMeshcorePubKey(row.node_id, bytes);
  }
}

export interface MergeMeshcoreDbContactsRefs {
  pubKeyByNodeId: Map<number, Uint8Array>;
  pubKeyPrefixByHex: Map<string, number>;
  nicknameByNodeId: Map<number, string>;
}

/** Merge persisted SQLite contacts into an in-memory node map (off-radio imports, favorited flags). */
export async function mergeMeshcoreContactsFromDbIntoNodeMap(
  nextNodes: Map<number, MeshNode>,
  prevSnap: Map<number, MeshNode>,
  refs: MergeMeshcoreDbContactsRefs,
): Promise<void> {
  const dbContacts = (await window.electronAPI.db.getMeshcoreContacts()) as MeshcoreContactDbRow[];
  for (const row of dbContacts) {
    if (refs.pubKeyByNodeId.has(row.node_id)) continue;
    const bytes = meshcoreFullPubKeyBytesFromContactDbHex(row.public_key);
    if (!bytes) continue;
    refs.pubKeyByNodeId.set(row.node_id, bytes);
    const prefix = Array.from(bytes.slice(0, 6))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    refs.pubKeyPrefixByHex.set(prefix, row.node_id);
  }
  for (const row of dbContacts) {
    if (!nextNodes.has(row.node_id)) {
      const last_heard = mergeMeshcoreLastHeardFromAdvert(
        row.last_advert,
        prevSnap.get(row.node_id)?.last_heard,
      );
      const newHwModel = CONTACT_TYPE_LABELS[row.contact_type] ?? 'Unknown';
      const prevNode = prevSnap.get(row.node_id);
      const prevHwModel = prevNode?.hw_model;
      const mergedHwModel =
        prevHwModel && prevHwModel !== 'None' && prevHwModel !== 'Unknown'
          ? prevHwModel
          : newHwModel;
      nextNodes.set(row.node_id, {
        node_id: row.node_id,
        long_name: meshcoreContactDisplayName(row.node_id, row.adv_name, row.nickname),
        short_name: '',
        hw_model: mergedHwModel,
        battery: 0,
        snr: row.last_snr ?? 0,
        rssi: row.last_rssi ?? 0,
        last_heard,
        latitude: row.adv_lat ?? null,
        longitude: row.adv_lon ?? null,
        favorited: row.favorited === 1,
        hops_away: row.hops_away ?? prevSnap.get(row.node_id)?.hops_away,
      });
    }
  }
  for (const row of dbContacts as (MeshcoreContactDbRow & { hops?: number | null })[]) {
    const existing = nextNodes.get(row.node_id);
    if (!existing) continue;
    if (existing.hops_away === undefined) {
      const hopCount = row.hops_away ?? row.hops;
      if (hopCount != null) {
        nextNodes.set(row.node_id, { ...existing, hops_away: hopCount });
      }
    }
  }
  for (const row of dbContacts) {
    const existing = nextNodes.get(row.node_id);
    if (existing) {
      const fallbackSnr =
        typeof row.last_snr === 'number' && Number.isFinite(row.last_snr) && row.last_snr !== 0
          ? row.last_snr
          : null;
      const fallbackRssi =
        typeof row.last_rssi === 'number' && Number.isFinite(row.last_rssi) && row.last_rssi !== 0
          ? row.last_rssi
          : null;
      const nextSnr =
        typeof existing.snr === 'number' && Number.isFinite(existing.snr) && existing.snr !== 0
          ? existing.snr
          : (fallbackSnr ?? existing.snr);
      const nextRssi =
        typeof existing.rssi === 'number' && Number.isFinite(existing.rssi) && existing.rssi !== 0
          ? existing.rssi
          : (fallbackRssi ?? existing.rssi);
      nextNodes.set(row.node_id, {
        ...existing,
        favorited: row.favorited === 1,
        snr: nextSnr,
        rssi: nextRssi,
      });
    }
  }
  for (const row of dbContacts) {
    if (row.nickname) refs.nicknameByNodeId.set(row.node_id, row.nickname);
  }
}

function isAmbiguousMeshcoreSender(msg: Pick<ChatMessage, 'sender_id' | 'sender_name'>): boolean {
  return (
    msg.sender_id === 0 ||
    msg.sender_id === MESHCORE_UNKNOWN_SENDER_STUB_ID ||
    msg.sender_name === 'Unknown'
  );
}

/**
 * When the same channel+payload was stored under the global Unknown stub (or sender_id 0)
 * but a later row has a resolved display name, re-link the ambiguous rows to that sender.
 */
export function meshcoreReconcileChannelSenderIds(messages: ChatMessage[]): ChatMessage[] {
  const canonicalByKey = new Map<string, { senderId: number; senderName: string }>();
  for (const m of messages) {
    if (m.channel < 0) continue;
    if (isAmbiguousMeshcoreSender(m)) continue;
    canonicalByKey.set(`${m.channel}\0${m.payload}`, {
      senderId: m.sender_id,
      senderName: m.sender_name,
    });
  }
  return messages.map((m) => {
    if (m.channel < 0 || !isAmbiguousMeshcoreSender(m)) return m;
    if (m.payload.length > MESHCORE_SENDER_RECONCILE_MAX_PAYLOAD_LEN) return m;
    const canon = canonicalByKey.get(`${m.channel}\0${m.payload}`);
    if (!canon) return m;
    return { ...m, sender_id: canon.senderId, sender_name: canon.senderName };
  });
}

/** Map persisted MeshCore message rows to chat messages (stub sender id; trust stored payload). */
export function mapMeshcoreDbRowsToChatMessages(rows: MeshcoreMessageDbRow[]): ChatMessage[] {
  const mapped: ChatMessage[] = [];
  for (const r of rows) {
    if (isMeshcoreTransportStatusChatLine(r.payload)) continue;
    let displayPayload = r.payload;
    const normalized = normalizeMeshcoreIncomingText(r.payload);
    let displayName = r.sender_name && r.sender_name !== 'Unknown' ? r.sender_name : 'Unknown';
    if (normalized.senderName) {
      const storedName = r.sender_name?.trim();
      if (!storedName || storedName === 'Unknown') {
        displayPayload = normalized.payload;
        displayName = normalized.senderName;
      } else if (normalized.senderName === storedName) {
        displayPayload = normalized.payload;
      }
    } else if (shouldLegacyNormalizeMeshcoreDbPayload(r.sender_name, r.payload)) {
      displayPayload = normalized.payload;
      displayName = normalized.senderName ?? displayName;
    }
    let senderId = r.sender_id ?? 0;
    if (senderId === 0 && displayName && displayName !== 'Unknown') {
      senderId = meshcoreChatStubNodeIdFromDisplayName(displayName);
    }
    mapped.push({
      id: r.id,
      sender_id: senderId,
      sender_name: displayName,
      payload: displayPayload,
      channel: r.channel_idx,
      timestamp: effectiveMessageTimestampMs(r.timestamp),
      status: (r.status as ChatMessage['status']) ?? 'acked',
      packetId: r.packet_id ?? undefined,
      emoji: safeEmojiCodepoint(r.emoji),
      replyId: coerceOptionalDbInt(r.reply_id),
      to: r.to_node ?? undefined,
      receivedVia: meshcoreReceivedViaFromDb(r.received_via),
      rxPacketFingerprintHex:
        typeof r.rx_packet_fingerprint === 'string' &&
        /^[0-9A-Fa-f]{8}$/.test(r.rx_packet_fingerprint)
          ? r.rx_packet_fingerprint.toUpperCase()
          : undefined,
      replyPreviewText: typeof r.reply_preview_text === 'string' ? r.reply_preview_text : undefined,
      replyPreviewSender:
        typeof r.reply_preview_sender === 'string' ? r.reply_preview_sender : undefined,
      rxHops: coerceOptionalDbInt(r.rx_hops),
      roomServerId: coerceOptionalDbInt(r.room_server_id),
    });
  }
  return meshcoreChatMessagesForDisplay(meshcoreReconcileChannelSenderIds(mapped));
}

/** Persist sender_id/name repairs after {@link mapMeshcoreDbRowsToChatMessages} reconciliation. */
export async function persistMeshcoreMessageSenderRepairs(
  rows: MeshcoreMessageDbRow[],
  mapped: ChatMessage[],
): Promise<void> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const m of mapped) {
    if (m.id == null) continue;
    const row = byId.get(m.id);
    if (!row) continue;
    const prevId = row.sender_id ?? 0;
    const prevName = row.sender_name ?? 'Unknown';
    if (prevId === m.sender_id && prevName === m.sender_name) continue;
    if (m.sender_id === 0 || m.sender_id === MESHCORE_UNKNOWN_SENDER_STUB_ID) continue;
    try {
      await window.electronAPI.db.updateMeshcoreMessageSender(m.id, m.sender_id, m.sender_name);
    } catch (e: unknown) {
      console.warn(
        '[meshcoreHookPreamble] updateMeshcoreMessageSender failed ' +
          (e instanceof Error ? e.message : String(e)),
      );
    }
  }
}

/** Ensure minimal chat nodes exist for message senders (RF/MQTT stubs before device connect). */
export function mergeStubNodesFromMeshcoreMessages(
  prev: Map<number, MeshNode>,
  mapped: ChatMessage[],
): Map<number, MeshNode> {
  const next = new Map(prev);
  for (const msg of mapped) {
    if (msg.sender_id === 0) continue;
    if (msg.sender_name === 'Unknown' && msg.sender_id === MESHCORE_UNKNOWN_SENDER_STUB_ID)
      continue;
    if (next.has(msg.sender_id)) {
      const existing = next.get(msg.sender_id)!;
      const merged = meshcoreMergeChannelDisplayNameOntoNode(existing, msg.sender_name);
      if (merged !== existing) next.set(msg.sender_id, merged);
      continue;
    }
    next.set(
      msg.sender_id,
      minimalMeshcoreChatNode(
        msg.sender_id,
        msg.sender_name,
        Math.floor(msg.timestamp / 1000),
        msg.receivedVia === 'mqtt' ? 'mqtt' : 'rf',
      ),
    );
  }
  return next;
}
