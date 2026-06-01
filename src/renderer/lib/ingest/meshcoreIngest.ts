/**
 * Post-`PacketRouter` MeshCore side effects: tapback parsing, SQLite persistence.
 *
 * Failure point: DB IPC errors — logged; Zustand store remains authoritative for UI.
 * Fallback: skip DB write; live UI still updates from store upserts.
 */
import {
  isMeshcoreRoomChatMessage,
  MESHCORE_ROOM_MESSAGE_CHANNEL,
  meshcoreReconcileChannelSenderIds,
  messageToDbRow,
} from '../../hooks/meshcore/meshcoreHookPreamble';
import { getConnection } from '../../stores/connectionStore';
import { useMessageStore } from '../../stores/messageStore';
import { useNodeStore } from '../../stores/nodeStore';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { errLikeToLogString } from '../errLikeToLogString';
import {
  buildMeshcoreRoomIncomingMessage,
  MESHCORE_TXT_TYPE_SIGNED_PLAIN,
  parseMeshcoreChannelIncomingFromThread,
  parseMeshcoreDmIncomingFromThread,
  parseMeshcoreRoomPostPayload,
  resolveMeshcoreChannelMessageSender,
} from '../meshcoreChannelText';
import { meshcoreSortedStorePrior, upsertMeshcoreMessageWithDedup } from '../meshcoreStoreDedup';
import { meshcoreChatStubNodeIdFromDisplayName } from '../meshcoreUtils';
import type { DomainEvent } from '../protocols/Protocol';
import type { ChatMessage, IdentityId } from '../types';

/** MeshCore contacts belong in meshcore_contacts SQLite, not the Meshtastic nodes table. */
function persistContactNodes(identityId: IdentityId): void {
  // Legacy conn events and refreshContacts persist via saveMeshcoreContact.
  void identityId;
}

function listChatMessages(identityId: IdentityId): ChatMessage[] {
  return meshcoreSortedStorePrior(identityId);
}

function buildPrefixToNodeIdMap(identityId: IdentityId): Map<string, number> {
  const map = new Map<string, number>();
  const nodes = useNodeStore.getState().nodes[identityId] ?? {};
  for (const node of Object.values(nodes)) {
    if (node.publicKey instanceof Uint8Array && node.publicKey.length >= 4) {
      const prefix = Array.from(node.publicKey.slice(0, 4))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      map.set(prefix, node.nodeId);
    }
  }
  return map;
}

function handleTextMessage(
  identityId: IdentityId,
  event: Extract<DomainEvent, { type: 'text_message' }>,
): void {
  const record = useMessageStore.getState().messages[identityId]?.[event.payload.id];
  if (!record) return;

  const priorReplyId = record.replyTo != null ? Number(record.replyTo) : undefined;
  const priorReplyPreviewText = record.replyPreviewText;
  const priorReplyPreviewSender = record.replyPreviewSender;

  const myNodeNum = getConnection(identityId)?.myNodeNum ?? 0;
  const messages = listChatMessages(identityId);
  const isChannel = event.payload.id.startsWith('ch:');
  const roomServerId = event.payload.roomServerId ?? event.payload.from;
  const looksLikeRoom =
    event.payload.txtType === MESHCORE_TXT_TYPE_SIGNED_PLAIN ||
    event.payload.roomServerId != null ||
    event.payload.channelIndex === MESHCORE_ROOM_MESSAGE_CHANNEL ||
    event.payload.id.startsWith('room:');
  const isRoomEvent = looksLikeRoom && roomServerId !== 0;

  if (isRoomEvent) {
    const prefixMap = buildPrefixToNodeIdMap(identityId);
    const { authorId, payload } = parseMeshcoreRoomPostPayload(event.payload.payload, prefixMap);
    const authorNode =
      authorId !== 0 ? useNodeStore.getState().nodes[identityId]?.[authorId] : undefined;
    const authorName =
      authorNode?.longName?.trim() ||
      (authorId !== 0 ? `Node-${authorId.toString(16).toUpperCase()}` : 'Unknown');
    const merged = buildMeshcoreRoomIncomingMessage({
      rawText: payload,
      roomServerId,
      authorId: authorId !== 0 ? authorId : myNodeNum || 0,
      authorName,
      timestamp: event.payload.timestamp,
      receivedVia: record.receivedVia ?? 'rf',
      rxHops: event.payload.hopCount,
    });
    const { inserted, message: stored } = upsertMeshcoreMessageWithDedup(
      identityId,
      merged,
      event.payload.id,
    );
    const isEcho = myNodeNum > 0 && authorId === myNodeNum;
    if (inserted && !isEcho) {
      void window.electronAPI.db.saveMeshcoreMessage(messageToDbRow(stored)).catch((e: unknown) => {
        console.warn('[meshcoreIngest] saveMeshcoreMessage failed ' + errLikeToLogString(e));
      });
    }
    return;
  }

  const channelSender = isChannel
    ? resolveMeshcoreChannelMessageSender({
        rawText: event.payload.payload,
        fromNodeId: event.payload.from,
        recordSenderName: record.senderName,
      })
    : null;
  const displayName = isChannel
    ? channelSender!.displayName
    : record.senderName?.trim() || 'Unknown';
  const senderId = isChannel
    ? channelSender!.senderId
    : event.payload.from !== 0
      ? event.payload.from
      : meshcoreChatStubNodeIdFromDisplayName(displayName);

  const sortedPrior = messages;

  const parsedRaw: ChatMessage = isChannel
    ? parseMeshcoreChannelIncomingFromThread(sortedPrior, {
        rawText: event.payload.payload,
        senderId,
        displayName,
        channel: event.payload.channelIndex,
        timestamp: event.payload.timestamp,
        receivedVia: 'rf',
        rxHops: event.payload.hopCount,
      })
    : parseMeshcoreDmIncomingFromThread(sortedPrior, {
        rawText: event.payload.payload,
        senderId,
        displayName,
        timestamp: event.payload.timestamp,
        receivedVia: 'rf',
        peerNodeId: senderId,
        myNodeId: myNodeNum,
        to: myNodeNum > 0 ? myNodeNum : undefined,
        rxHops: event.payload.hopCount,
      });

  const merged: ChatMessage = {
    ...parsedRaw,
    status: record.status ?? parsedRaw.status,
    receivedVia: record.receivedVia ?? parsedRaw.receivedVia,
  };
  const reconciled =
    isChannel && messages.length > 0
      ? (meshcoreReconcileChannelSenderIds([...messages, merged]).at(-1) ?? merged)
      : merged;

  if (isMeshcoreRoomChatMessage(reconciled)) {
    return;
  }

  const {
    inserted,
    storeUpdated,
    message: stored,
  } = upsertMeshcoreMessageWithDedup(identityId, reconciled, event.payload.id);

  const isEcho = myNodeNum > 0 && senderId === myNodeNum;
  const replyUpgraded =
    stored.replyId !== priorReplyId ||
    stored.replyPreviewText !== priorReplyPreviewText ||
    stored.replyPreviewSender !== priorReplyPreviewSender;
  if ((inserted || storeUpdated || replyUpgraded) && !isEcho) {
    void window.electronAPI.db.saveMeshcoreMessage(messageToDbRow(stored)).catch((e: unknown) => {
      console.warn('[meshcoreIngest] saveMeshcoreMessage failed ' + errLikeToLogString(e));
    });
  }
}

function createListener(identityId: IdentityId): PacketRouterListener {
  return (event, routedIdentityId) => {
    if (routedIdentityId !== identityId) return;
    switch (event.type) {
      case 'text_message':
        handleTextMessage(identityId, event);
        break;
      case 'node_info':
        persistContactNodes(identityId);
        break;
      case 'device_contacts':
        persistContactNodes(identityId);
        break;
      default:
        break;
    }
  };
}

export function attachMeshcoreIngest(identityId: IdentityId): () => void {
  return packetRouter.addListener(createListener(identityId));
}

/** @internal Exported for tests. */
export { handleTextMessage as meshcoreIngestHandleTextMessage };
