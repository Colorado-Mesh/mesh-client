import { isMeshcoreRoomChatMessage } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import type { ChatMessage, MeshProtocol } from '@/renderer/lib/types';
import { isMeshtasticBroadcastNodeNum } from '@/shared/nodeNameUtils';

/** Chat rows used for unread badges (excludes tapbacks and MeshCore room-server traffic). */
export function filterRegularChatMessages(
  messages: readonly ChatMessage[],
  protocol: MeshProtocol,
): ChatMessage[] {
  const regular: ChatMessage[] = [];
  for (const msg of messages) {
    if (protocol === 'meshcore' && isMeshcoreRoomChatMessage(msg)) continue;
    if (msg.emoji && msg.replyId) continue;
    regular.push(msg);
  }
  return regular;
}

export interface ChatUnreadDmOptions {
  /** MeshCore: omit room-server node ids (BBS belongs in Rooms, not Chat DM unread). */
  excludeDmPeer?: (peer: number) => boolean;
}

/** DM peer for unread counting; excludes broadcast and non-DM traffic. */
/** Persisted last-read / unread view key (`ch:N` or `dm:peer`). */
export function chatViewKeyForMessage(
  msg: Pick<ChatMessage, 'channel' | 'to' | 'sender_id'>,
  protocol: MeshProtocol,
  ownNodeIds: ReadonlySet<number>,
  dmOptions?: ChatUnreadDmOptions,
): string {
  const peer = resolveChatDmPeer(msg as ChatMessage, ownNodeIds, protocol, dmOptions);
  if (peer != null) return `dm:${peer}`;
  return `ch:${msg.channel}`;
}

export function resolveChatDmPeer(
  msg: ChatMessage,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  options?: ChatUnreadDmOptions,
): number | undefined {
  if (protocol === 'meshcore' && isMeshcoreRoomChatMessage(msg)) return undefined;
  if (msg.to == null) return undefined;
  const isOwn = (id: number) => ownNodeIds.has(id);
  let peer: number | undefined;
  if (isOwn(msg.sender_id) && !isOwn(msg.to)) peer = msg.to;
  else if (isOwn(msg.to) && !isOwn(msg.sender_id)) peer = msg.sender_id;
  if (
    peer == null &&
    protocol === 'meshcore' &&
    msg.channel === -1 &&
    msg.sender_id > 0 &&
    !isOwn(msg.sender_id)
  ) {
    peer = msg.sender_id;
  }
  if (peer == null) return undefined;
  if (protocol === 'meshtastic' && isMeshtasticBroadcastNodeNum(peer)) return undefined;
  const peerU32 = peer >>> 0;
  if (options?.excludeDmPeer?.(peerU32)) return undefined;
  return peerU32;
}

export function computeChannelUnreadCounts(
  messages: readonly ChatMessage[],
  persistedLastRead: Readonly<Record<string, number>>,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
): Map<number, number> {
  const counts = new Map<number, number>();
  const regular = filterRegularChatMessages(messages, protocol);
  for (const msg of regular) {
    if (ownNodeIds.has(msg.sender_id)) continue;
    if (msg.to) continue;
    if (msg.channel < 0) continue;
    if (msg.isHistory) continue;
    const lastRead = persistedLastRead[`ch:${msg.channel}`] ?? 0;
    if (msg.timestamp > lastRead) {
      counts.set(msg.channel, (counts.get(msg.channel) ?? 0) + 1);
    }
  }
  return counts;
}

export function computeDmUnreadCounts(
  messages: readonly ChatMessage[],
  persistedLastRead: Readonly<Record<string, number>>,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  options?: ChatUnreadDmOptions,
): Map<number, number> {
  const counts = new Map<number, number>();
  const regular = filterRegularChatMessages(messages, protocol);
  for (const msg of regular) {
    if (msg.isHistory) continue;
    const peer = resolveChatDmPeer(msg, ownNodeIds, protocol, options);
    if (peer == null) continue;
    if (ownNodeIds.has(msg.sender_id)) continue;
    const lr = persistedLastRead[`dm:${peer}`] ?? 0;
    if (msg.timestamp > lr) {
      counts.set(peer, (counts.get(peer) ?? 0) + 1);
    }
  }
  return counts;
}

export function totalUnreadCount(
  messages: readonly ChatMessage[],
  persistedLastRead: Readonly<Record<string, number>>,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
  dmOptions?: ChatUnreadDmOptions,
): number {
  const channel = computeChannelUnreadCounts(messages, persistedLastRead, ownNodeIds, protocol);
  const dm = computeDmUnreadCounts(messages, persistedLastRead, ownNodeIds, protocol, dmOptions);
  let total = 0;
  for (const n of channel.values()) total += n;
  for (const n of dm.values()) total += n;
  return total;
}

/** True when at least one message maps to a view that is not per-conversation muted. */
export function hasAudibleBackgroundMessages(
  messages: readonly ChatMessage[],
  protocol: MeshProtocol,
  mutedViews: ReadonlySet<string>,
  ownNodeIds: ReadonlySet<number>,
  dmOptions?: ChatUnreadDmOptions,
): boolean {
  return messages.some(
    (m) => !mutedViews.has(chatViewKeyForMessage(m, protocol, ownNodeIds, dmOptions)),
  );
}
