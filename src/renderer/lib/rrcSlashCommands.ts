/**
 * IRC-style slash routing for RRC (rrc-tui / rrcd compatible).
 * Client-local commands are handled in-app; everything else is hub pass-through MSG.
 *
 * rrcd moderation commands take the room as the first argument (`/op <room> <nick>`),
 * despite README/EX1 IRC-style docs. {@link expandRrcHubSlashBody} inserts the focused
 * room when the user omits it.
 */

import { isRrcDmRoom } from './rrcDmRoom';
import { stripRrcMsgTargetAt } from './rrcMention';
import { normalizeRrcRoomName, rrcRoomsMatch, rrcWhoCommandToken } from './rrcRoomName';

export type RrcSlashResult =
  | { kind: 'local'; command: 'help' }
  | { kind: 'local'; command: 'nick'; nickname: string }
  | { kind: 'local'; command: 'join'; room: string; key?: string }
  | { kind: 'local'; command: 'part'; room?: string }
  | { kind: 'local'; command: 'me'; action: string }
  | { kind: 'local'; command: 'msg'; target: string; text: string }
  | { kind: 'local'; command: 'clear' }
  | { kind: 'local'; command: 'quit' }
  | { kind: 'local'; command: 'usage'; messageKey: string }
  | { kind: 'hub'; body: string }
  | { kind: 'chat'; body: string };

export { normalizeRrcRoomName } from './rrcRoomName';

/** rrcd room-first moderation / registry commands (room is parts[1]). */
const RRC_ROOM_FIRST_CMDS = new Set([
  'topic',
  'mode',
  'op',
  'deop',
  'voice',
  'devoice',
  'kick',
  'ban',
  'invite',
  'register',
  'unregister',
]);

/** True when the focused room can be injected into a hub slash body. */
export function isRrcSlashExpandableRoom(room: string | null | undefined): boolean {
  const t = (room ?? '').trim();
  if (!t || t.startsWith('[') || isRrcDmRoom(t)) return false;
  return rrcWhoCommandToken(t) != null;
}

function looksLikeRrcModeFlag(token: string): boolean {
  return /^[+-][mitnkprovr]$/i.test(token.trim()) || /^[+-][kv]$/i.test(token.trim());
}

function looksLikeRrcBanInviteOp(token: string): boolean {
  const t = token.trim().toLowerCase();
  return t === 'add' || t === 'del' || t === 'list';
}

/**
 * Rewrite IRC-style hub slash bodies to rrcd room-first form using the focused
 * joined wire room. No-op when room is synthetic/DM or the body already names it.
 */
export function expandRrcHubSlashBody(body: string, activeRoom: string | null | undefined): string {
  const text = body.trim();
  if (!text.startsWith('/') || !isRrcSlashExpandableRoom(activeRoom)) return text;

  const wireRoom = normalizeRrcRoomName(activeRoom!);
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return text;

  const cmdToken = (parts[0] ?? '').toLowerCase();
  if (!cmdToken.startsWith('/')) return text;
  const cmd = cmdToken.slice(1);

  if (cmd === 'who' || cmd === 'names') {
    if (parts.length === 1) return `${cmdToken} ${wireRoom}`;
    const arg = parts[1] ?? '';
    if (rrcRoomsMatch(arg, wireRoom)) return text;
    // Bare-ish: only inject when there is no room arg yet (single-token who is handled above).
    return text;
  }

  if (!RRC_ROOM_FIRST_CMDS.has(cmd)) return text;

  const firstArg = parts[1];
  if (firstArg && rrcRoomsMatch(firstArg, wireRoom)) return text;

  if (cmd === 'mode') {
    if (!firstArg || looksLikeRrcModeFlag(firstArg)) {
      return [cmdToken, wireRoom, ...parts.slice(1)].join(' ');
    }
    return text;
  }

  if (cmd === 'ban' || cmd === 'invite') {
    if (!firstArg || looksLikeRrcBanInviteOp(firstArg)) {
      return [cmdToken, wireRoom, ...parts.slice(1)].join(' ');
    }
    return text;
  }

  if (cmd === 'register' || cmd === 'unregister') {
    if (!firstArg) return `${cmdToken} ${wireRoom}`;
    return text;
  }

  // topic / op / deop / voice / devoice / kick — insert room before remaining args
  return [cmdToken, wireRoom, ...parts.slice(1)].join(' ');
}

/** Parse composer input. Empty/whitespace returns null (caller ignores). */
export function parseRrcSlashInput(raw: string): RrcSlashResult | null {
  const text = raw.trim();
  if (!text) return null;
  if (!text.startsWith('/')) {
    return { kind: 'chat', body: text };
  }

  const parts = text.split(/\s+/);
  const cmd = (parts[0] ?? '').toLowerCase();
  const arg = text.slice(parts[0].length).trim();

  if (cmd === '/help' || cmd === '/h' || cmd === '/?') {
    return { kind: 'local', command: 'help' };
  }
  if (cmd === '/nick') {
    if (!arg) return { kind: 'local', command: 'usage', messageKey: 'rrc.slash.usageNick' };
    return { kind: 'local', command: 'nick', nickname: arg };
  }
  if (cmd === '/join') {
    if (!arg) return { kind: 'local', command: 'usage', messageKey: 'rrc.slash.usageJoin' };
    const joinParts = arg.split(/\s+/);
    const room = joinParts[0] ?? '';
    const key = joinParts.length > 1 ? joinParts.slice(1).join(' ') : undefined;
    if (!room.trim()) return { kind: 'local', command: 'usage', messageKey: 'rrc.slash.usageJoin' };
    return { kind: 'local', command: 'join', room: room.trim(), key };
  }
  if (cmd === '/part' || cmd === '/leave') {
    return { kind: 'local', command: 'part', room: arg || undefined };
  }
  if (cmd === '/me') {
    if (!arg) return { kind: 'local', command: 'usage', messageKey: 'rrc.slash.usageMe' };
    return { kind: 'local', command: 'me', action: arg };
  }
  if (cmd === '/msg' || cmd === '/query' || cmd === '/whisper') {
    const msgParts = arg.split(/\s+/);
    const target = msgParts[0] ?? '';
    const msgText = arg.slice(target.length).trim();
    if (!target || !msgText) {
      return { kind: 'local', command: 'usage', messageKey: 'rrc.slash.usageMsg' };
    }
    return { kind: 'local', command: 'msg', target, text: msgText };
  }
  if (cmd === '/clear') {
    return { kind: 'local', command: 'clear' };
  }
  if (cmd === '/quit' || cmd === '/exit') {
    return { kind: 'local', command: 'quit' };
  }

  // Hub / rrcd pass-through (including /list, /who, moderation, …).
  return { kind: 'hub', body: text };
}

/**
 * Resolve `/msg` target (nick or hash/prefix) against room members.
 * Prefers exact nick (case-insensitive), then full hash, then hash prefix.
 * Leading `@` on nick targets is stripped (`@nv0n` → `nv0n`).
 */
export function resolveRrcMsgTarget(
  target: string,
  members: { identity_hash: string; nickname?: string | null }[],
): { identity_hash: string; nickname?: string | null } | null {
  const t = stripRrcMsgTargetAt(target).toLowerCase();
  if (!t) return null;
  if (/^[0-9a-f]{32}$/i.test(t)) {
    const full = members.find((m) => m.identity_hash.toLowerCase() === t);
    return full ?? { identity_hash: t, nickname: null };
  }
  const byNick = members.find((m) => (m.nickname ?? '').toLowerCase() === t);
  if (byNick && !byNick.identity_hash.startsWith('nick:')) return byNick;
  if (/^[0-9a-f]{4,31}$/i.test(t)) {
    const matches = members.filter(
      (m) => m.identity_hash.toLowerCase().startsWith(t) && !m.identity_hash.startsWith('nick:'),
    );
    if (matches.length === 1) return matches[0] ?? null;
  }
  return byNick && !byNick.identity_hash.startsWith('nick:') ? byNick : null;
}

/** Static English help lines (rendered via i18n keys in the panel). */
export const RRC_HELP_I18N_KEYS = [
  'rrc.slash.helpIntro',
  'rrc.slash.helpClient',
  'rrc.slash.helpNick',
  'rrc.slash.helpJoin',
  'rrc.slash.helpPart',
  'rrc.slash.helpMe',
  'rrc.slash.helpMsg',
  'rrc.slash.helpClear',
  'rrc.slash.helpQuit',
  'rrc.slash.helpHub',
  'rrc.slash.helpList',
  'rrc.slash.helpWho',
  'rrc.slash.helpTopic',
  'rrc.slash.helpNote',
] as const;
