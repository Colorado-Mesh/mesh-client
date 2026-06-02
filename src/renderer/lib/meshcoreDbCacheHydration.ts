import {
  isMeshcoreRoomChatMessage,
  MESHCORE_ROOM_MESSAGE_CHANNEL,
} from '../hooks/meshcore/meshcoreHookPreamble';
import {
  isMeshcoreRoomServerContactType,
  meshcoreRoomPostBodyFromWire,
} from './meshcoreRoomMessageRouting';
import type { ChatMessage, MeshNode } from './types';

/** Room posts older than this are not still in-flight on the radio. */
const MESHCORE_ROOM_STALE_SENDING_MS = 30_000;

export function meshcoreRoomServerIdsFromNodes(nodes: Iterable<MeshNode>): Set<number> {
  const ids = new Set<number>();
  for (const n of nodes) {
    if (n.hw_model === 'Room') ids.add(n.node_id);
  }
  return ids;
}

export function meshcoreRoomServerIdsFromContacts(
  contacts: readonly { node_id: number; contact_type?: number }[],
): Set<number> {
  const ids = new Set<number>();
  for (const c of contacts) {
    if (isMeshcoreRoomServerContactType(c.contact_type)) ids.add(c.node_id);
  }
  return ids;
}

/**
 * Repair stale `sending` room BBS rows loaded from SQLite.
 * Failure point: older builds persisted `sending` then ack used INSERT OR IGNORE (status never updated).
 * Fallback: treat aged own room posts as acked for display; fresh sends stay `sending`.
 */
export function repairMeshcoreHydrationStaleRoomSends(messages: ChatMessage[]): ChatMessage[] {
  const now = Date.now();
  return messages.map((m) => {
    if (m.status !== 'sending' || !isMeshcoreRoomChatMessage(m)) return m;
    if (now - m.timestamp <= MESHCORE_ROOM_STALE_SENDING_MS) return m;
    return { ...m, status: 'acked' as const, error: undefined };
  });
}

/**
 * Reclassify room-server traffic that was stored as DMs (PLAIN bot stats, etc.).
 * Failure point: older builds only treated SignedPlain as room BBS.
 * Fallback: map peer Room node id → roomServerId + channel -2 for Rooms tab display.
 */
export function repairMeshcoreHydratedMessages(
  messages: ChatMessage[],
  roomServerIds: ReadonlySet<number>,
): ChatMessage[] {
  return repairMeshcoreMisfiledRoomDmMessages(
    repairMeshcoreHydrationStaleRoomSends(messages),
    roomServerIds,
  );
}

export function repairMeshcoreMisfiledRoomDmMessages(
  messages: ChatMessage[],
  roomServerIds: ReadonlySet<number>,
): ChatMessage[] {
  if (roomServerIds.size === 0) return messages;
  return messages.map((m) => {
    if (isMeshcoreRoomChatMessage(m)) return m;
    const peer =
      m.sender_id > 0 && roomServerIds.has(m.sender_id)
        ? m.sender_id
        : m.to != null && roomServerIds.has(m.to)
          ? m.to
          : null;
    if (peer == null) return m;
    const { payload } = meshcoreRoomPostBodyFromWire(m.payload, undefined, new Map());
    return {
      ...m,
      payload,
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      roomServerId: peer,
      to: peer,
    };
  });
}
