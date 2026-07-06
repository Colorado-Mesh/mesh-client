import { packetRouter } from '@/renderer/lib/drivers/PacketRouter';
import {
  buildMeshcoreRoomIncomingMessage,
  parseMeshcoreChannelIncomingFromThread,
  parseMeshcoreDmIncomingFromThread,
  resolveMeshcoreChannelMessageSender,
} from '@/renderer/lib/meshcoreChannelText';
import { dispatchMeshcoreWaitingContactMessage } from '@/renderer/lib/meshcoreDirectMessageDecode';
import { meshcoreRoomPostBodyFromWire } from '@/renderer/lib/meshcoreRoomMessageRouting';
import { setMeshcoreRoomLastPostAt } from '@/renderer/lib/meshcoreRoomSyncStorage';
import {
  isMeshcoreTransportStatusChatLine,
  meshcoreMergeChannelDisplayNameOntoNode,
  minimalMeshcoreChatNode,
} from '@/renderer/lib/meshcoreUtils';
import { effectiveMessageTimestampMs } from '@/renderer/lib/nodeStatus';
import type { ChatMessage, MeshNode } from '@/renderer/lib/types';

import type { MeshcoreWaitingMessageItem } from './meshcoreWaitingMessageItem';

export interface ProcessWaitingMessageItemResult {
  nodesDirty: boolean;
  pendingMessages: ChatMessage[];
  roomDispatched: boolean;
}

export interface ProcessWaitingMessageItemDeps {
  workingNodes: Map<number, MeshNode>;
  pubKeyPrefixMap: Map<string, number>;
  myNodeNum: number;
  meshcoreIdentityId: string | null;
  legacyOwnsRoomPosts: () => boolean;
  storePriorForBatch: () => ChatMessage[];
  logTransportLineAsDevice: (text: string) => void;
}

export function processMeshcoreWaitingMessageItem(
  m: MeshcoreWaitingMessageItem,
  deps: ProcessWaitingMessageItemDeps,
): ProcessWaitingMessageItemResult {
  const pendingMessages: ChatMessage[] = [];
  let nodesDirty = false;
  let roomDispatched = false;

  if (m.contactMessage) {
    const d = m.contactMessage;
    const prefix = Array.from(d.pubKeyPrefix)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const senderId = deps.pubKeyPrefixMap.get(prefix) ?? 0;
    if (senderId === 0) {
      console.warn(
        '[useMeshcoreRuntime] event 131: unknown pubKeyPrefix in queued DM, sender will be 0',
        prefix,
      );
    }
    const sender = deps.workingNodes.get(senderId);
    if (senderId !== 0) {
      const existing = deps.workingNodes.get(senderId);
      if (existing) {
        deps.workingNodes.set(senderId, {
          ...existing,
          last_heard: Math.max(existing.last_heard ?? 0, d.senderTimestamp),
        });
        nodesDirty = true;
      }
    }
    if (isMeshcoreTransportStatusChatLine(d.text)) {
      deps.logTransportLineAsDevice(d.text);
    } else if (sender?.hw_model === 'Room') {
      const postTs = effectiveMessageTimestampMs(d.senderTimestamp * 1000);
      if (!deps.legacyOwnsRoomPosts()) {
        const identityId = deps.meshcoreIdentityId;
        if (identityId) {
          const roomNodeIds = new Set<number>();
          for (const [nodeId, node] of deps.workingNodes) {
            if (node.hw_model === 'Room') roomNodeIds.add(nodeId);
          }
          dispatchMeshcoreWaitingContactMessage(
            identityId,
            {
              pubKeyPrefix: d.pubKeyPrefix,
              text: d.text,
              senderTimestamp: d.senderTimestamp,
              ...(d.txtType != null ? { txtType: d.txtType } : {}),
            },
            deps.pubKeyPrefixMap,
            roomNodeIds,
            (event, id) => {
              packetRouter.dispatch(event, id);
            },
            deps.logTransportLineAsDevice,
          );
          roomDispatched = true;
          void setMeshcoreRoomLastPostAt(senderId, postTs);
        } else {
          console.warn(
            '[useMeshcoreRuntime] event 131: room post skipped (no identityId)',
            senderId,
          );
        }
      } else {
        const { authorId, payload } = meshcoreRoomPostBodyFromWire(
          d.text,
          d.txtType,
          deps.pubKeyPrefixMap,
          { isKnownRoomNode: true },
        );
        const authorNode = authorId !== 0 ? deps.workingNodes.get(authorId) : undefined;
        const authorName =
          authorNode?.long_name ??
          (authorId !== 0 ? `Node-${authorId.toString(16).toUpperCase()}` : 'Unknown');
        pendingMessages.push(
          buildMeshcoreRoomIncomingMessage({
            rawText: payload,
            roomServerId: senderId,
            authorId: authorId !== 0 ? authorId : deps.myNodeNum || 0,
            authorName,
            timestamp: effectiveMessageTimestampMs(d.senderTimestamp * 1000),
            receivedVia: 'rf',
          }),
        );
      }
    } else {
      pendingMessages.push({
        ...parseMeshcoreDmIncomingFromThread(deps.storePriorForBatch(), {
          rawText: d.text,
          senderId,
          displayName: sender?.long_name ?? `Node-${senderId.toString(16).toUpperCase()}`,
          timestamp: effectiveMessageTimestampMs(d.senderTimestamp * 1000),
          receivedVia: 'rf',
          peerNodeId: senderId,
          myNodeId: deps.myNodeNum || 0,
          to: deps.myNodeNum || undefined,
        }),
        isHistory: true,
      });
    }
  }

  if (m.channelMessage) {
    const d = m.channelMessage;
    if (isMeshcoreTransportStatusChatLine(d.text)) {
      deps.logTransportLineAsDevice(d.text);
    } else {
      const resolved = resolveMeshcoreChannelMessageSender({
        rawText: d.text,
        nodes: deps.workingNodes,
      });
      if (resolved.senderId !== 0) {
        const existing = deps.workingNodes.get(resolved.senderId);
        deps.workingNodes.set(
          resolved.senderId,
          existing
            ? meshcoreMergeChannelDisplayNameOntoNode(
                {
                  ...existing,
                  last_heard: Math.max(existing.last_heard ?? 0, d.senderTimestamp),
                },
                resolved.displayName,
              )
            : minimalMeshcoreChatNode(
                resolved.senderId,
                resolved.displayName,
                d.senderTimestamp,
                'rf',
              ),
        );
        nodesDirty = true;
      }
      pendingMessages.push({
        ...parseMeshcoreChannelIncomingFromThread(deps.storePriorForBatch(), {
          rawText: d.text,
          senderId: resolved.senderId,
          displayName: resolved.displayName,
          channel: d.channelIdx,
          timestamp: effectiveMessageTimestampMs(d.senderTimestamp * 1000),
          receivedVia: 'rf',
        }),
        isHistory: true,
      });
    }
  }

  return { nodesDirty, pendingMessages, roomDispatched };
}
