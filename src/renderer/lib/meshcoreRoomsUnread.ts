import { isMeshcoreRoomChatMessage } from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import type { ChatMessage } from '@/renderer/lib/types';

/** Count unread room BBS posts per room server node id. */
export function computeRoomUnreadCounts(
  messages: readonly ChatMessage[],
  persistedLastRead: Readonly<Record<number, number>>,
  ownNodeIds: ReadonlySet<number>,
  mutedViews?: ReadonlySet<string>,
  /** When set, ignore posts for room servers that are no longer in the Rooms list. */
  knownRoomServerIds?: ReadonlySet<number>,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const msg of messages) {
    if (!isMeshcoreRoomChatMessage(msg)) continue;
    if (msg.roomServerId == null) continue;
    if (knownRoomServerIds != null && !knownRoomServerIds.has(msg.roomServerId)) continue;
    if (mutedViews?.has(`room:${msg.roomServerId}`)) continue;
    if (ownNodeIds.has(msg.sender_id)) continue;
    if (msg.isHistory) continue;
    if (msg.status === 'sending' || msg.status === 'failed') continue;
    const lastRead = persistedLastRead[msg.roomServerId] ?? 0;
    if (msg.timestamp > lastRead) {
      counts.set(msg.roomServerId, (counts.get(msg.roomServerId) ?? 0) + 1);
    }
  }
  return counts;
}

export function totalRoomsUnreadCount(
  messages: readonly ChatMessage[],
  persistedLastRead: Readonly<Record<number, number>>,
  ownNodeIds: ReadonlySet<number>,
  mutedViews?: ReadonlySet<string>,
  knownRoomServerIds?: ReadonlySet<number>,
): number {
  let total = 0;
  for (const n of computeRoomUnreadCounts(
    messages,
    persistedLastRead,
    ownNodeIds,
    mutedViews,
    knownRoomServerIds,
  ).values()) {
    total += n;
  }
  return total;
}
