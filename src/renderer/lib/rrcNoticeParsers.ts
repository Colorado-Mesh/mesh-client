/**
 * Best-effort parsers for rrcd hub NOTICE text (/list, /who, topic, moderation).
 * Formats are hub conventions, not core RRC wire types.
 */

export interface RrcListedRoom {
  name: string;
  topic?: string;
}

export interface RrcParsedWhoMember {
  identity_hash: string;
  nickname?: string | null;
}

/**
 * Ratspeak `push_notice_entries` may send `/list` as many NOTICE packets:
 * header alone, then one indented room row per packet, optionally `(+N more)`.
 */
export type RrcListNoticeParse =
  | { action: 'replace'; rooms: RrcListedRoom[] }
  | { action: 'begin' }
  | { action: 'append'; rooms: RrcListedRoom[] }
  | { action: 'end' };

const WHO_LINE = /^members in\s+(\S+)\s*:\s*(.+)$/i;
const TOPIC_LINE = /^topic for\s+(\S+)\s*(?:is now)?\s*:\s*(.+)$/i;
const JOIN_INFO_TOPIC = /^room\s+(\S+)\s*:.*\btopic=([^\n;]+)/i;
/** Ratspeak single-packet `/list` budget footer: `(+17 more)`. */
const LIST_OMITTED_MORE = /^\(\+\d+\s+more\)$/i;
const LIST_HEADER = /^registered public rooms:?$/i;

/**
 * Parse one `/list` room line after the header.
 * rrcd uses two leading spaces; Ratspeak uses one. Validate indent on the
 * original line before trim so unindented footers (e.g. "End of list.") are
 * not treated as room names.
 */
function parseListRoomLine(line: string): RrcListedRoom | null {
  if (!/^ {1,2}\S/.test(line)) return null;
  const trimmed = line.trim();
  if (!trimmed || LIST_OMITTED_MORE.test(trimmed)) return null;
  const sep = trimmed.indexOf(' - ');
  if (sep === -1) {
    const name = normalizeListedRoomName(trimmed);
    return name ? { name } : null;
  }
  const name = normalizeListedRoomName(trimmed.slice(0, sep));
  const topic = trimmed.slice(sep + 3).trim();
  if (!name) return null;
  return topic && topic !== '(none)' ? { name, topic } : { name };
}

function isOmittedMoreLine(line: string): boolean {
  return LIST_OMITTED_MORE.test(line.trim());
}

/**
 * Parse rrcd / Ratspeak `/list` NOTICE body.
 * Do not trim leading whitespace on the whole body — chunked room rows keep
 * their 1–2 space indent on a single-line NOTICE.
 */
export function parseRrcListNotice(body: string): RrcListNoticeParse | null {
  // Trim end only so a lone indented room row keeps its leading spaces.
  const text = body.replace(/\s+$/u, '');
  if (!text.trim()) return null;
  if (/^no public rooms registered$/i.test(text.trim())) {
    return { action: 'replace', rooms: [] };
  }

  const rooms: RrcListedRoom[] = [];
  const lines = text.split(/\r?\n/);
  let sawHeader = false;
  let sawOmittedFooter = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (LIST_HEADER.test(line.trim())) {
      sawHeader = true;
      continue;
    }
    if (/^no public rooms registered$/i.test(line.trim())) {
      return { action: 'replace', rooms: [] };
    }
    if (isOmittedMoreLine(line)) {
      sawOmittedFooter = true;
      continue;
    }
    // Multi-line directory: rooms only after header. Chunked rows: no header in body.
    if (sawHeader || lines.length === 1) {
      const parsed = parseListRoomLine(line);
      if (!parsed?.name) continue;
      rooms.push(parsed);
    }
  }

  if (sawHeader && rooms.length === 0 && !sawOmittedFooter) {
    // Header-only packet (Ratspeak chunk start) — open accumulation; do not wipe via replace.
    return { action: 'begin' };
  }
  if (sawHeader) {
    return { action: 'replace', rooms };
  }
  if (rooms.length > 0) {
    return { action: 'append', rooms };
  }
  if (sawOmittedFooter) {
    return { action: 'end' };
  }
  return null;
}

/** Parse rrcd `/who` NOTICE: `members in #lobby: nick (hashprefix), …`. */
export function parseRrcWhoNotice(
  body: string,
): { room: string; members: RrcParsedWhoMember[] } | null {
  const text = body.trim().replace(/\s+/g, ' ');
  const m = WHO_LINE.exec(text);
  if (!m?.[1]) return null;
  const room = normalizeListedRoomName(m[1]);
  const roster = m[2].trim();
  if (!roster || roster === '(none)') {
    return { room, members: [] };
  }
  const members: RrcParsedWhoMember[] = [];
  for (const part of roster
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const nickHash = /^(.+?)\s+\(([0-9a-f]{8,32})\)$/i.exec(part);
    if (nickHash?.[1] && nickHash[2]) {
      members.push({
        identity_hash: nickHash[2].toLowerCase(),
        nickname: nickHash[1].trim(),
      });
      continue;
    }
    if (/^[0-9a-f]{8,32}$/i.test(part)) {
      members.push({
        identity_hash: part.toLowerCase(),
        nickname: null,
      });
      continue;
    }
    members.push({
      identity_hash: `nick:${part.toLowerCase()}`,
      nickname: part,
    });
  }
  return { room, members };
}

/** Extract topic from JOIN info or `/topic` NOTICE. */
export function parseRrcTopicNotice(body: string): { room: string; topic: string } | null {
  const text = body.trim();
  const topicCmd = TOPIC_LINE.exec(text);
  if (topicCmd?.[1]) {
    const topic = topicCmd[2].trim();
    return {
      room: normalizeListedRoomName(topicCmd[1]),
      topic: topic === '(none)' || topic === '(cleared)' ? '' : topic,
    };
  }
  const joinInfo = JOIN_INFO_TOPIC.exec(text);
  if (joinInfo?.[1]) {
    const topic = joinInfo[2].trim();
    return {
      room: normalizeListedRoomName(joinInfo[1]),
      topic: topic === '(none)' ? '' : topic,
    };
  }
  return null;
}

/** True when NOTICE is rrcd join-ack (`room X: registered; mode=…; topic=…`). */
export function isRrcJoinInfoNotice(body: string): boolean {
  return JOIN_INFO_TOPIC.test(body.trim());
}

/** Heuristic: hub ERROR/NOTICE text that indicates ban / kick / key refusal. */
export function isRrcModerationLanguage(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(banned|ban|kline|kicked|kick|removed from|not allowed|forbidden|access denied|wrong (room )?key|invalid key|requires? (a )?key|invite[- ]only)\b/.test(
      t,
    ) || /\byou (have been|were) (kicked|banned|removed)\b/.test(t)
  );
}

/**
 * Match rrcd `_norm_room`: trim + lowercase only.
 * Do not invent a `#` prefix — hubs register `lobby` and `#lobby` as different rooms.
 */
export function normalizeListedRoomName(name: string): string {
  return name.trim().toLowerCase();
}
