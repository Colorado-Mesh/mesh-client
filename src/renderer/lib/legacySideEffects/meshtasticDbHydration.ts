import { meshtasticShortNameAfterClearingDefault } from '../../../shared/nodeNameUtils';
import { sanitizeUnicodeReactionScalar } from '../../../shared/reactionEmoji';
import { getAppSettingsRaw } from '../appSettingsStorage';
import { MAX_IN_MEMORY_CHAT_MESSAGES, trimChatMessagesToMax } from '../chatInMemoryBuffer';
import { errLikeToLogString } from '../errLikeToLogString';
import { meshtasticHwModelName } from '../hardwareModels';
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

function parseNodeRole(val: unknown): number | undefined {
  const LEGACY_ROLE_STRINGS: Record<string, number> = {
    Client: 0,
    Mute: 1,
    Router: 2,
    'Rtr+Client': 3,
    Repeater: 4,
    Tracker: 5,
    Sensor: 6,
    TAK: 7,
    Hidden: 8,
    'L&F': 9,
    'TAK Tracker': 10,
    'Rtr Late': 11,
    Base: 12,
  };
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    if (!isNaN(n)) return n;
    return LEGACY_ROLE_STRINGS[val];
  }
  return undefined;
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
      const nodeMap = new Map<number, MeshNode>();
      for (const n of savedNodes) {
        const long_name = n.long_name ?? '';
        const rawHw = n.hw_model;
        const hw_model =
          typeof rawHw === 'string' && /^\d+$/.test(rawHw.trim())
            ? meshtasticHwModelName(parseInt(rawHw, 10))
            : (rawHw ?? '');
        nodeMap.set(n.node_id, {
          ...n,
          long_name,
          hw_model,
          short_name: meshtasticShortNameAfterClearingDefault(
            long_name,
            n.short_name ?? '',
            n.node_id,
          ),
          role: parseNodeRole(n.role),
          favorited: Boolean(n.favorited),
          heard_via_mqtt_only: n.source === 'mqtt',
          hops: n.hops ?? undefined,
          path: typeof n.path === 'string' ? JSON.parse(n.path) : undefined,
          hops_away: n.hops ?? n.hops_away ?? undefined,
        });
      }
      for (const mc of meshcoreContacts as { node_id: number; hops_away: number | null }[]) {
        if (mc.hops_away != null) {
          const existing = nodeMap.get(mc.node_id);
          if (existing && existing.hops_away === undefined) {
            nodeMap.set(mc.node_id, { ...existing, hops_away: mc.hops_away });
          }
        }
      }
      callbacks.onNodesLoaded(nodeMap);
      callbacks.setNodes(nodeMap);
    })
    .catch((err: unknown) => {
      console.error('[meshtasticDbHydration] Failed to load nodes: ' + errLikeToLogString(err));
    });
}
