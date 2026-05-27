import { useCallback } from 'react';

import type { ChatMessage, IdentityId, MeshNode } from '../lib/types';
import type { MessageRecord } from '../stores/messageStore';
import { upsertMessage } from '../stores/messageStore';
import type { NodeRecord } from '../stores/nodeStore';
import { upsertNode } from '../stores/nodeStore';

function meshNodeToNodeRecord(node: MeshNode): NodeRecord {
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

function chatMessageToMessageRecord(msg: ChatMessage): MessageRecord {
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

/**
 * Re-pulls Meshtastic nodes from SQLite into the identity-scoped node store.
 * Requires `identityId` from `useDevice().identityId` after connect.
 */
export function useRefreshNodesFromDb(identityId: IdentityId | null) {
  return useCallback(async (): Promise<void> => {
    if (!identityId) return;
    try {
      const rows = await window.electronAPI.db.getNodes();
      for (const row of rows) {
        upsertNode(identityId, meshNodeToNodeRecord(row));
      }
    } catch (e) {
      console.warn('[useRefreshNodesFromDb] failed', e);
    }
  }, [identityId]);
}

/**
 * Re-pulls Meshtastic messages from SQLite into the identity-scoped message store.
 */
export function useRefreshMessagesFromDb(identityId: IdentityId | null) {
  return useCallback(async (): Promise<void> => {
    if (!identityId) return;
    try {
      const rows = await window.electronAPI.db.getMessages(undefined, 10_000);
      for (const row of rows) {
        upsertMessage(identityId, chatMessageToMessageRecord(row));
      }
    } catch (e) {
      console.warn('[useRefreshMessagesFromDb] failed', e);
    }
  }, [identityId]);
}
