import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isRrcKind,
  normalizeRrcHubHash,
  storageRoomKey,
} from '@/renderer/lib/rrcMessageStorageCommon';
import { RRC_ROOM_HISTORY_LOAD_COUNT } from '@/renderer/lib/sessionMemoryCaps';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import type { RrcChatMessage } from '@/shared/rrc-types';

/** Keys already loaded from SQLite this session (`${hub}::${room}`). */
const hydratedRoomKeys = new Set<string>();

export function resetRrcRoomHistoryForTests(): void {
  hydratedRoomKeys.clear();
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
  const hub = normalizeRrcHubHash(hubHash);
  const roomKey = storageRoomKey(room);
  if (!hub || !roomKey) return;
  const key = `${hub}::${roomKey}`;
  if (!opts?.force && hydratedRoomKeys.has(key)) return;
  try {
    const rows = await window.electronAPI.db.listRrcMessages(
      hub,
      roomKey,
      RRC_ROOM_HISTORY_LOAD_COUNT,
    );
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
  const hub = normalizeRrcHubHash(hubHash);
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
