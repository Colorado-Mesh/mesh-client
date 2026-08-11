import { RRC_HUB_STREAM_ROOM, rrcRoomMatchKey } from '@/renderer/lib/rrcRoomName';
import type { RrcChatMessage } from '@/shared/rrc-types';

/**
 * Empty notice/system/error rows render as a lone IRC `*` — hide them.
 * MSG/ACTION with empty body are still shown (rare).
 */
export function shouldDisplayRrcChatMessage(msg: Pick<RrcChatMessage, 'body' | 'kind'>): boolean {
  if (msg.kind === 'notice' || msg.kind === 'system' || msg.kind === 'error') {
    return msg.body.trim().length > 0;
  }
  return true;
}

/** True when an inbound RRC chat row should be dropped at ingest. */
export function shouldDropEmptyRrcInbound(kind: string, body: string): boolean {
  if (kind === 'notice' || kind === 'system' || kind === 'error') {
    return body.trim().length === 0;
  }
  return false;
}

/**
 * Room for a non-DM inbound envelope. Empty K_ROOM (hub-global /list, /who, greeting)
 * goes to `[hub]` — never the focused chat room.
 */
export function resolveRrcInboundChatRoom(wireRoom: string | null | undefined): string {
  const room = wireRoom?.trim() ?? '';
  return room || RRC_HUB_STREAM_ROOM;
}

/**
 * First `/who` NOTICE per room join may appear in chat; later snapshots update the
 * nicklist only. `shownMatchKeys` holds `rrcRoomMatchKey` values already shown.
 * Ingest must call `consumeWhoTranscriptSlot`, not this predicate alone.
 */
export function shouldShowRrcWhoTranscript(
  shownMatchKeys: ReadonlySet<string>,
  room: string,
): boolean {
  const key = rrcRoomMatchKey(room);
  if (!key || key.startsWith('[') || key.startsWith('@')) return false;
  return !shownMatchKeys.has(key);
}

/**
 * Parse legacy local whisper-sent echo body (`→ name: text`).
 * New outbound whispers are stored as room-style `msg` rows.
 */
export function parseRrcWhisperEcho(body: string): { name: string; text: string } | null {
  const m = /^→\s+(.+?):\s([\s\S]*)$/.exec(body);
  if (!m) return null;
  const name = m[1].trim();
  if (!name) return null;
  return { name, text: m[2] };
}
