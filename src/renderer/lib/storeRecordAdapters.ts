import type { MessageRecord } from '../stores/messageStore';
import type { NodeRecord } from '../stores/nodeStore';
import type { ChatMessage, MeshNode } from './types';

export function messageRecordToChatMessage(record: MessageRecord): ChatMessage {
  const packetId = /^\d+$/.test(record.id) ? Number(record.id) : undefined;
  return {
    ...(packetId != null ? { id: packetId } : {}),
    sender_id: record.from,
    sender_name: record.senderName ?? '',
    payload: record.payload,
    channel: record.channelIndex,
    timestamp: record.timestamp,
    packetId,
    status: record.status,
    mqttStatus: record.mqttStatus,
    receivedVia: record.receivedVia,
    isHistory: record.isHistory,
    error: record.error,
    to: record.to,
    replyId: record.replyTo != null ? Number(record.replyTo) : undefined,
    replyPreviewText: record.replyPreviewText,
    replyPreviewSender: record.replyPreviewSender,
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
    meshcoreLocalStats: node.meshcore_local_stats,
  };
}

export function chatMessageToMessageRecord(msg: ChatMessage): MessageRecord {
  const id =
    msg.packetId != null
      ? String(msg.packetId)
      : `${msg.sender_id}-${msg.timestamp}-${msg.channel}`;
  return {
    id,
    from: msg.sender_id,
    senderName: msg.sender_name,
    to: msg.to ?? 0xffffffff,
    payload: msg.payload,
    channelIndex: msg.channel,
    timestamp: msg.timestamp,
    status: msg.status === 'queued' || msg.status === 'blocked' ? undefined : msg.status,
    mqttStatus: msg.mqttStatus,
    receivedVia: msg.receivedVia,
    isHistory: msg.isHistory,
    error: msg.error,
    replyTo: msg.replyId != null ? String(msg.replyId) : undefined,
    replyPreviewText: msg.replyPreviewText,
    replyPreviewSender: msg.replyPreviewSender,
  };
}
