import {
  findMeshcoreCrossTransportDuplicate,
  MESHCORE_ROOM_MESSAGE_CHANNEL,
  meshcoreMessageDedupeKey,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { deleteMessage, upsertMessage, useMessageStore } from '../stores/messageStore';
import {
  chatMessageToMessageRecord,
  messageRecordsToChatMessages,
  messageRecordToChatMessage,
} from './storeRecordAdapters';
import type { ChatMessage, IdentityId } from './types';

export function meshcoreChannelMessageStoreId(channel: number, timestampSec: number): string {
  return `ch:${channel}:${timestampSec}`;
}

export function meshcoreRoomMessageStoreId(roomServerId: number, timestampSec: number): string {
  return `room:${roomServerId}:${timestampSec}`;
}

function meshcoreTimestampSec(timestamp: number): number {
  return timestamp >= 1_000_000_000_000 ? Math.floor(timestamp / 1000) : timestamp;
}

/** Canonical Zustand key for MeshCore chat rows (aligns RF PacketRouter ids with MQTT ingest). */
export function meshcoreMessageStoreId(msg: ChatMessage): string {
  if (msg.roomServerId != null) {
    return meshcoreRoomMessageStoreId(msg.roomServerId, meshcoreTimestampSec(msg.timestamp));
  }
  if (msg.channel != null && msg.channel >= 0) {
    return meshcoreChannelMessageStoreId(msg.channel, meshcoreTimestampSec(msg.timestamp));
  }
  if (msg.channel === MESHCORE_ROOM_MESSAGE_CHANNEL && msg.to != null) {
    return meshcoreRoomMessageStoreId(msg.to, meshcoreTimestampSec(msg.timestamp));
  }
  return `${msg.sender_id}-${msg.timestamp}-${msg.channel ?? -1}`;
}

export function listChatMessagesFromStore(identityId: IdentityId): ChatMessage[] {
  const byId = useMessageStore.getState().messages[identityId] ?? {};
  return messageRecordsToChatMessages(Object.values(byId));
}

function mergeMeshcoreReceivedVia(
  existing: ChatMessage['receivedVia'],
  incoming: ChatMessage['receivedVia'],
): ChatMessage['receivedVia'] {
  if (existing === 'both' || incoming === 'both') return 'both';
  if (!existing) return incoming;
  if (!incoming) return existing;
  if (existing !== incoming) return 'both';
  return existing;
}

function findStoreRecordIdForMessage(identityId: IdentityId, msg: ChatMessage): string | undefined {
  const byId = useMessageStore.getState().messages[identityId] ?? {};
  const key = meshcoreMessageDedupeKey(msg);
  for (const [id, record] of Object.entries(byId)) {
    if (meshcoreMessageDedupeKey(messageRecordToChatMessage(record)) === key) {
      return id;
    }
  }
  return undefined;
}

export interface MeshcoreStoreUpsertResult {
  inserted: boolean;
  message: ChatMessage;
  canonicalId: string;
}

/**
 * Upsert a MeshCore chat row into Zustand with exact-key and cross-transport dedup
 * against the store (not hook-local state).
 */
export function upsertMeshcoreMessageWithDedup(
  identityId: IdentityId,
  msg: ChatMessage,
  preferredId?: string,
): MeshcoreStoreUpsertResult {
  const storeMessages = listChatMessagesFromStore(identityId);
  const incomingKey = meshcoreMessageDedupeKey(msg);

  const exactMatch = storeMessages.find((m) => meshcoreMessageDedupeKey(m) === incomingKey);
  if (exactMatch) {
    const canonicalId =
      findStoreRecordIdForMessage(identityId, exactMatch) ??
      preferredId ??
      meshcoreMessageStoreId(exactMatch);
    const mergedReceivedVia = mergeMeshcoreReceivedVia(exactMatch.receivedVia, msg.receivedVia);
    if (mergedReceivedVia !== exactMatch.receivedVia) {
      const merged: ChatMessage = { ...exactMatch, receivedVia: mergedReceivedVia };
      const record = chatMessageToMessageRecord(merged);
      record.id = canonicalId;
      upsertMessage(identityId, record);
      return { inserted: false, message: merged, canonicalId };
    }
    return {
      inserted: false,
      message: exactMatch,
      canonicalId,
    };
  }

  const crossDup = findMeshcoreCrossTransportDuplicate(storeMessages, msg);
  if (crossDup) {
    const merged: ChatMessage = {
      ...crossDup,
      receivedVia: mergeMeshcoreReceivedVia(crossDup.receivedVia, msg.receivedVia),
      rxHops: crossDup.rxHops ?? msg.rxHops,
    };
    const canonicalId =
      preferredId ??
      findStoreRecordIdForMessage(identityId, crossDup) ??
      meshcoreMessageStoreId(merged);
    const record = chatMessageToMessageRecord(merged);
    record.id = canonicalId;
    upsertMessage(identityId, record);
    const altId = meshcoreMessageStoreId(msg);
    if (altId !== canonicalId) {
      deleteMessage(identityId, altId);
    }
    return { inserted: false, message: merged, canonicalId };
  }

  const canonicalId = preferredId ?? meshcoreMessageStoreId(msg);
  const record = chatMessageToMessageRecord(msg);
  record.id = canonicalId;
  upsertMessage(identityId, record);
  return { inserted: true, message: msg, canonicalId };
}
