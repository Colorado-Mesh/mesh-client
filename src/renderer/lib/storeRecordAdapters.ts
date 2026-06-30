import {
  formatMeshtasticNodeId,
  isMeshtasticBroadcastNodeNum,
  MESHTASTIC_BROADCAST_NODE_NUM,
} from '@/shared/nodeNameUtils';
import { MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG } from '@/shared/reactionEmoji';

import type { MessageRecord } from '../stores/messageStore';
import type { NodeRecord } from '../stores/nodeStore';
import type { NeighborInfoEvent, TraceRouteEvent, WaypointEvent } from './protocols/Protocol';
import { normalizeReactionEmoji } from './reactions';
import { registerReticulumDestinationHash, reticulumHashToNodeId } from './reticulum/destHash';
import { computeReticulumMessageHash } from './reticulum/messageHash';
import type {
  ChatMessage,
  MeshNeighbor,
  MeshNode,
  MeshWaypoint,
  NeighborInfoRecord,
} from './types';

export function messageRecordToChatMessage(record: MessageRecord): ChatMessage {
  const packetId = /^\d+$/.test(record.id) ? Number(record.id) : undefined;
  const to = record.to != null && !isMeshtasticBroadcastNodeNum(record.to) ? record.to : undefined;
  const reactionScalar = record.tapback
    ? normalizeReactionEmoji(MESHTASTIC_TAPBACK_DATA_EMOJI_FLAG, record.payload)
    : undefined;
  const reticulumReplyHash = record.reticulumReplyToHash;
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
    ...(record.roomServerId != null ? { roomServerId: record.roomServerId } : {}),
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
    meshcore_local_stats: record.meshcoreLocalStats,
  };
}

export function nodeRecordsToMeshNodeMap(records: NodeRecord[]): Map<number, MeshNode> {
  const map = new Map<number, MeshNode>();
  for (const record of records) {
    map.set(record.nodeId, nodeRecordToMeshNode(record));
  }
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
    meshcoreLocalStats: node.meshcore_local_stats,
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
}): MessageRecord {
  const from = reticulumHashToNodeId(row.sender_id);
  registerReticulumDestinationHash(from, row.sender_id);
  const messageHash =
    row.message_hash ?? computeReticulumMessageHash(row.sender_id, row.timestamp, row.payload);
  return {
    id: messageHash,
    from,
    senderName: row.sender_name ?? row.sender_id.slice(0, 12),
    to: row.to_hash ? reticulumHashToNodeId(row.to_hash) : 0,
    payload: row.payload,
    channelIndex: 0,
    timestamp: row.timestamp,
    status: 'acked',
    reticulumMessageHash: messageHash,
    reticulumSenderHash: row.sender_id,
    ...(row.reply_to_hash ? { reticulumReplyToHash: row.reply_to_hash } : {}),
  };
}
