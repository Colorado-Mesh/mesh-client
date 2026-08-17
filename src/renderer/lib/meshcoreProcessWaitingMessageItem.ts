import { packetRouter } from '@/renderer/lib/drivers/PacketRouter';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  MESHCORE_TXT_TYPE_CLI_DATA,
  parseMeshcoreChannelIncomingFromThread,
  parseMeshcoreDmIncomingFromThread,
  resolveMeshcoreChannelMessageSender,
} from '@/renderer/lib/meshcoreChannelText';
import { dispatchMeshcoreWaitingContactMessage } from '@/renderer/lib/meshcoreDirectMessageDecode';
import { setMeshcoreRoomLastPostAt } from '@/renderer/lib/meshcoreRoomSyncStorage';
import {
  isMeshcoreTransportStatusChatLine,
  meshcoreCompanionRxPathLenToHopCount,
  meshcoreMergeChannelDisplayNameOntoNode,
  minimalMeshcoreChatNode,
} from '@/renderer/lib/meshcoreUtils';
import { effectiveMessageTimestampMs } from '@/renderer/lib/nodeStatus';
import type { ChatMessage, MeshNode } from '@/renderer/lib/types';

import type { MeshcoreWaitingMessageItem } from './meshcoreWaitingMessageItem';

export interface ProcessWaitingMessageItemResult {
  nodesDirty: boolean;
  updatedNodeIds: number[];
  pendingMessages: ChatMessage[];
  roomDispatched: boolean;
}

export interface ProcessWaitingMessageItemDeps {
  workingNodes: Map<number, MeshNode>;
  pubKeyPrefixMap: Map<string, number>;
  myNodeNum: number;
  meshcoreIdentityId: string | null;
  storePriorForBatch: () => ChatMessage[];
  logTransportLineAsDevice: (text: string) => void;
}

export function processMeshcoreWaitingMessageItem(
  m: MeshcoreWaitingMessageItem,
  deps: ProcessWaitingMessageItemDeps,
): ProcessWaitingMessageItemResult {
  const pendingMessages: ChatMessage[] = [];
  const updatedNodeIds: number[] = [];
  let nodesDirty = false;
  let roomDispatched = false;

  if (m.contactMessage) {
    const d = m.contactMessage;
    const prefix = Array.from(d.pubKeyPrefix)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const senderId = deps.pubKeyPrefixMap.get(prefix) ?? 0;
    if (d.txtType === MESHCORE_TXT_TYPE_CLI_DATA) {
      if (senderId !== 0) {
        const sender = deps.workingNodes.get(senderId);
        if (sender) {
          deps.workingNodes.set(senderId, {
            ...sender,
            last_heard: Math.max(sender.last_heard, d.senderTimestamp),
          });
          nodesDirty = true;
          updatedNodeIds.push(senderId);
        }
      }
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
            txtType: MESHCORE_TXT_TYPE_CLI_DATA,
            ...(d.pathLen != null ? { pathLen: d.pathLen } : {}),
          },
          deps.pubKeyPrefixMap,
          roomNodeIds,
          (event, id) => {
            packetRouter.dispatch(event, id);
          },
          deps.logTransportLineAsDevice,
        );
      } else {
        console.warn(
          '[meshcoreProcessWaitingMessageItem] CLI waiting message skipped (no identityId)',
          senderId,
        );
      }
    } else if (senderId === 0) {
      console.warn(
        '[meshcoreProcessWaitingMessageItem] unknown pubKeyPrefix in queued DM, skipping ingest',
        prefix,
      );
      if (isMeshcoreTransportStatusChatLine(d.text)) {
        deps.logTransportLineAsDevice(d.text);
      }
    } else {
      const sender = deps.workingNodes.get(senderId);
      if (sender) {
        deps.workingNodes.set(senderId, {
          ...sender,
          last_heard: Math.max(sender.last_heard, d.senderTimestamp),
        });
        nodesDirty = true;
        updatedNodeIds.push(senderId);
      }
      if (isMeshcoreTransportStatusChatLine(d.text)) {
        deps.logTransportLineAsDevice(d.text);
      } else if (sender?.hw_model === 'Room') {
        // Room posts route through PacketRouter → meshcoreIngest, matching live event-7 posts.
        const postTs = effectiveMessageTimestampMs(d.senderTimestamp * 1000);
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
              ...(d.pathLen != null ? { pathLen: d.pathLen } : {}),
            },
            deps.pubKeyPrefixMap,
            roomNodeIds,
            (event, id) => {
              packetRouter.dispatch(event, id);
            },
            deps.logTransportLineAsDevice,
          );
          roomDispatched = true;
          void setMeshcoreRoomLastPostAt(senderId, postTs).catch((e: unknown) => {
            console.warn(
              '[meshcoreProcessWaitingMessageItem] setMeshcoreRoomLastPostAt failed ' +
                errLikeToLogString(e),
            );
          });
        } else {
          console.warn(
            '[meshcoreProcessWaitingMessageItem] room post skipped (no identityId)',
            senderId,
          );
        }
      } else {
        const dmRxHops = meshcoreCompanionRxPathLenToHopCount(d.pathLen);
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
            ...(dmRxHops != null ? { rxHops: dmRxHops } : {}),
          }),
          isHistory: true,
        });
      }
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
                  last_heard: Math.max(existing.last_heard, d.senderTimestamp),
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
        updatedNodeIds.push(resolved.senderId);
      }
      const channelRxHops = meshcoreCompanionRxPathLenToHopCount(d.pathLen);
      pendingMessages.push({
        ...parseMeshcoreChannelIncomingFromThread(deps.storePriorForBatch(), {
          rawText: d.text,
          senderId: resolved.senderId,
          displayName: resolved.displayName,
          channel: d.channelIdx,
          timestamp: effectiveMessageTimestampMs(d.senderTimestamp * 1000),
          receivedVia: 'rf',
          ...(channelRxHops != null ? { rxHops: channelRxHops } : {}),
        }),
        isHistory: true,
      });
    }
  }

  return { nodesDirty, updatedNodeIds, pendingMessages, roomDispatched };
}
