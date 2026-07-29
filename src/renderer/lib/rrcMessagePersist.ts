import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { rrcRoomMatchKey } from '@/renderer/lib/rrcRoomName';
import type { RrcChatMessage, RrcChatMessageKind } from '@/shared/rrc-types';

const ALLOWED_KINDS = new Set<RrcChatMessageKind>(['msg', 'notice', 'action', 'error', 'system']);

function isRrcKind(value: string): value is RrcChatMessageKind {
  return ALLOWED_KINDS.has(value as RrcChatMessageKind);
}

function storageRoomKey(room: string): string {
  return rrcRoomMatchKey(room) || room.trim().toLowerCase();
}

/**
 * Fire-and-forget persist of one live RRC message.
 * Failure point: IPC/DB unavailable — log and keep in-memory copy.
 */
export function persistRrcMessage(hubHash: string, msg: RrcChatMessage): void {
  const hub = hubHash.trim().toLowerCase();
  const room = storageRoomKey(msg.room ?? '');
  if (!hub || !room || !msg.id?.trim() || !msg.body) return;
  if (!isRrcKind(msg.kind)) return;
  void window.electronAPI.db
    .insertRrcMessage({
      message_id: msg.id,
      hub_hash: hub,
      room,
      sender_hash: msg.sender_hash ?? null,
      nickname: msg.nickname ?? null,
      kind: msg.kind,
      body: msg.body,
      timestamp: msg.timestamp,
    })
    .catch((e: unknown) => {
      console.warn('[rrcMessagePersist] insert failed ' + errLikeToLogString(e));
    });
}
