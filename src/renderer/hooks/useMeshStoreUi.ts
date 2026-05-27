import { useMemo } from 'react';

import { messageRecordsToChatMessages, nodeRecordsToMeshNodeMap } from '../lib/storeRecordAdapters';
import type { ChatMessage, IdentityId, MeshNode } from '../lib/types';
import { useMessages } from './useMessages';
import { useNodes } from './useNodes';

/**
 * Identity-scoped message list for UI panels. Merges Zustand store rows (protocol
 * ingress + DB refresh) with legacy hook state so panels stay complete during
 * hook deconstruction.
 */
export function useMergedMessages(
  identityId: IdentityId | null | undefined,
  legacyMessages: ChatMessage[],
): ChatMessage[] {
  const storeMessages = useMessages(identityId ?? null);
  return useMemo(() => {
    if (!identityId) return legacyMessages;
    const fromStore = messageRecordsToChatMessages(storeMessages);
    if (fromStore.length === 0) return legacyMessages;
    if (legacyMessages.length === 0) return fromStore;
    const byKey = new Map<string, ChatMessage>();
    for (const msg of fromStore) {
      const key =
        msg.packetId != null
          ? `p:${msg.packetId}`
          : `${msg.sender_id}-${msg.timestamp}-${msg.channel}`;
      byKey.set(key, msg);
    }
    for (const msg of legacyMessages) {
      const key =
        msg.packetId != null
          ? `p:${msg.packetId}`
          : `${msg.sender_id}-${msg.timestamp}-${msg.channel}`;
      byKey.set(key, msg);
    }
    return [...byKey.values()].sort((a, b) => a.timestamp - b.timestamp);
  }, [identityId, legacyMessages, storeMessages]);
}

/**
 * Identity-scoped node map for UI panels. Store rows are merged under legacy
 * hook nodes so MeshCore/MQTT-only fields remain until ingress fully moves.
 */
export function useMergedNodesMap(
  identityId: IdentityId | null | undefined,
  legacyNodes: Map<number, MeshNode>,
): Map<number, MeshNode> {
  const storeNodes = useNodes(identityId ?? null);
  return useMemo(() => {
    if (!identityId) return legacyNodes;
    const fromStore = nodeRecordsToMeshNodeMap(storeNodes);
    if (fromStore.size === 0) return legacyNodes;
    const merged = new Map(fromStore);
    for (const [id, node] of legacyNodes) {
      merged.set(id, { ...merged.get(id), ...node });
    }
    return merged;
  }, [identityId, legacyNodes, storeNodes]);
}
