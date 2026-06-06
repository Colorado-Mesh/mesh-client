import {
  findMeshcoreChannelRfDuplicate,
  findMeshcoreCrossTransportDuplicate,
  findMeshcoreRoomPostDuplicate,
  findMeshcoreTapbackEchoDuplicate,
  MESHCORE_ROOM_MESSAGE_CHANNEL,
  meshcoreMessageDedupeKey,
  messageToDbRow,
} from '../hooks/meshcore/meshcoreHookPreamble';
import type { MessageRecord } from '../stores/messageStore';
import { deleteMessage, upsertMessage, useMessageStore } from '../stores/messageStore';
import { errLikeToLogString } from './errLikeToLogString';
import type {
  BuildMeshcoreChannelIncomingOpts,
  BuildMeshcoreDmIncomingOpts,
} from './meshcoreChannelText';
import {
  parseMeshcoreChannelIncomingFromThread,
  parseMeshcoreDmIncomingFromThread,
} from './meshcoreChannelText';
import {
  indexMeshcoreMessageForDedupe,
  lookupMeshcoreMessageIdByDedupeKey,
  removeMeshcoreDedupeIndexForMessage,
} from './meshcoreMessageDedupeIndex';
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

/** MeshCore wire timestamps are Unix seconds; mesh-client UI/DB rows use ms when above 1e12. */
function meshcoreTimestampSec(timestamp: number): number {
  return timestamp >= 1_000_000_000_000 ? Math.floor(timestamp / 1000) : timestamp;
}

/** Canonical Zustand key for MeshCore chat rows (aligns RF PacketRouter ids with hook-local state). */
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

/** Sorted thread context from Zustand (canonical for reply-parent resolution at ingest). */
export function meshcoreSortedStorePrior(identityId: IdentityId): ChatMessage[] {
  return listChatMessagesFromStore(identityId).sort((a, b) => a.timestamp - b.timestamp);
}

/** Live channel ingest against the identity store thread (parse once, then persist via dedup upsert). */
export function ingestMeshcoreChannelMessage(
  identityId: IdentityId,
  opts: BuildMeshcoreChannelIncomingOpts,
): ChatMessage {
  return parseMeshcoreChannelIncomingFromThread(meshcoreSortedStorePrior(identityId), opts);
}

/** Live DM ingest against the identity store thread. */
export function ingestMeshcoreDmMessage(
  identityId: IdentityId,
  opts: BuildMeshcoreDmIncomingOpts,
): ChatMessage {
  return parseMeshcoreDmIncomingFromThread(meshcoreSortedStorePrior(identityId), opts);
}

/** Prefer freshly parsed/repaired reply metadata over stale store rows (RF/MQTT dedup). */
export function meshcorePreferIncomingReplyFields(
  existing: ChatMessage,
  incoming: ChatMessage,
): Pick<ChatMessage, 'replyId' | 'replyPreviewText' | 'replyPreviewSender'> | null {
  if (incoming.replyId == null) return null;
  const sameReply =
    existing.replyId === incoming.replyId &&
    existing.replyPreviewText === incoming.replyPreviewText &&
    existing.replyPreviewSender === incoming.replyPreviewSender;
  if (sameReply) return null;
  if (
    existing.replyId == null ||
    incoming.replyId !== existing.replyId ||
    (incoming.replyPreviewText != null && incoming.replyPreviewText !== existing.replyPreviewText)
  ) {
    return {
      replyId: incoming.replyId,
      replyPreviewText: incoming.replyPreviewText,
      replyPreviewSender: incoming.replyPreviewSender,
    };
  }
  return null;
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
  const key = meshcoreMessageDedupeKey(msg);
  const indexed = lookupMeshcoreMessageIdByDedupeKey(identityId, key);
  const byId = useMessageStore.getState().messages[identityId] ?? {};
  if (indexed && byId[indexed]) {
    return indexed;
  }
  for (const [id, record] of Object.entries(byId)) {
    if (meshcoreMessageDedupeKey(messageRecordToChatMessage(record)) === key) {
      indexMeshcoreMessageForDedupe(identityId, msg, id);
      return id;
    }
  }
  return undefined;
}

function resolveExactKeyDuplicate(
  identityId: IdentityId,
  incomingKey: string,
  storeMessages: ChatMessage[],
): ChatMessage | undefined {
  const indexedId = lookupMeshcoreMessageIdByDedupeKey(identityId, incomingKey);
  if (indexedId) {
    const record = useMessageStore.getState().messages[identityId]?.[indexedId];
    if (record) {
      const chat = messageRecordToChatMessage(record);
      if (meshcoreMessageDedupeKey(chat) === incomingKey) {
        return chat;
      }
    }
  }
  return storeMessages.find((m) => meshcoreMessageDedupeKey(m) === incomingKey);
}

function persistMeshcoreDedupeIndex(
  identityId: IdentityId,
  message: ChatMessage,
  messageId: string,
): void {
  indexMeshcoreMessageForDedupe(identityId, message, messageId);
}

function meshcoreIsRoomPostMessage(msg: ChatMessage): boolean {
  return msg.roomServerId != null || msg.channel === MESHCORE_ROOM_MESSAGE_CHANNEL;
}

/** Merge outbound lifecycle fields when the dedupe key matches exactly (optimistic send → ack/fail). */
function mergeExactKeyDuplicate(existing: ChatMessage, incoming: ChatMessage): ChatMessage | null {
  const mergedReceivedVia = mergeMeshcoreReceivedVia(existing.receivedVia, incoming.receivedVia);
  const statusAdvances =
    existing.status === 'sending' && (incoming.status === 'acked' || incoming.status === 'failed');
  const richerPacketId = incoming.packetId != null && existing.packetId == null;
  const richerError = incoming.error != null && existing.error == null;

  if (
    !statusAdvances &&
    mergedReceivedVia === existing.receivedVia &&
    !richerPacketId &&
    !richerError
  ) {
    return null;
  }

  if (statusAdvances && meshcoreIsRoomPostMessage(existing)) {
    return mergeRoomPostDuplicate(existing, incoming);
  }

  const replyFields = meshcorePreferIncomingReplyFields(existing, incoming);
  return {
    ...existing,
    ...incoming,
    ...(replyFields ?? {}),
    receivedVia: mergedReceivedVia,
    status: statusAdvances ? incoming.status : (existing.status ?? incoming.status),
    packetId: incoming.packetId ?? existing.packetId,
    error: incoming.error ?? existing.error,
  };
}

function mergeRoomPostDuplicate(existing: ChatMessage, incoming: ChatMessage): ChatMessage {
  const timestamp =
    incoming.receivedVia === 'rf' && incoming.timestamp !== existing.timestamp
      ? incoming.timestamp
      : existing.timestamp;
  const status =
    existing.status === 'sending'
      ? (incoming.status ?? 'acked')
      : (existing.status ?? incoming.status ?? 'acked');
  return {
    ...existing,
    ...incoming,
    timestamp,
    status,
    payload: incoming.meshcoreDedupeKey ?? incoming.payload ?? existing.payload,
    meshcoreDedupeKey: incoming.meshcoreDedupeKey ?? existing.meshcoreDedupeKey,
    sender_name: incoming.sender_name || existing.sender_name,
    receivedVia: mergeMeshcoreReceivedVia(existing.receivedVia, incoming.receivedVia),
    rxHops: existing.rxHops ?? incoming.rxHops,
    packetId: incoming.packetId ?? existing.packetId,
  };
}

function applyRoomPostDuplicateMerge(
  identityId: IdentityId,
  roomDup: ChatMessage,
  msg: ChatMessage,
  preferredId?: string,
): MeshcoreStoreUpsertResult {
  const merged = mergeRoomPostDuplicate(roomDup, msg);
  const existingRecordId = findStoreRecordIdForMessage(identityId, roomDup);
  const canonicalId = preferredId ?? existingRecordId ?? meshcoreMessageStoreId(merged);
  const record = chatMessageToMessageRecord(merged);
  record.id = canonicalId;
  upsertMessage(identityId, record);
  persistMeshcoreDedupeIndex(identityId, merged, canonicalId);
  const altIds = new Set<string>();
  if (existingRecordId && existingRecordId !== canonicalId) {
    altIds.add(existingRecordId);
  }
  const incomingId = meshcoreMessageStoreId(msg);
  if (incomingId !== canonicalId) {
    altIds.add(incomingId);
  }
  for (const altId of altIds) {
    deleteMessage(identityId, altId);
    if (altId === incomingId) {
      removeMeshcoreDedupeIndexForMessage(identityId, msg);
    } else if (altId === existingRecordId) {
      removeMeshcoreDedupeIndexForMessage(identityId, roomDup);
    }
  }
  return { inserted: false, storeUpdated: true, message: merged, canonicalId };
}

export interface MeshcoreStoreUpsertResult {
  inserted: boolean;
  /** True when an existing store row was rewritten (e.g. reply-parent repair on dedup merge). */
  storeUpdated: boolean;
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

  const exactMatch = resolveExactKeyDuplicate(identityId, incomingKey, storeMessages);
  if (exactMatch) {
    const canonicalId =
      findStoreRecordIdForMessage(identityId, exactMatch) ??
      preferredId ??
      meshcoreMessageStoreId(exactMatch);
    const merged = mergeExactKeyDuplicate(exactMatch, msg);
    if (merged) {
      const record = chatMessageToMessageRecord(merged);
      record.id = canonicalId;
      upsertMessage(identityId, record);
      persistMeshcoreDedupeIndex(identityId, merged, canonicalId);
      return { inserted: false, storeUpdated: true, message: merged, canonicalId };
    }
    const replyFields = meshcorePreferIncomingReplyFields(exactMatch, msg);
    if (replyFields) {
      const upgraded: ChatMessage = {
        ...exactMatch,
        ...replyFields,
        receivedVia: mergeMeshcoreReceivedVia(exactMatch.receivedVia, msg.receivedVia),
      };
      const record = chatMessageToMessageRecord(upgraded);
      record.id = canonicalId;
      upsertMessage(identityId, record);
      persistMeshcoreDedupeIndex(identityId, upgraded, canonicalId);
      return { inserted: false, storeUpdated: true, message: upgraded, canonicalId };
    }
    return {
      inserted: false,
      storeUpdated: false,
      message: exactMatch,
      canonicalId,
    };
  }

  const tapbackDup = findMeshcoreTapbackEchoDuplicate(storeMessages, msg);
  if (tapbackDup) {
    const merged: ChatMessage = {
      ...tapbackDup,
      receivedVia: mergeMeshcoreReceivedVia(tapbackDup.receivedVia, msg.receivedVia),
      rxHops: tapbackDup.rxHops ?? msg.rxHops,
      meshcoreDedupeKey: msg.meshcoreDedupeKey ?? tapbackDup.meshcoreDedupeKey,
    };
    const canonicalId =
      preferredId ??
      findStoreRecordIdForMessage(identityId, tapbackDup) ??
      meshcoreMessageStoreId(merged);
    const record = chatMessageToMessageRecord(merged);
    record.id = canonicalId;
    upsertMessage(identityId, record);
    persistMeshcoreDedupeIndex(identityId, merged, canonicalId);
    const altId = meshcoreMessageStoreId(msg);
    if (altId !== canonicalId) {
      deleteMessage(identityId, altId);
      removeMeshcoreDedupeIndexForMessage(identityId, msg);
    }
    return { inserted: false, storeUpdated: true, message: merged, canonicalId };
  }

  const crossDup = findMeshcoreCrossTransportDuplicate(storeMessages, msg);
  if (crossDup) {
    const merged: ChatMessage = {
      ...crossDup,
      ...(meshcorePreferIncomingReplyFields(crossDup, msg) ?? {}),
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
    persistMeshcoreDedupeIndex(identityId, merged, canonicalId);
    const altId = meshcoreMessageStoreId(msg);
    if (altId !== canonicalId) {
      deleteMessage(identityId, altId);
      removeMeshcoreDedupeIndexForMessage(identityId, msg);
    }
    return { inserted: false, storeUpdated: true, message: merged, canonicalId };
  }

  const channelRfDup = findMeshcoreChannelRfDuplicate(storeMessages, msg);
  if (channelRfDup) {
    const merged: ChatMessage = {
      ...channelRfDup,
      ...(meshcorePreferIncomingReplyFields(channelRfDup, msg) ?? {}),
      receivedVia: mergeMeshcoreReceivedVia(channelRfDup.receivedVia, msg.receivedVia),
      rxHops: channelRfDup.rxHops ?? msg.rxHops,
    };
    const canonicalId =
      preferredId ??
      findStoreRecordIdForMessage(identityId, channelRfDup) ??
      meshcoreMessageStoreId(merged);
    const record = chatMessageToMessageRecord(merged);
    record.id = canonicalId;
    upsertMessage(identityId, record);
    persistMeshcoreDedupeIndex(identityId, merged, canonicalId);
    const altId = meshcoreMessageStoreId(msg);
    if (altId !== canonicalId) {
      deleteMessage(identityId, altId);
      removeMeshcoreDedupeIndexForMessage(identityId, msg);
    }
    return { inserted: false, storeUpdated: true, message: merged, canonicalId };
  }

  const roomDup = findMeshcoreRoomPostDuplicate(storeMessages, msg);
  if (roomDup) {
    return applyRoomPostDuplicateMerge(identityId, roomDup, msg, preferredId);
  }

  const canonicalId = preferredId ?? meshcoreMessageStoreId(msg);
  const record = chatMessageToMessageRecord(msg);
  record.id = canonicalId;
  upsertMessage(identityId, record);
  persistMeshcoreDedupeIndex(identityId, msg, canonicalId);
  return { inserted: true, storeUpdated: true, message: msg, canonicalId };
}

function meshcoreReplyRepairMatchKey(msg: ChatMessage): string {
  const roomKey =
    msg.roomServerId != null
      ? String(msg.roomServerId)
      : msg.channel === MESHCORE_ROOM_MESSAGE_CHANNEL && msg.to != null
        ? String(msg.to)
        : '';
  return [msg.sender_id, msg.channel, msg.timestamp, msg.payload, msg.to ?? '', roomKey].join('|');
}

export function meshcoreReplyFieldsDiffer(a: ChatMessage, b: ChatMessage): boolean {
  return (
    (a.replyId ?? undefined) !== (b.replyId ?? undefined) ||
    (a.replyPreviewText ?? undefined) !== (b.replyPreviewText ?? undefined) ||
    (a.replyPreviewSender ?? undefined) !== (b.replyPreviewSender ?? undefined)
  );
}

/**
 * Persist display-repaired reply metadata when `meshcoreChatMessagesForDisplay` corrects stale
 * store/DB rows. Failure point: DB IPC — logged; Zustand update still applies for UI consistency.
 */
export function syncMeshcoreDisplayReplyRepairs(
  identityId: IdentityId,
  storeRecords: MessageRecord[],
  repaired: ChatMessage[],
): void {
  if (storeRecords.length === 0 || repaired.length === 0) return;

  const recordIdByKey = new Map<string, string>();
  const rawByKey = new Map<string, ChatMessage>();
  for (const rec of storeRecords) {
    const raw = messageRecordToChatMessage(rec);
    const key = meshcoreReplyRepairMatchKey(raw);
    recordIdByKey.set(key, rec.id);
    rawByKey.set(key, raw);
  }

  for (const fixed of repaired) {
    if (fixed.replyId == null && !fixed.replyPreviewSender && !fixed.replyPreviewText) continue;
    const key = meshcoreReplyRepairMatchKey(fixed);
    const raw = rawByKey.get(key);
    if (!raw || !meshcoreReplyFieldsDiffer(raw, fixed)) continue;
    const recordId = recordIdByKey.get(key);
    if (!recordId) continue;

    const record = chatMessageToMessageRecord(fixed);
    record.id = recordId;
    upsertMessage(identityId, record);
    void window.electronAPI.db.saveMeshcoreMessage(messageToDbRow(fixed)).catch((e: unknown) => {
      console.warn(
        '[meshcoreStoreDedup] syncMeshcoreDisplayReplyRepairs save failed ' + errLikeToLogString(e),
      );
    });
  }
}
