import {
  isMeshcoreRoomChatMessage,
  MESHCORE_ROOM_MESSAGE_CHANNEL,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { loadPersistedMeshcoreSelfNodeId } from './meshcoreLastSelfNodeId';
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
 * Repair inbound DMs hydrated with `to_node: 0` / missing recipient (wire decode sentinel).
 * Failure point: PacketRouter persists `to: 0` before ingest can set self node id.
 * Fallback: treat as DM to persisted self node so unread + thread filters work.
 */
export function repairMeshcoreHydratedDmToNode(
  messages: ChatMessage[],
  selfNodeId?: number,
): ChatMessage[] {
  const self =
    selfNodeId != null && selfNodeId > 0 ? selfNodeId : loadPersistedMeshcoreSelfNodeId();
  if (self <= 0) return messages;
  return messages.map((m) => {
    if (m.channel !== -1) return m;
    if (m.sender_id <= 0 || m.sender_id === self) return m;
    if (m.to != null && m.to !== 0) return m;
    return { ...m, to: self };
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
  selfNodeId?: number,
): ChatMessage[] {
  return repairMeshcoreMisfiledRoomDmMessages(
    repairMeshcoreHydrationStaleRoomSends(repairMeshcoreHydratedDmToNode(messages, selfNodeId)),
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
