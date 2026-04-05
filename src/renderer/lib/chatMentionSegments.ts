/**
 * Meshtastic / MeshCore channel text uses `@[Display Name]` for replies, tapbacks,
 * path summaries, and inline references. This module splits payloads for display only.
 */

export type ChatMentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; label: string };

const BRACKET_MENTION = /@\[([^\]]*)\]/gu;

/**
 * Split `input` into plain text runs and `mention` runs (brackets stripped for display).
 * Unclosed `@[` is left as plain text.
 */
export function parseChatMentionSegments(input: string): ChatMentionSegment[] {
  const s = input ?? '';
  if (!s) return [];

  const out: ChatMentionSegment[] = [];
  let last = 0;
  BRACKET_MENTION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BRACKET_MENTION.exec(s)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'text', text: s.slice(last, m.index) });
    }
    out.push({ kind: 'mention', label: (m[1] ?? '').trim() });
    last = m.index + m[0].length;
  }
  if (last < s.length) {
    out.push({ kind: 'text', text: s.slice(last) });
  }
  return out;
}
