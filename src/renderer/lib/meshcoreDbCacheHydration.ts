import { isMeshcoreRoomChatMessage } from '../hooks/meshcore/meshcoreHookPreamble';
import type { ChatMessage } from './types';

/** Room posts older than this are not still in-flight on the radio. */
const MESHCORE_ROOM_STALE_SENDING_MS = 30_000;

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
