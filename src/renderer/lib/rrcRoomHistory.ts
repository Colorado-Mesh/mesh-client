import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { rrcRoomMatchKey } from '@/renderer/lib/rrcRoomName';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import type { RrcChatMessage, RrcChatMessageKind } from '@/shared/rrc-types';

const ALLOWED_KINDS = new Set<RrcChatMessageKind>(['msg', 'notice', 'action', 'error', 'system']);

/** Keys already loaded from SQLite this session (`${hub}::${room}`). */
const hydratedRoomKeys = new Set<string>();

export function resetRrcRoomHistoryForTests(): void {
  hydratedRoomKeys.clear();
}

function isRrcKind(value: string): value is RrcChatMessageKind {
  return ALLOWED_KINDS.has(value as RrcChatMessageKind);
}

function storageRoomKey(room: string): string {
  return rrcRoomMatchKey(room) || room.trim().toLowerCase();
}

/**
 * Load SQLite history for a hub+room and merge into the session store (dedup by id).
 * Skips repeat loads for the same key this session unless `force`.
 */
export async function hydrateRrcRoomMessages(
  hubHash: string,
  room: string,
  opts?: { force?: boolean },
): Promise<void> {
  const hub = hubHash.trim().toLowerCase();
  const roomKey = storageRoomKey(room);
  if (!hub || !roomKey) return;
  const key = `${hub}::${roomKey}`;
  if (!opts?.force && hydratedRoomKeys.has(key)) return;
  try {
    const rows = await window.electronAPI.db.listRrcMessages(hub, roomKey, 500);
    hydratedRoomKeys.add(key);
    const mapped: RrcChatMessage[] = [];
    for (const row of rows) {
      if (typeof row.message_id !== 'string' || typeof row.body !== 'string') continue;
      if (!isRrcKind(row.kind)) continue;
      mapped.push({
        id: row.message_id,
        room: roomKey,
        kind: row.kind,
        body: row.body,
        sender_hash: row.sender_hash ?? null,
        nickname: row.nickname ?? null,
        timestamp: Number.isFinite(row.timestamp) ? row.timestamp : 0,
      });
    }
    if (mapped.length > 0) {
      useRrcSessionStore.getState().mergeHistoryMessages(hub, roomKey, mapped);
    }
  } catch (e) {
    console.warn('[rrcRoomHistory] hydrate failed ' + errLikeToLogString(e));
  }
}

/**
 * Destructive clear: SQLite + in-memory for one hub room.
 * Failure point: IPC delete fails — still clears memory so UI matches user intent.
 */
export async function clearRrcRoomHistory(hubHash: string, room: string): Promise<void> {
  const hub = hubHash.trim().toLowerCase();
  const roomKey = storageRoomKey(room);
  if (!hub || !roomKey) return;
  const key = `${hub}::${roomKey}`;
  try {
    await window.electronAPI.db.deleteRrcMessagesByRoom(hub, roomKey);
  } catch (e) {
    console.warn('[rrcRoomHistory] deleteByRoom failed ' + errLikeToLogString(e));
  }
  hydratedRoomKeys.delete(key);
  useRrcSessionStore.getState().clearRoomMessages(hub, roomKey);
}
