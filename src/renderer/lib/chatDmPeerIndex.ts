import {
  type ChatUnreadDmOptions,
  filterRegularChatMessages,
  resolveChatDmPeer,
} from '@/renderer/lib/chatUnreadCounts';
import type { ChatMessage, MeshProtocol } from '@/renderer/lib/types';

export interface ChatDmPeerIndexEntry {
  lastMessageAt: number;
  messageCount: number;
}

export interface ChatDmPeerDbRow {
  node_id: number;
  last_message_at: number;
}

/**
 * Build a map of DM conversants from chat messages (inbound or outbound).
 * Uses {@link resolveChatDmPeer} so Chat inferred tabs and NodeList History stay aligned.
 */
export function buildChatDmPeerIndex(
  messages: readonly ChatMessage[],
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  options?: ChatUnreadDmOptions,
): Map<number, ChatDmPeerIndexEntry> {
  const peers = new Map<number, ChatDmPeerIndexEntry>();
  const regular = filterRegularChatMessages(messages, protocol);
  for (const msg of regular) {
    const peer = resolveChatDmPeer(msg, ownNodeIds, protocol, options);
    if (peer == null) continue;
    const ts =
      typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp) ? msg.timestamp : 0;
    const prev = peers.get(peer);
    if (!prev) {
      peers.set(peer, { lastMessageAt: ts, messageCount: 1 });
      continue;
    }
    peers.set(peer, {
      lastMessageAt: Math.max(prev.lastMessageAt, ts),
      messageCount: prev.messageCount + 1,
    });
  }
  return peers;
}

/** Message-count map for Chat DM tabs (same peers as {@link buildChatDmPeerIndex}). */
export function chatDmPeerMessageCounts(
  messages: readonly ChatMessage[],
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  options?: ChatUnreadDmOptions,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const [peer, entry] of buildChatDmPeerIndex(messages, ownNodeIds, protocol, options)) {
    counts.set(peer, entry.messageCount);
  }
  return counts;
}

/** Merge SQLite DM-peer rows into an in-memory index (keeps the newer lastMessageAt). */
export function mergeChatDmPeerDbRows(
  index: Map<number, ChatDmPeerIndexEntry>,
  rows: readonly ChatDmPeerDbRow[],
): Map<number, ChatDmPeerIndexEntry> {
  const next = new Map(index);
  for (const row of rows) {
    const id = row.node_id;
    if (!Number.isFinite(id) || id <= 0) continue;
    const peer = id >>> 0;
    const ts =
      typeof row.last_message_at === 'number' && Number.isFinite(row.last_message_at)
        ? row.last_message_at
        : 0;
    const prev = next.get(peer);
    if (!prev) {
      next.set(peer, { lastMessageAt: ts, messageCount: 1 });
      continue;
    }
    next.set(peer, {
      lastMessageAt: Math.max(prev.lastMessageAt, ts),
      messageCount: prev.messageCount,
    });
  }
  return next;
}
