import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  isRrcKind,
  normalizeRrcHubHash,
  storageRoomKey,
} from '@/renderer/lib/rrcMessageStorageCommon';
import type { RrcChatMessage } from '@/shared/rrc-types';

/**
 * Fire-and-forget persist of one live RRC message.
 * Failure point: IPC/DB unavailable — log and keep in-memory copy.
 */
export function persistRrcMessage(hubHash: string, msg: RrcChatMessage): void {
  const hub = normalizeRrcHubHash(hubHash);
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
