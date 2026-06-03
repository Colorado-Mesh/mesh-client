/**
 * Post-`PacketRouter` MeshCore side effects: tapback parsing, SQLite persistence.
 *
 * Failure point: DB IPC errors — logged; Zustand store remains authoritative for UI.
 * Fallback: skip DB write; live UI still updates from store upserts.
 */
import {
  isMeshcoreRoomChatMessage,
  meshcoreReconcileChannelSenderIds,
  messageToDbRow,
} from '../../hooks/meshcore/meshcoreHookPreamble';
import { getConnection } from '../../stores/connectionStore';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { useMessageStore } from '../../stores/messageStore';
import { patchMeshcoreNodeLastHeardAt, upsertNode, useNodeStore } from '../../stores/nodeStore';
import { packetRouter, type PacketRouterListener } from '../drivers/PacketRouter';
import { errLikeToLogString } from '../errLikeToLogString';
import { ensureMeshcoreChatSenderInNodeStore } from '../meshcore/meshcoreChatSenderNode';
import {
  persistMeshcoreNodeInfoAfterAdvert,
  persistMeshcorePathUpdatedNewContact,
} from '../meshcore/meshcoreLiveContactPersist';
import { registerMeshcorePubKey } from '../meshcore/meshcorePubKeyRegistry';
import {
  buildMeshcoreRoomIncomingMessage,
  parseMeshcoreChannelIncomingFromThread,
  parseMeshcoreDmIncomingFromThread,
  resolveMeshcoreChannelMessageSender,
} from '../meshcoreChannelText';
import {
  isMeshcoreRoomServerHwModel,
  meshcoreRoomPostBodyFromWire,
  meshcoreRoomWireLooksLikeRoom,
} from '../meshcoreRoomMessageRouting';
import { meshcoreSortedStorePrior, upsertMeshcoreMessageWithDedup } from '../meshcoreStoreDedup';
import {
  meshcoreChatStubNodeIdFromDisplayName,
  meshcoreMinimalNodeFromAdvertEvent,
} from '../meshcoreUtils';
import type { DomainEvent } from '../protocols/Protocol';
import type { ChatMessage, IdentityId } from '../types';

export interface MeshcoreIngestOptions {
  /** Runtime hook for path-updated side effects (outPath refresh, ping-route epoch). */
  onPathUpdated?: (nodeId: number, publicKey: Uint8Array, isNewContact: boolean) => void;
}

function handleNodeInfo(
  identityId: IdentityId,
  event: Extract<DomainEvent, { type: 'node_info' }>,
): void {
  persistMeshcoreNodeInfoAfterAdvert(identityId, event.payload);
}

function handlePathUpdated(
  identityId: IdentityId,
  event: Extract<DomainEvent, { type: 'meshcore_path_updated' }>,
  options: MeshcoreIngestOptions,
): void {
  const { nodeId, publicKey } = event.payload;
  if (nodeId === 0 || publicKey.length !== 32) return;

  registerMeshcorePubKey(nodeId, publicKey);
  useDiagnosticsStore.getState().recordPathUpdated(nodeId);

  const nowSec = Math.floor(Date.now() / 1000);
  const existing = useNodeStore.getState().nodes[identityId]?.[nodeId];
  const isNew = existing == null;
  if (isNew) {
    persistMeshcorePathUpdatedNewContact(nodeId, publicKey, nowSec);
    const built = meshcoreMinimalNodeFromAdvertEvent(publicKey, { nowSec });
    if (built) {
      upsertNode(identityId, {
        nodeId,
        longName: built.node.long_name,
        hwModel: built.node.hw_model,
        lastHeardAt: built.lastHeardSec,
        publicKey,
      });
    }
  } else {
    patchMeshcoreNodeLastHeardAt(identityId, nodeId, nowSec);
  }

  options.onPathUpdated?.(nodeId, publicKey, isNew);
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

function chatSourceFromReceivedVia(receivedVia: string | undefined): {
  source: 'rf' | 'mqtt';
  heardViaMqtt: boolean;
} {
  if (receivedVia === 'mqtt') return { source: 'mqtt', heardViaMqtt: true };
  if (receivedVia === 'both') return { source: 'rf', heardViaMqtt: true };
  return { source: 'rf', heardViaMqtt: false };
}

function bumpMeshcoreChatSenderLastHeard(
  identityId: IdentityId,
  nodeId: number,
  opts: {
    timestampMs: number;
    displayName?: string;
    receivedVia?: string;
    hopCount?: number;
  },
): void {
  if (nodeId <= 0) return;
  const { source, heardViaMqtt } = chatSourceFromReceivedVia(opts.receivedVia);
  ensureMeshcoreChatSenderInNodeStore(identityId, nodeId, {
    lastHeardAtMs: opts.timestampMs,
    displayName: opts.displayName,
    source,
    heardViaMqtt,
    ...(opts.hopCount != null ? { hopsAway: opts.hopCount } : {}),
  });
}

function resolveRoomServerIdForIngest(
  identityId: IdentityId,
  event: Extract<DomainEvent, { type: 'text_message' }>['payload'],
): number {
  if (event.roomServerId != null && event.roomServerId !== 0) {
    return event.roomServerId;
  }
  if (
    event.from !== 0 &&
    isMeshcoreRoomServerHwModel(useNodeStore.getState().nodes[identityId]?.[event.from]?.hwModel)
  ) {
    return event.from;
  }
  return event.from;
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
  const fromNode = useNodeStore.getState().nodes[identityId]?.[event.payload.from];
  const isKnownRoomNode = isMeshcoreRoomServerHwModel(fromNode?.hwModel);
  const looksLikeRoom = meshcoreRoomWireLooksLikeRoom({
    txtType: event.payload.txtType,
    roomServerId: event.payload.roomServerId,
    channelIndex: event.payload.channelIndex,
    messageId: event.payload.id,
    senderNodeId: event.payload.from,
    isKnownRoomNode,
  });
  const roomServerId = resolveRoomServerIdForIngest(identityId, event.payload);
  const isRoomEvent = looksLikeRoom && roomServerId !== 0;

  if (isRoomEvent) {
    const prefixMap = buildPrefixToNodeIdMap(identityId);
    const { authorId, payload } = meshcoreRoomPostBodyFromWire(
      event.payload.payload,
      event.payload.txtType,
      prefixMap,
    );
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
    if (!isEcho) {
      bumpMeshcoreChatSenderLastHeard(identityId, authorId, {
        timestampMs: event.payload.timestamp,
        displayName: authorName !== 'Unknown' ? authorName : undefined,
        receivedVia: record.receivedVia,
        hopCount: event.payload.hopCount,
      });
    }
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
  if (!isEcho) {
    bumpMeshcoreChatSenderLastHeard(identityId, senderId, {
      timestampMs: event.payload.timestamp,
      displayName: displayName !== 'Unknown' ? displayName : undefined,
      receivedVia: record.receivedVia,
      hopCount: event.payload.hopCount,
    });
  }
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

function createListener(
  identityId: IdentityId,
  options: MeshcoreIngestOptions,
): PacketRouterListener {
  return (event, routedIdentityId) => {
    if (routedIdentityId !== identityId) return;
    switch (event.type) {
      case 'text_message':
        handleTextMessage(identityId, event);
        break;
      case 'node_info':
        handleNodeInfo(identityId, event);
        break;
      case 'meshcore_path_updated':
        handlePathUpdated(identityId, event, options);
        break;
      case 'position': {
        const record = useNodeStore.getState().nodes[identityId]?.[event.payload.nodeId];
        if (record?.publicKey instanceof Uint8Array) {
          persistMeshcoreNodeInfoAfterAdvert(
            identityId,
            {
              nodeId: event.payload.nodeId,
              publicKey: record.publicKey,
              lastHeardAt: Math.floor(event.payload.timestamp / 1000),
            },
            {
              latitudeDeg: event.payload.latitude,
              longitudeDeg: event.payload.longitude,
            },
          );
        }
        break;
      }
      case 'device_contacts':
        break;
      default:
        break;
    }
  };
}

export function attachMeshcoreIngest(
  identityId: IdentityId,
  options: MeshcoreIngestOptions = {},
): () => void {
  return packetRouter.addListener(createListener(identityId, options));
}

/** @internal Exported for tests. */
export { handleTextMessage as meshcoreIngestHandleTextMessage };
