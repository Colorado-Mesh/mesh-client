/**
 * Post-`PacketRouter` MeshCore side effects: tapback parsing, SQLite persistence.
 *
 * Failure point: DB IPC errors — logged; Zustand store remains authoritative for UI.
 * Fallback: skip DB write; live UI still updates from store upserts.
 */
import {
  meshcoreReconcileChannelSenderIds,
  messageToDbRow,
} from '../../hooks/meshcore/meshcoreHookPreamble';
import { getConnection } from '../../stores/connectionStore';
import { upsertMessage, useMessageStore } from '../../stores/messageStore';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { errLikeToLogString } from '../errLikeToLogString';
import {
  buildMeshcoreChannelIncomingMessage,
  buildMeshcoreDmIncomingMessage,
  resolveMeshcoreChannelMessageSender,
} from '../meshcoreChannelText';
import { meshcoreChatStubNodeIdFromDisplayName } from '../meshcoreUtils';
import type { DomainEvent } from '../protocols/Protocol';
import { chatMessageToMessageRecord, messageRecordsToChatMessages } from '../storeRecordAdapters';
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

function handleTextMessage(
  identityId: IdentityId,
  event: Extract<DomainEvent, { type: 'text_message' }>,
): void {
  const record = useMessageStore.getState().messages[identityId]?.[event.payload.id];
  if (!record) return;

  const myNodeNum = getConnection(identityId)?.myNodeNum ?? 0;
  const messages = listChatMessages(identityId);
  const isChannel = event.payload.id.startsWith('ch:');
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
  const nextRecord = chatMessageToMessageRecord(reconciled);
  nextRecord.id = event.payload.id;
  upsertMessage(identityId, nextRecord);

  const isEcho = myNodeNum > 0 && senderId === myNodeNum;
  if (!isEcho) {
    void window.electronAPI.db
      .saveMeshcoreMessage(messageToDbRow(reconciled))
      .catch((e: unknown) => {
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
