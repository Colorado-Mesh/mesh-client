/**
 * Meshtastic / MeshCore channel text uses `@[Display Name]` for replies, tapbacks,
 * path summaries, and inline references. This module splits payloads for display only.
 */

export type ChatMentionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; label: string }
  | { kind: 'url'; url: string };

const BRACKET_MENTION = /@\[([^\]]*)\]/gu;
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gu;
const TRAILING_PUNCT = /[.,!?;:'"()]+$/;

function splitByUrls(text: string): ChatMentionSegment[] {
  const out: ChatMentionSegment[] = [];
  let last = 0;
  URL_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_PATTERN.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'text', text: text.slice(last, m.index) });
    }
    const raw = m[0];
    const url = raw.replace(TRAILING_PUNCT, '');
    out.push({ kind: 'url', url });
    if (raw.length > url.length) {
      out.push({ kind: 'text', text: raw.slice(url.length) });
    }
    last = m.index + raw.length;
  }
  if (last < text.length) {
    out.push({ kind: 'text', text: text.slice(last) });
  }
  return out;
}

/**
 * Split `input` into plain text runs, `mention` runs (brackets stripped for display),
 * and `url` runs (http/https links). Unclosed `@[` is left as plain text.
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
      out.push(...splitByUrls(s.slice(last, m.index)));
    }
    out.push({ kind: 'mention', label: (m[1] ?? '').trim() });
    last = m.index + m[0].length;
  }
  if (last < s.length) {
    out.push(...splitByUrls(s.slice(last)));
  }
  return out;
}

/** Defense-in-depth: only http(s) URLs are safe for chat link hrefs. */
export function isSafeChatUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    // catch-no-log-ok URL parse failure — treat as unsafe link
    return false;
  }
}
