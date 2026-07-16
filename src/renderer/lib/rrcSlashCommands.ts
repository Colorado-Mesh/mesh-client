/**
 * IRC-style slash routing for RRC (rrc-tui / rrcd compatible).
 * Client-local commands are handled in-app; everything else is hub pass-through MSG.
 */

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

export function normalizeRrcRoomName(room: string): string {
  return room.trim().toLowerCase();
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
 */
export function resolveRrcMsgTarget(
  target: string,
  members: { identity_hash: string; nickname?: string | null }[],
): { identity_hash: string; nickname?: string | null } | null {
  const t = target.trim().toLowerCase();
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
