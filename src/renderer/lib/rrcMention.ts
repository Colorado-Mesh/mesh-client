/**
 * IRC-style @nick mention detection for RRC (client convention; not on the wire).
 */

import type { ChatNotificationType } from '@/renderer/lib/chatNotifications';
import { isRrcDmRoom, isRrcLegacyWhispersRoom } from '@/renderer/lib/rrcDmRoom';
import { rrcRoomsMatch } from '@/renderer/lib/rrcRoomName';
import type { RrcChatMessage } from '@/shared/rrc-types';

/** Strip a leading `@` from `/msg` targets so `@nv0n` resolves like `nv0n`. */
export function stripRrcMsgTargetAt(target: string): string {
  const t = target.trim();
  if (t.startsWith('@') && t.length > 1) return t.slice(1).trim();
  return t;
}

function isRrcMentionBoundaryBefore(body: string, atIndex: number): boolean {
  if (atIndex <= 0) return true;
  const ch = body[atIndex - 1];
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function isRrcMentionBoundaryAfter(body: string, endIndex: number): boolean {
  if (endIndex >= body.length) return true;
  const ch = body[endIndex];
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\n' ||
    ch === '\r' ||
    ch === ',' ||
    ch === '.' ||
    ch === '!' ||
    ch === '?' ||
    ch === ';' ||
    ch === ':' ||
    ch === ')'
  );
}

/**
 * Find next IRC-style `@nick` occurrence matching `nickname` (case-insensitive).
 * Returns [start, end) into `body`, or null.
 */
export function findNextRrcNickMention(
  body: string,
  nickname: string,
  fromIndex = 0,
): { start: number; end: number } | null {
  const nick = nickname.trim();
  if (!nick || !body) return null;
  const lowerBody = body.toLowerCase();
  const needle = `@${nick.toLowerCase()}`;
  let idx = Math.max(0, fromIndex);
  while (idx < lowerBody.length) {
    const found = lowerBody.indexOf(needle, idx);
    if (found === -1) return null;
    const end = found + needle.length;
    if (isRrcMentionBoundaryBefore(body, found) && isRrcMentionBoundaryAfter(body, end)) {
      return { start: found, end };
    }
    idx = found + 1;
  }
  return null;
}

/**
 * True when `body` contains an IRC-style `@nick` matching `nickname`
 * (case-insensitive; nick ends at whitespace or common punctuation).
 */
export function bodyMentionsRrcNick(body: string, nickname: string): boolean {
  return findNextRrcNickMention(body, nickname) != null;
}

/** True for per-peer `@hash` DMs or the legacy `[whispers]` inbox. */
export function isRrcWhisperRoom(room: string | null | undefined): boolean {
  return isRrcDmRoom(room) || isRrcLegacyWhispersRoom(room);
}

export function isRrcDirectMessage(msg: Pick<RrcChatMessage, 'room' | 'dst_hash'>): boolean {
  if (msg.dst_hash?.trim()) return true;
  return isRrcWhisperRoom(msg.room);
}

/**
 * Classify RRC inbound traffic for audible notification.
 * Returns null when the message should not notify (caller still decides mute/self).
 */
export function classifyRrcNotificationType(
  msg: Pick<RrcChatMessage, 'body' | 'room' | 'dst_hash' | 'kind'>,
  nickname: string,
): ChatNotificationType | null {
  if (msg.kind === 'system' || msg.kind === 'error') return null;
  if (isRrcDirectMessage(msg)) return 'dm';
  if (bodyMentionsRrcNick(msg.body, nickname)) return 'dm';
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (msg.kind === 'msg' || msg.kind === 'action' || msg.kind === 'notice') return 'channel';
  return null;
}

/** Global (or effective per-room) RRC notify level: all chat lines vs IRC-style mention/DM. */
export type RrcNotifyMode = 'all' | 'mentions';

export interface ResolveRrcAlertTypeArgs {
  msg: Pick<RrcChatMessage, 'body' | 'room' | 'dst_hash' | 'kind'>;
  nickname: string;
  notifyMode: RrcNotifyMode;
  muted: boolean;
}

/**
 * Shared badge + sound gate. Mute and IRC-style mention mode drop channel traffic;
 * hub notices never alert. DMs / @nick stay `dm` in both modes.
 */
export function resolveRrcAlertType(args: ResolveRrcAlertTypeArgs): ChatNotificationType | null {
  if (args.muted) return null;
  const type = classifyRrcNotificationType(args.msg, args.nickname);
  if (!type) return null;
  if (type === 'dm') return 'dm';
  if (args.msg.kind !== 'msg' && args.msg.kind !== 'action') return null;
  return args.notifyMode === 'all' ? 'channel' : null;
}

/** Mute storage key used by RrcPanel (`rrc:${hubHash}:${room}`). */
export function rrcMuteViewKey(hubHash: string, room: string): string {
  return `rrc:${hubHash.trim().toLowerCase()}:${room.trim()}`;
}

/** True when reticulum mutedViews contains an RRC mute for this hub+room (soft room match). */
export function isRrcRoomMuted(
  hubHash: string,
  room: string,
  mutedViews: ReadonlySet<string>,
): boolean {
  const hub = hubHash.trim().toLowerCase();
  const prefix = `rrc:${hub}:`;
  for (const key of mutedViews) {
    if (!key.toLowerCase().startsWith(prefix)) continue;
    const mutedRoom = key.slice(prefix.length);
    if (rrcRoomsMatch(mutedRoom, room)) return true;
  }
  return false;
}
