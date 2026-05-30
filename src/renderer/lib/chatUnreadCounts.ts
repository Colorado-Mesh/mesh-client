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

/** DM peer for unread counting; excludes broadcast and non-DM traffic. */
export function resolveChatDmPeer(
  msg: ChatMessage,
  ownNodeIds: ReadonlySet<number>,
  protocol: MeshProtocol,
): number | undefined {
  if (protocol === 'meshcore' && isMeshcoreRoomChatMessage(msg)) return undefined;
  if (msg.to == null) return undefined;
  const isOwn = (id: number) => ownNodeIds.has(id);
  let peer: number | undefined;
  if (isOwn(msg.sender_id) && !isOwn(msg.to)) peer = msg.to;
  else if (isOwn(msg.to) && !isOwn(msg.sender_id)) peer = msg.sender_id;
  if (peer == null) return undefined;
  if (protocol === 'meshtastic' && isMeshtasticBroadcastNodeNum(peer)) return undefined;
  return peer >>> 0;
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
): Map<number, number> {
  const counts = new Map<number, number>();
  const regular = filterRegularChatMessages(messages, protocol);
  for (const msg of regular) {
    if (msg.isHistory) continue;
    const peer = resolveChatDmPeer(msg, ownNodeIds, protocol);
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
): number {
  const channel = computeChannelUnreadCounts(messages, persistedLastRead, ownNodeIds, protocol);
  const dm = computeDmUnreadCounts(messages, persistedLastRead, ownNodeIds, protocol);
  let total = 0;
  for (const n of channel.values()) total += n;
  for (const n of dm.values()) total += n;
  return total;
}
