import { rrcRoomMatchKey } from '@/renderer/lib/rrcRoomName';
import type { RrcChatMessageKind } from '@/shared/rrc-types';

export const ALLOWED_KINDS = new Set<RrcChatMessageKind>([
  'msg',
  'notice',
  'action',
  'error',
  'system',
]);

export function isRrcKind(value: string): value is RrcChatMessageKind {
  return ALLOWED_KINDS.has(value as RrcChatMessageKind);
}

/** Normalize room name for SQLite / session storage keys. */
export function storageRoomKey(room: string): string {
  return rrcRoomMatchKey(room) || room.trim().toLowerCase();
}

/** Normalize a hub dest hash for storage lookups. */
export function normalizeRrcHubHash(hubHash: string): string {
  return hubHash.trim().toLowerCase();
}
