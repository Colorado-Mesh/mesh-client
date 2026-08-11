/**
 * RRC room name helpers.
 *
 * rrcd treats `lobby` and `#lobby` as distinct wire names, but users (and older
 * mesh-client prefs) treat the leading `#` as optional IRC chrome. Soft match
 * keys collapse those spellings for favourites, sidebar dedupe, and join resolve.
 */

/** Synthetic room key for hub-scoped NOTICE/ERROR with no K_ROOM. */
export const RRC_HUB_STREAM_ROOM = '[hub]';

/** Trim + lowercase only (preserves leading `#` / `@`). */
export function normalizeRrcRoomName(room: string): string {
  return room.trim().toLowerCase();
}

/**
 * Soft identity for prefs/sidebar: `#General` and `general` share a match key.
 * Synthetic rooms (`[hub]`, `[whispers]`) and `@` targets are unchanged.
 */
export function rrcRoomMatchKey(room: string): string {
  const t = room.trim().toLowerCase();
  if (!t) return t;
  if (t.startsWith('[') || t.startsWith('@')) return t;
  return t.replace(/^#+/, '');
}

export function rrcRoomsMatch(a: string, b: string): boolean {
  return rrcRoomMatchKey(a) === rrcRoomMatchKey(b);
}

/** Safe `/who` body token — rejects whitespace or extra slash (command injection). */
export function rrcWhoCommandToken(room: string): string | null {
  const token = rrcRoomMatchKey(room);
  if (!token || token.startsWith('[') || token.startsWith('@') || /[\s/]/.test(token)) {
    return null;
  }
  return token;
}

/** Apply a parsed `/who` NOTICE only to a room this hub has joined. */
export function rrcWhoNoticeJoinedRoom(
  parsedRoom: string,
  joinedRoomNames: Iterable<string>,
): string | null {
  if (!rrcWhoCommandToken(parsedRoom)) return null;
  for (const name of joinedRoomNames) {
    if (rrcRoomsMatch(name, parsedRoom)) return name;
  }
  return null;
}

/**
 * Joined room whose next `/who` NOTICE should appear in chat.
 * Uses the `/who` argument when present; otherwise the focused non-DM room.
 */
export function resolveRrcWhoTranscriptForceRoom(
  body: string,
  activeRoom: string | null | undefined,
  joinedRoomNames: Iterable<string>,
): string | null {
  if (!/^\s*\/who(?:\s|$)/i.test(body)) return null;
  const arg = body.replace(/^\s*\/who(?:\s+|$)/i, '').trim();
  const candidate = arg || activeRoom || '';
  const token = rrcWhoCommandToken(candidate);
  if (!token) return null;
  return rrcWhoNoticeJoinedRoom(token, joinedRoomNames);
}

/**
 * Prefer an already-joined or hub-listed spelling; otherwise bare name (no `#`)
 * so JOIN hits typical `rooms.toml` registry keys like `lobby`.
 */
export function resolveRrcJoinRoomName(
  room: string,
  opts?: { listed?: { name: string }[]; joined?: { name: string }[] },
): string {
  const match = rrcRoomMatchKey(room);
  if (!match) return '';
  if (match.startsWith('[') || match.startsWith('@')) {
    return normalizeRrcRoomName(room);
  }
  for (const r of opts?.joined ?? []) {
    if (rrcRoomsMatch(r.name, room)) return r.name.trim();
  }
  for (const r of opts?.listed ?? []) {
    if (rrcRoomsMatch(r.name, room)) return r.name.trim();
  }
  return match;
}
