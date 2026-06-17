import {
  MESHCORE_ROOM_MESSAGE_CHANNEL,
  MESHCORE_ROOM_STALE_SENDING_MS,
} from '@/shared/meshcoreContactHwLabels';

import {
  findMeshcoreDmRfDuplicate,
  isMeshcoreRoomChatMessage,
} from '../hooks/meshcore/meshcoreHookPreamble';
import { loadPersistedMeshcoreSelfNodeId } from './meshcoreLastSelfNodeId';
import {
  isMeshcoreRoomServerContactType,
  meshcoreRoomPostBodyFromWire,
} from './meshcoreRoomMessageRouting';
import { sanitizeMeshcoreChatWireText } from './meshcoreUtils';
import type { ChatMessage, MeshNode } from './types';

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
 * Strip SignedPlain author prefixes from room posts already stored with garbled payloads.
 * Failure point: older builds only stripped when txtType === 2.
 * Fallback: re-run prefix heuristic on hydration so reload fixes historical rows.
 */
export function repairMeshcoreRoomStoredPostPayloads(
  messages: ChatMessage[],
  pubKeyPrefixToNodeId: Map<string, number> = new Map<string, number>(),
): ChatMessage[] {
  return messages.map((m) => {
    if (!isMeshcoreRoomChatMessage(m)) return m;
    const { authorId, payload } = meshcoreRoomPostBodyFromWire(
      m.payload,
      undefined,
      pubKeyPrefixToNodeId,
      { isKnownRoomNode: true },
    );
    if (payload === m.payload && (authorId === 0 || authorId === m.sender_id)) return m;
    return {
      ...m,
      payload,
      ...(authorId !== 0 && authorId !== m.sender_id ? { sender_id: authorId } : {}),
    };
  });
}

/**
 * Strip firmware tail padding from channel/DM rows already stored in SQLite.
 * Failure point: older builds persisted wire text including bytes after NUL.
 * Fallback: re-run sanitizer on hydration so reload fixes historical rows.
 */
export function repairMeshcoreChatWireTailGarbage(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (isMeshcoreRoomChatMessage(m)) return m;
    if (m.channel !== -1 && m.channel < 0) return m;
    const payload = sanitizeMeshcoreChatWireText(m.payload);
    if (payload === m.payload) return m;
    return { ...m, payload };
  });
}

/** Collapse RF DM echoes loaded from SQLite (same sender/body/recipient within dedup window). */
export function repairMeshcoreHydratedDmRfDuplicates(messages: ChatMessage[]): ChatMessage[] {
  const kept: ChatMessage[] = [];
  for (const msg of messages) {
    if (findMeshcoreDmRfDuplicate(kept, msg)) continue;
    kept.push(msg);
  }
  return kept;
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
  pubKeyPrefixToNodeId?: Map<string, number>,
): ChatMessage[] {
  return repairMeshcoreChatWireTailGarbage(
    repairMeshcoreRoomStoredPostPayloads(
      repairMeshcoreMisfiledRoomDmMessages(
        repairMeshcoreHydratedDmRfDuplicates(
          repairMeshcoreHydrationStaleRoomSends(
            repairMeshcoreHydratedDmToNode(messages, selfNodeId),
          ),
        ),
        roomServerIds,
      ),
      pubKeyPrefixToNodeId,
    ),
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
    const { payload } = meshcoreRoomPostBodyFromWire(m.payload, undefined, new Map(), {
      isKnownRoomNode: true,
    });
    return {
      ...m,
      payload,
      channel: MESHCORE_ROOM_MESSAGE_CHANNEL,
      roomServerId: peer,
      to: peer,
    };
  });
}
