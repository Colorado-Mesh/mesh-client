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

const WHO_LINE = /^members in\s+(\S+)\s*:\s*(.+)$/i;
const TOPIC_LINE = /^topic for\s+(\S+)\s*(?:is now)?\s*:\s*(.+)$/i;
const JOIN_INFO_TOPIC = /^room\s+(\S+)\s*:.*\btopic=([^\n;]+)/i;

/** Parse one rrcd `/list` indented line: `  room` or `  room - topic`. */
function parseListRoomLine(line: string): RrcListedRoom | null {
  if (!line.startsWith('  ') || line[2] === ' ' || line[2] === undefined) return null;
  const trimmed = line.trim();
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

/** Parse rrcd `/list` NOTICE body into room rows. */
export function parseRrcListNotice(body: string): RrcListedRoom[] | null {
  const text = body.trim();
  if (!text) return null;
  if (/^no public rooms registered$/i.test(text)) return [];

  const rooms: RrcListedRoom[] = [];
  const lines = text.split(/\r?\n/);
  let sawHeader = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^registered public rooms:?$/i.test(line.trim())) {
      sawHeader = true;
      continue;
    }
    if (/^no public rooms registered$/i.test(line.trim())) {
      return [];
    }
    const parsed = parseListRoomLine(line);
    if (!parsed?.name) continue;
    rooms.push(parsed);
  }

  if (rooms.length === 0) {
    return sawHeader ? [] : null;
  }
  if (!sawHeader) return null;
  return rooms;
}

/** Parse rrcd `/who` NOTICE: `members in #lobby: nick (hashprefix), …`. */
export function parseRrcWhoNotice(
  body: string,
): { room: string; members: RrcParsedWhoMember[] } | null {
  const text = body.trim().replace(/\s+/g, ' ');
  const m = WHO_LINE.exec(text);
  if (!m?.[1]) return null;
  const room = normalizeListedRoomName(m[1]);
  const roster = (m[2] ?? '').trim();
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
    const topic = (topicCmd[2] ?? '').trim();
    return {
      room: normalizeListedRoomName(topicCmd[1]),
      topic: topic === '(none)' || topic === '(cleared)' ? '' : topic,
    };
  }
  const joinInfo = JOIN_INFO_TOPIC.exec(text);
  if (joinInfo?.[1]) {
    const topic = (joinInfo[2] ?? '').trim();
    return {
      room: normalizeListedRoomName(joinInfo[1]),
      topic: topic === '(none)' ? '' : topic,
    };
  }
  return null;
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

export function normalizeListedRoomName(name: string): string {
  const cleaned = name.trim().toLowerCase();
  if (!cleaned) return cleaned;
  if (cleaned.startsWith('#') || cleaned.startsWith('@')) return cleaned;
  return `#${cleaned}`;
}
