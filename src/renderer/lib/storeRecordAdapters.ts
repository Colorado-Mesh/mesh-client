import {
  formatMeshtasticNodeId,
  isMeshtasticBroadcastNodeNum,
  MESHTASTIC_BROADCAST_NODE_NUM,
} from '@/shared/nodeNameUtils';
import { MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG } from '@/shared/reactionEmoji';

import type { MessageRecord } from '../stores/messageStore';
import type { NodeRecord } from '../stores/nodeStore';
import type { NeighborInfoEvent, TraceRouteEvent, WaypointEvent } from './protocols/Protocol';
import {
  firstGraphemeCluster,
  isReactionPickerEmojiGlyph,
  normalizeReactionEmoji,
} from './reactions';
import { registerReticulumDestinationHash, reticulumHashToNodeId } from './reticulum/destHash';
import { computeReticulumMessageHash } from './reticulum/messageHash';
import type {
  ChatMessage,
  MeshNeighbor,
  MeshNode,
  MeshWaypoint,
  NeighborInfoRecord,
} from './types';

export interface ChatReactionRow {
  emoji: number;
  payload: string;
  sender_id: number;
  sender_name: string;
  id?: number;
}

/** Detect Reticulum LXMF tapback rows rehydrated from SQLite (emoji-only payload + parent hash). */
export function isReticulumTapbackDbRow(row: {
  reply_to_hash?: string | null;
  payload: string;
}): boolean {
  if (!row.reply_to_hash) return false;
  const trimmed = row.payload.trim();
  if (!trimmed) return false;
  const glyph = firstGraphemeCluster(trimmed);
  if (!glyph || glyph !== trimmed) return false;
  return isReactionPickerEmojiGlyph(glyph);
}

/** Parent key for grouping tapbacks (Meshtastic packet id or Reticulum message hash). */
export function reactionParentKeyFromChatMessage(msg: ChatMessage): string | number | undefined {
  if (msg.emoji == null) return undefined;
  if (msg.reticulum_reply_to_hash) return msg.reticulum_reply_to_hash;
  if (msg.replyId != null) return msg.replyId;
  return undefined;
}

/** Lookup keys on a parent chat message for attached tapback rows. */
export function reactionLookupKeysForParentMessage(msg: ChatMessage): (string | number)[] {
  const keys = new Set<string | number>();
  if (msg.packetId != null) keys.add(msg.packetId);
  keys.add(msg.timestamp);
  if (msg.reticulum_message_hash) keys.add(msg.reticulum_message_hash);
  return [...keys];
}

export function groupChatReactionsByParentKey(messages: ChatMessage[]): {
  regularMessages: ChatMessage[];
  reactionsByParentKey: Map<string | number, ChatReactionRow[]>;
} {
  const regular: ChatMessage[] = [];
  const reactions = new Map<string | number, ChatReactionRow[]>();

  const reactionDedupeKey = (senderId: number, emoji: number, payload: string): string =>
    `${senderId}|${emoji}|${payload.trim()}`;

  for (const msg of messages) {
    const parentKey = reactionParentKeyFromChatMessage(msg);
    if (parentKey != null) {
      const existing = reactions.get(parentKey) ?? [];
      const dedupeKey = reactionDedupeKey(msg.sender_id, msg.emoji!, msg.payload);
      if (!existing.some((r) => reactionDedupeKey(r.sender_id, r.emoji, r.payload) === dedupeKey)) {
        existing.push({
          emoji: msg.emoji!,
          payload: msg.payload,
          sender_id: msg.sender_id,
          sender_name: msg.sender_name,
          id: msg.id,
        });
        reactions.set(parentKey, existing);
      }
      continue;
    }
    regular.push(msg);
  }

  return { regularMessages: regular, reactionsByParentKey: reactions };
}

export function messageRecordToChatMessage(record: MessageRecord): ChatMessage {
  const packetId = /^\d+$/.test(record.id) ? Number(record.id) : undefined;
  const to = record.to != null && !isMeshtasticBroadcastNodeNum(record.to) ? record.to : undefined;
  const reactionScalar = record.tapback
    ? normalizeReactionEmoji(MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG, record.payload)
    : undefined;
  const reticulumReplyHash = record.reticulumReplyToHash;
  const rxHops = record.rxHops ?? record.hopCount;
  return {
    ...(packetId != null ? { id: packetId } : {}),
    sender_id: record.from,
    sender_name:
      record.senderName?.trim() || (record.from > 0 ? formatMeshtasticNodeId(record.from) : ''),
    payload: record.payload,
    channel: record.channelIndex,
    timestamp: record.timestamp,
    packetId,
    status: record.status,
    mqttStatus: record.mqttStatus,
    receivedVia: record.receivedVia,
    isHistory: record.isHistory,
    error: record.error,
    to,
    ...(record.reticulumSenderHash ? { reticulum_sender_hash: record.reticulumSenderHash } : {}),
    ...(record.reticulumMessageHash ? { reticulum_message_hash: record.reticulumMessageHash } : {}),
    ...(reticulumReplyHash ? { reticulum_reply_to_hash: reticulumReplyHash } : {}),
    ...(reactionScalar != null ? { emoji: reactionScalar } : {}),
    replyId:
      reticulumReplyHash == null && record.replyTo != null ? Number(record.replyTo) : undefined,
    replyPreviewText: record.replyPreviewText,
    replyPreviewSender: record.replyPreviewSender,
    ...(rxHops != null ? { rxHops } : {}),
    ...(record.viaStoreForward ? { viaStoreForward: true } : {}),
    ...(record.roomServerId != null ? { roomServerId: record.roomServerId } : {}),
    ...(record.reticulumDeliveryMethod
      ? { reticulumDeliveryMethod: record.reticulumDeliveryMethod }
      : {}),
  };
}

export function messageRecordsToChatMessages(records: MessageRecord[]): ChatMessage[] {
  return records.map(messageRecordToChatMessage);
}

export function nodeRecordToMeshNode(record: NodeRecord): MeshNode {
  return {
    node_id: record.nodeId,
    long_name: record.longName ?? '',
    short_name: record.shortName ?? '',
    hw_model: record.hwModel ?? '',
    snr: record.snr ?? 0,
    rssi: record.rssi ?? 0,
    battery: record.batteryLevel ?? 0,
    last_heard: record.lastHeardAt ?? 0,
    latitude: record.latitude ?? null,
    longitude: record.longitude ?? null,
    altitude: record.altitude,
    role: record.role,
    hops_away: record.hopsAway,
    via_mqtt: record.viaMqtt,
    hops: record.hops,
    path: record.path,
    heard_via_mqtt_only: record.heardViaMqttOnly,
    heard_via_mqtt: record.heardViaMqtt,
    source: record.source,
    on_radio: record.onRadio,
    favorited: record.favorited,
    voltage: record.voltage,
    channel_utilization: record.channelUtilization,
    air_util_tx: record.airUtilTx,
    env_temperature: record.temperature,
    env_humidity: record.relativeHumidity,
    env_pressure: record.barometricPressure,
    env_iaq: record.iaq,
    env_gas_resistance: record.gasResistance,
    env_lux: record.lux,
    env_wind_speed: record.windSpeed,
    env_wind_direction: record.windDirection,
    lastPositionWarning: record.lastPositionWarning,
    num_packets_rx_bad: record.numPacketsRxBad,
    num_rx_dupe: record.numRxDupe,
    num_packets_rx: record.numPacketsRx,
    num_packets_tx: record.numPacketsTx,
    meshcore_local_stats: record.meshcoreLocalStats,
    ...(record.publicKeyHex ? { public_key_hex: record.publicKeyHex } : {}),
    ...(record.reticulumDestinationHash
      ? { reticulum_destination_hash: record.reticulumDestinationHash }
      : {}),
  };
}

/** Module cache for structural sharing across consecutive exports (App.tsx node map). */
let prevNodeMapExport: Map<number, MeshNode> | null = null;
let prevNodeRecordSnapshot: Map<number, NodeRecord> | null = null;

function nodeRecordsShallowEqual(a: NodeRecord, b: NodeRecord): boolean {
  return (
    a.nodeId === b.nodeId &&
    a.longName === b.longName &&
    a.shortName === b.shortName &&
    a.hwModel === b.hwModel &&
    a.snr === b.snr &&
    a.rssi === b.rssi &&
    a.batteryLevel === b.batteryLevel &&
    a.lastHeardAt === b.lastHeardAt &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    a.altitude === b.altitude &&
    a.role === b.role &&
    a.hopsAway === b.hopsAway &&
    a.viaMqtt === b.viaMqtt &&
    a.hops === b.hops &&
    a.path === b.path &&
    a.heardViaMqttOnly === b.heardViaMqttOnly &&
    a.heardViaMqtt === b.heardViaMqtt &&
    a.source === b.source &&
    a.onRadio === b.onRadio &&
    a.favorited === b.favorited &&
    a.voltage === b.voltage &&
    a.channelUtilization === b.channelUtilization &&
    a.airUtilTx === b.airUtilTx &&
    a.temperature === b.temperature &&
    a.relativeHumidity === b.relativeHumidity &&
    a.barometricPressure === b.barometricPressure &&
    a.iaq === b.iaq &&
    a.gasResistance === b.gasResistance &&
    a.lux === b.lux &&
    a.windSpeed === b.windSpeed &&
    a.windDirection === b.windDirection &&
    a.lastPositionWarning === b.lastPositionWarning &&
    a.numPacketsRxBad === b.numPacketsRxBad &&
    a.numRxDupe === b.numRxDupe &&
    a.numPacketsRx === b.numPacketsRx &&
    a.numPacketsTx === b.numPacketsTx &&
    a.meshcoreLocalStats === b.meshcoreLocalStats &&
    a.publicKeyHex === b.publicKeyHex &&
    a.reticulumDestinationHash === b.reticulumDestinationHash
  );
}

/** Reset export cache (tests only). */
export function resetNodeRecordsToMeshNodeMapCacheForTests(): void {
  prevNodeMapExport = null;
  prevNodeRecordSnapshot = null;
}

export function nodeRecordsToMeshNodeMap(records: NodeRecord[]): Map<number, MeshNode> {
  const prevMap = prevNodeMapExport;
  const prevSnapshot = prevNodeRecordSnapshot;
  if (prevMap && prevSnapshot && prevMap.size === records.length) {
    let reuseEntireMap = true;
    const next = new Map<number, MeshNode>();
    for (const record of records) {
      const prevRecord = prevSnapshot.get(record.nodeId);
      const prevNode = prevMap.get(record.nodeId);
      if (prevRecord && prevNode && nodeRecordsShallowEqual(prevRecord, record)) {
        next.set(record.nodeId, prevNode);
      } else {
        reuseEntireMap = false;
        next.set(record.nodeId, nodeRecordToMeshNode(record));
      }
    }
    if (reuseEntireMap) {
      return prevMap;
    }
    prevNodeMapExport = next;
    prevNodeRecordSnapshot = new Map(records.map((r) => [r.nodeId, r]));
    return next;
  }
  const map = new Map<number, MeshNode>();
  for (const record of records) {
    map.set(record.nodeId, nodeRecordToMeshNode(record));
  }
  prevNodeMapExport = map;
  prevNodeRecordSnapshot = new Map(records.map((r) => [r.nodeId, r]));
  return map;
}

export function meshNodeToNodeRecord(node: MeshNode): NodeRecord {
  const role =
    typeof node.role === 'number'
      ? node.role
      : typeof node.role === 'string'
        ? Number(node.role)
        : undefined;
  return {
    nodeId: node.node_id,
    longName: node.long_name || undefined,
    shortName: node.short_name || undefined,
    hwModel: node.hw_model || undefined,
    snr: node.snr,
    rssi: node.rssi,
    batteryLevel: node.battery,
    lastHeardAt: node.last_heard,
    latitude: node.latitude ?? undefined,
    longitude: node.longitude ?? undefined,
    altitude: node.altitude,
    role: role != null && Number.isFinite(role) ? role : undefined,
    hopsAway: node.hops_away,
    viaMqtt: node.via_mqtt,
    hops: node.hops,
    path: node.path,
    heardViaMqttOnly: node.heard_via_mqtt_only,
    heardViaMqtt: node.heard_via_mqtt,
    source: node.source,
    onRadio: node.on_radio,
    favorited: node.favorited,
    voltage: node.voltage,
    channelUtilization: node.channel_utilization,
    airUtilTx: node.air_util_tx,
    temperature: node.env_temperature,
    relativeHumidity: node.env_humidity,
    barometricPressure: node.env_pressure,
    iaq: node.env_iaq,
    gasResistance: node.env_gas_resistance,
    lux: node.env_lux,
    windSpeed: node.env_wind_speed,
    windDirection: node.env_wind_direction,
    lastPositionWarning: node.lastPositionWarning,
    numPacketsRxBad: node.num_packets_rx_bad,
    numRxDupe: node.num_rx_dupe,
    numPacketsRx: node.num_packets_rx,
    numPacketsTx: node.num_packets_tx,
    meshcoreLocalStats: node.meshcore_local_stats,
    publicKeyHex: node.public_key_hex,
    reticulumDestinationHash: node.reticulum_destination_hash,
  };
}

export function waypointEventsToMeshWaypointMap(
  byId: Record<number, WaypointEvent>,
): Map<number, MeshWaypoint> {
  const map = new Map<number, MeshWaypoint>();
  for (const event of Object.values(byId)) {
    map.set(event.id, {
      id: event.id,
      latitude: event.latitude,
      longitude: event.longitude,
      name: event.name,
      description: event.description,
      lockedTo: event.lockedTo,
      expire: event.expire,
      from: event.from,
      timestamp: event.timestamp,
    });
  }
  return map;
}

export function neighborInfoEventsToRecordMap(
  byNode: Record<number, NeighborInfoEvent>,
): Map<number, NeighborInfoRecord> {
  const map = new Map<number, NeighborInfoRecord>();
  for (const event of Object.values(byNode)) {
    map.set(event.nodeId, {
      nodeId: event.nodeId,
      neighbors: event.neighbors.map((n): MeshNeighbor => ({
        nodeId: n.nodeId,
        snr: n.snr,
        lastRxTime: n.lastRxTime,
      })),
      timestamp: event.timestamp,
    });
  }
  return map;
}

export function traceRouteEventsToResultsMap(
  events: TraceRouteEvent[],
): Map<number, { route: number[]; from: number; timestamp: number }> {
  const map = new Map<number, { route: number[]; from: number; timestamp: number }>();
  for (const event of events) {
    map.set(event.from, { from: event.from, route: event.route, timestamp: event.timestamp });
  }
  return map;
}

export function chatMessageToMessageRecord(msg: ChatMessage): MessageRecord {
  const id =
    msg.reticulum_message_hash ??
    (msg.packetId != null
      ? String(msg.packetId)
      : `${msg.sender_id}-${msg.timestamp}-${msg.channel}`);
  const to =
    msg.to != null && !isMeshtasticBroadcastNodeNum(msg.to)
      ? msg.to
      : MESHTASTIC_BROADCAST_NODE_NUM;
  return {
    id,
    from: msg.sender_id,
    senderName: msg.sender_name,
    to,
    payload: msg.payload,
    channelIndex: msg.channel,
    timestamp: msg.timestamp,
    status: msg.status === 'queued' || msg.status === 'blocked' ? undefined : msg.status,
    mqttStatus: msg.mqttStatus,
    receivedVia: msg.receivedVia,
    isHistory: msg.isHistory,
    error: msg.error,
    tapback: msg.emoji != null ? true : undefined,
    replyTo: msg.reticulum_reply_to_hash ?? (msg.replyId != null ? String(msg.replyId) : undefined),
    replyPreviewText: msg.replyPreviewText,
    replyPreviewSender: msg.replyPreviewSender,
    ...(msg.rxHops != null ? { rxHops: msg.rxHops } : {}),
    ...(msg.viaStoreForward ? { viaStoreForward: true } : {}),
    ...(msg.reticulum_message_hash ? { reticulumMessageHash: msg.reticulum_message_hash } : {}),
    ...(msg.reticulum_sender_hash ? { reticulumSenderHash: msg.reticulum_sender_hash } : {}),
    ...(msg.reticulum_reply_to_hash ? { reticulumReplyToHash: msg.reticulum_reply_to_hash } : {}),
    ...(msg.roomServerId != null ? { roomServerId: msg.roomServerId } : {}),
  };
}

export function reticulumDbRowToMessageRecord(row: {
  sender_id: string;
  sender_name?: string | null;
  payload: string;
  timestamp: number;
  to_hash?: string | null;
  reply_to_hash?: string | null;
  message_hash?: string | null;
  received_via?: string | null;
  delivery_status?: string | null;
  delivery_method?: string | null;
  attachment_path?: string | null;
}): MessageRecord {
  const from = reticulumHashToNodeId(row.sender_id);
  registerReticulumDestinationHash(from, row.sender_id);
  const messageHash =
    row.message_hash ?? computeReticulumMessageHash(row.sender_id, row.timestamp, row.payload);
  const isTapback = isReticulumTapbackDbRow(row);
  const receivedVia =
    row.received_via === 'rf' ||
    row.received_via === 'tcp' ||
    row.received_via === 'network' ||
    row.received_via === 'mqtt' ||
    row.received_via === 'both'
      ? row.received_via
      : undefined;
  const deliveryMethod =
    row.delivery_method === 'direct' ||
    row.delivery_method === 'propagated' ||
    row.delivery_method === 'opportunistic'
      ? row.delivery_method
      : undefined;
  const status: MessageRecord['status'] =
    row.delivery_status === 'failed'
      ? 'failed'
      : row.delivery_status === 'sending' ||
          row.delivery_status === 'pending' ||
          row.delivery_status === 'queued'
        ? 'sending'
        : 'acked';
  return {
    id: messageHash,
    from,
    senderName: row.sender_name ?? row.sender_id.slice(0, 12),
    to: row.to_hash ? reticulumHashToNodeId(row.to_hash) : 0,
    payload: row.payload,
    channelIndex: 0,
    timestamp: row.timestamp,
    status,
    reticulumMessageHash: messageHash,
    reticulumSenderHash: row.sender_id,
    ...(isTapback
      ? { tapback: true, reticulumReplyToHash: row.reply_to_hash! }
      : row.reply_to_hash
        ? { reticulumReplyToHash: row.reply_to_hash }
        : {}),
    ...(receivedVia ? { receivedVia } : {}),
    ...(deliveryMethod ? { reticulumDeliveryMethod: deliveryMethod } : {}),
    ...(row.attachment_path ? { reticulumAttachmentPath: row.attachment_path } : {}),
  };
}
