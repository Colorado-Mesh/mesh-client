export class RepetitiveAiOutputError extends Error {
  constructor() {
    super('repetitiveOutput');
  }
}

const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{S}]/gu, '');

/** Detect sustained output loops, rather than normal reuse of a callsign or radio term. */
export function hasRepetitiveAiOutput(text: string): boolean {
  const sentences = new Map<string, number>();
  for (const sentence of text.slice(-8192).split(/[.!?。！？\n]+/u)) {
    const key = normalize(sentence);
    if (Array.from(key).length < 20) continue;
    const count = (sentences.get(key) ?? 0) + 1;
    if (count >= 5) return true;
    sentences.set(key, count);
  }
  const chars = Array.from(normalize(text.slice(-8192))).slice(-4096);
  for (let start = 0; start + 72 <= chars.length; start++) {
    for (let width = 1; width <= 64 && start + width * 6 <= chars.length; width++) {
      let length = width;
      while (
        start + length < chars.length &&
        chars[start + length] === chars[start + (length % width)]
      ) {
        length++;
        if (length >= 72 && length >= width * 6) return true;
      }
    }
  }
  return false;
}

/**
 * Strip thinking-control echoes that must never appear as user-visible answers.
 * Pass `{ trim: false }` while streaming so leading/trailing whitespace between
 * chunks is preserved; final callers keep the default trim.
 */
export function sanitizeAiModelOutput(text: string, options?: { trim?: boolean }): string {
  const cleaned = text
    .replace(/\/no_think\b/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return options?.trim === false ? cleaned : cleaned.trim();
}

const SECTION_HEADING = /^(conversations|one-offs)\s*:?\s*$/i;
const BULLET_PREFIX = /^(?:[*•-]|\d+[.)])\s+/;

/** Strip a leading markdown/plain bullet marker from a summary line. */
function stripBulletPrefix(line: string): string {
  return line.replace(BULLET_PREFIX, '').trim();
}

/** Normalize a bullet for near-duplicate comparison. */
export function normalizeAiSummaryBullet(text: string): string {
  let body = stripBulletPrefix(text).normalize('NFKC').toLowerCase();
  // Drop a leading "Name: Name …" restatement ("KE4IQR-1: KE4IQR-1 sent…").
  body = body.replace(/^([\p{L}\p{N}][\p{L}\p{N}\s._-]{0,40}?):\s*\1\b/u, '$1:');
  // Drop a single leading "Name: " label so "X: sent a greeting" ≈ "X sent a greeting".
  body = body.replace(/^([\p{L}\p{N}][\p{L}\p{N}\s._-]{0,40}?):\s+/u, '$1 ');
  return body
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** True when two normalized bullets are the same fact or one restates the other. */
function isNearDuplicateBullet(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) {
    const shorter = Math.min(a.length, b.length);
    const longer = Math.max(a.length, b.length);
    return shorter >= 24 && shorter / longer >= 0.72;
  }
  return false;
}

/**
 * Split a structured Catch-up into prefix / Conversations / One-offs line arrays,
 * preserving original line text (including indentation and blanks).
 */
function parseStructuredSections(text: string): {
  prefix: string[];
  conversations: string[];
  oneOffs: string[];
  conversationsHeading: string | null;
  oneOffsHeading: string | null;
  conversationsHeadingRaw: string | null;
  oneOffsHeadingRaw: string | null;
} | null {
  const lines = text.split('\n');
  let mode: 'prefix' | 'conversations' | 'oneOffs' = 'prefix';
  const prefix: string[] = [];
  const conversations: string[] = [];
  const oneOffs: string[] = [];
  let conversationsHeading: string | null = null;
  let oneOffsHeading: string | null = null;
  let conversationsHeadingRaw: string | null = null;
  let oneOffsHeadingRaw: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (SECTION_HEADING.test(trimmed)) {
      if (/^conversations/i.test(trimmed)) {
        mode = 'conversations';
        conversationsHeading = trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
        conversationsHeadingRaw = line;
        continue;
      }
      mode = 'oneOffs';
      oneOffsHeading = trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
      oneOffsHeadingRaw = line;
      continue;
    }
    if (mode === 'prefix') prefix.push(line);
    else if (mode === 'conversations') conversations.push(line);
    else oneOffs.push(line);
  }
  if (!conversationsHeading && !oneOffsHeading) return null;
  return {
    prefix,
    conversations,
    oneOffs,
    conversationsHeading,
    oneOffsHeading,
    conversationsHeadingRaw,
    oneOffsHeadingRaw,
  };
}

/**
 * Drop near-duplicate One-offs (and One-offs already covered by Conversations).
 * Preserves original Conversations lines and blank-line structure. Returns the
 * original text unchanged when no One-off bullet was removed.
 */
export function dedupeAiSummaryOneOffs(text: string): string {
  const parsed = parseStructuredSections(text);
  if (!parsed?.oneOffsHeading) return text;

  const conversationKeys = parsed.conversations
    .map((line) => normalizeAiSummaryBullet(line))
    .filter(Boolean);

  const kept: string[] = [];
  const keptKeys: string[] = [];
  let removed = false;
  for (const line of parsed.oneOffs) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push(line);
      continue;
    }
    if (!BULLET_PREFIX.test(trimmed) && !trimmed.startsWith('-')) {
      kept.push(line);
      continue;
    }
    const key = normalizeAiSummaryBullet(trimmed);
    if (!key) {
      kept.push(line);
      continue;
    }
    const coveredByConversation = conversationKeys.some((other) =>
      isNearDuplicateBullet(key, other),
    );
    if (coveredByConversation) {
      removed = true;
      continue;
    }
    const coveredByKept = keptKeys.some((other) => isNearDuplicateBullet(key, other));
    if (coveredByKept) {
      removed = true;
      continue;
    }
    kept.push(line);
    keptKeys.push(key);
  }

  if (!removed) return text;

  // Drop trailing blank lines from One-offs after removals, keep interior blanks.
  while (kept.length > 0 && !kept.at(-1)?.trim()) kept.pop();

  const out: string[] = [];
  if (parsed.prefix.length) out.push(...parsed.prefix);
  if (parsed.conversationsHeadingRaw) {
    if (out.length && out.at(-1)?.trim()) out.push('');
    out.push(parsed.conversationsHeadingRaw);
    out.push(...parsed.conversations);
  }
  if (parsed.oneOffsHeadingRaw) {
    if (out.length && out.at(-1)?.trim()) out.push('');
    out.push(parsed.oneOffsHeadingRaw);
    out.push(...kept);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Sanitize model control tokens then dedupe structured One-offs. */
export function finalizeAiSummaryText(text: string): string {
  return dedupeAiSummaryOneOffs(sanitizeAiModelOutput(text));
}
