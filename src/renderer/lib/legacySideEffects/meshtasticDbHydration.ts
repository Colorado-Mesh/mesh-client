import { sanitizeUnicodeReactionScalar } from '../../../shared/reactionEmoji';
import { getAppSettingsRaw } from '../appSettingsStorage';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from '../chatInMemoryBuffer';
import { errLikeToLogString } from '../errLikeToLogString';
import { buildMeshtasticNodeMapFromDbRows } from '../meshtasticDbCacheHydration';
import { parseStoredJson } from '../parseStoredJson';
import type { ChatMessage, MeshNode } from '../types';

/** Message cap for Meshtastic SQLite load (shared with identity store hydration). */
export function getMeshtasticMessageLoadLimit(): number {
  const s = parseStoredJson<{
    messageLimitEnabled?: boolean;
    messageLimitCount?: number;
  }>(getAppSettingsRaw(), 'meshtasticDbHydration getMessageLoadLimit');
  if (!s) return 1000;
  if (s.messageLimitEnabled === false) return 10000;
  return Math.max(1, s.messageLimitCount ?? 1000);
}

export interface MeshtasticDbHydrationCallbacks {
  setMessages: (messages: ChatMessage[]) => void;
  setNodes: (nodes: Map<number, MeshNode>) => void;
  onNodesLoaded: (nodes: Map<number, MeshNode>) => void;
  seedSeenPacketId: (packetId: number, expiresAt: number) => void;
}

/**
 * Loads Meshtastic nodes and messages from SQLite on mount. Owned by the legacy
 * side-effect layer until hydration moves into driver connect ([#375]).
 */
export function runMeshtasticDbHydration(callbacks: MeshtasticDbHydrationCallbacks): void {
  window.electronAPI.db
    .getMessages(undefined, getMeshtasticMessageLoadLimit())
    .then((msgs) => {
      const sanitized = msgs.map((m) => ({
        ...m,
        emoji: m.emoji != null ? sanitizeUnicodeReactionScalar(m.emoji) : undefined,
      }));
      const reversed = sanitized.reverse();
      callbacks.setMessages(trimChatMessagesToMax(reversed, MAX_IN_MEMORY_CHAT_MESSAGES));
      for (const m of reversed) {
        if (m.packetId) {
          callbacks.seedSeenPacketId(m.packetId, Date.now() + 10 * 60 * 1000);
        }
      }
    })
    .catch((err: unknown) => {
      console.error('[meshtasticDbHydration] Failed to load messages: ' + errLikeToLogString(err));
      callbacks.setMessages([]);
    });

  Promise.all([window.electronAPI.db.getNodes(), window.electronAPI.db.getMeshcoreContacts()])
    .then(([savedNodes, meshcoreContacts]) => {
      const nodeMap = buildMeshtasticNodeMapFromDbRows(
        savedNodes,
        meshcoreContacts as { node_id: number; hops_away: number | null }[],
      );
      callbacks.onNodesLoaded(nodeMap);
      callbacks.setNodes(nodeMap);
    })
    .catch((err: unknown) => {
      console.error('[meshtasticDbHydration] Failed to load nodes: ' + errLikeToLogString(err));
    });
}
