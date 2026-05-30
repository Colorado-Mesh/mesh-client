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
  buildMeshcoreChannelIncomingMessage,
  buildMeshcoreDmIncomingMessage,
  buildMeshcoreRoomIncomingMessage,
  MESHCORE_TXT_TYPE_SIGNED_PLAIN,
  parseMeshcoreRoomPostPayload,
  resolveMeshcoreChannelMessageSender,
} from '../meshcoreChannelText';
import { upsertMeshcoreMessageWithDedup } from '../meshcoreStoreDedup';
import { meshcoreChatStubNodeIdFromDisplayName } from '../meshcoreUtils';
import type { DomainEvent } from '../protocols/Protocol';
import { messageRecordsToChatMessages } from '../storeRecordAdapters';
import type { ChatMessage, IdentityId } from '../types';

/** MeshCore contacts belong in meshcore_contacts SQLite, not the Meshtastic nodes table. */
function persistContactNodes(identityId: IdentityId): void {
  // Legacy conn events and refreshContacts persist via saveMeshcoreContact.
  void identityId;
}

function listChatMessages(identityId: IdentityId): ChatMessage[] {
  const byId = useMessageStore.getState().messages[identityId] ?? {};
  return messageRecordsToChatMessages(Object.values(byId));
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

  const parsed: ChatMessage = isChannel
    ? buildMeshcoreChannelIncomingMessage(messages, {
        rawText: event.payload.payload,
        senderId,
        displayName,
        channel: event.payload.channelIndex,
        timestamp: event.payload.timestamp,
        receivedVia: 'rf',
        rxHops: event.payload.hopCount,
      })
    : buildMeshcoreDmIncomingMessage(messages, {
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
    ...parsed,
    status: record.status ?? parsed.status,
    receivedVia: record.receivedVia ?? parsed.receivedVia,
  };
  const reconciled =
    isChannel && messages.length > 0
      ? (meshcoreReconcileChannelSenderIds([...messages, merged]).at(-1) ?? merged)
      : merged;

  if (isMeshcoreRoomChatMessage(reconciled)) {
    return;
  }

  const { inserted, message: stored } = upsertMeshcoreMessageWithDedup(
    identityId,
    reconciled,
    event.payload.id,
  );

  const isEcho = myNodeNum > 0 && senderId === myNodeNum;
  if (inserted && !isEcho) {
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
