import { useEffect, useMemo } from 'react';

import { meshcoreChatMessagesForDisplay } from '../lib/meshcoreChannelText';
import {
  meshcoreRoomServerIdsFromNodes,
  repairMeshcoreHydratedMessages,
} from '../lib/meshcoreDbCacheHydration';
import { syncMeshcoreDisplayReplyRepairs } from '../lib/meshcoreStoreDedup';
import { perfSpanSync } from '../lib/perfTrace';
import {
  type ChannelRemapContext,
  remapChannelMessagesToLiveSlots,
} from '../lib/remapChannelMessagesToLiveSlots';
import { repairMeshtasticReplyPreviews } from '../lib/replyPreview';
import { messageRecordsToChatMessages, nodeRecordToMeshNode } from '../lib/storeRecordAdapters';
import type { ChatMessage, IdentityId, MeshProtocol } from '../lib/types';
import { useNodeStore } from '../stores/nodeStore';
import { useMessages } from './useMessages';

export interface UseProtocolChatMessagesOptions {
  remap?: ChannelRemapContext | null;
  meshcoreSelfNodeId?: number;
}

/**
 * Store → ChatMessage[] for one protocol, including reply repair and channel-slot remap.
 * Mount inside the consumer (ChatSurface / notifier / badges), so a message insert can
 * re-render only the surface that shows messages — not the App shell.
 */
export function useProtocolChatMessages(
  protocol: MeshProtocol,
  identityId: IdentityId | null,
  options?: UseProtocolChatMessagesOptions,
): ChatMessage[] {
  const storeMessages = useMessages(identityId);
  const remap = options?.remap ?? null;
  const meshcoreSelfNodeId = options?.meshcoreSelfNodeId ?? 0;
  const meshcoreNodesById = useNodeStore((s) =>
    protocol === 'meshcore' && identityId ? s.nodes[identityId] : undefined,
  );

  const meshcoreRepaired = useMemo(() => {
    if (protocol !== 'meshcore') return null;
    return perfSpanSync('store->chat:meshcore', () => {
      const mapped = meshcoreChatMessagesForDisplay(messageRecordsToChatMessages(storeMessages), {
        selfNodeId: meshcoreSelfNodeId,
      });
      if (!meshcoreNodesById) return mapped;
      const roomIds = meshcoreRoomServerIdsFromNodes(
        Object.values(meshcoreNodesById).map(nodeRecordToMeshNode),
      );
      return repairMeshcoreHydratedMessages(mapped, roomIds, meshcoreSelfNodeId);
    });
  }, [protocol, storeMessages, meshcoreNodesById, meshcoreSelfNodeId]);

  useEffect(() => {
    if (protocol !== 'meshcore' || !identityId || !meshcoreRepaired) return;
    const timer = window.setTimeout(() => {
      syncMeshcoreDisplayReplyRepairs(identityId, storeMessages, meshcoreRepaired);
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [protocol, identityId, storeMessages, meshcoreRepaired]);

  return useMemo(() => {
    if (protocol === 'meshtastic') {
      return perfSpanSync('store->chat:meshtastic', () =>
        remapChannelMessagesToLiveSlots(
          repairMeshtasticReplyPreviews(messageRecordsToChatMessages(storeMessages)),
          remap,
        ),
      );
    }
    if (protocol === 'meshcore') {
      return remapChannelMessagesToLiveSlots(meshcoreRepaired ?? [], remap);
    }
    return perfSpanSync('store->chat:reticulum', () => messageRecordsToChatMessages(storeMessages));
  }, [protocol, storeMessages, remap, meshcoreRepaired]);
}
