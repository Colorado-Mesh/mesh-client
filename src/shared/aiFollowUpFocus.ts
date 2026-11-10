import type { AiSummaryMessage } from './ai-types';

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'what',
  'when',
  'where',
  'who',
  'why',
  'how',
  'did',
  'does',
  'was',
  'were',
  'are',
  'is',
  'it',
  'they',
  'them',
  'about',
  'give',
  'more',
  'information',
  'please',
  'tell',
  'say',
  'said',
  'any',
  'anyone',
  'some',
  'can',
  'could',
  'would',
  'expand',
  'everything',
  'conversation',
  'conversations',
]);

/** Minimum normalized length for treating a summary slice as quoted in the question. */
const FOCUS_SUBSTRING_MIN = 24;

/** Minimum overlapping content tokens to treat a message as on-focus. */
export const FOLLOW_UP_FOCUS_HIT_MIN = 2;

/** Strip hyphens so "2-byte" matches token "2byte". */
export function followUpMatchHaystack(value: string): string {
  return value.toLowerCase().replace(/[\u2010-\u2015-]+/g, '');
}

/**
 * Content tokens for follow-up relevance.
 * Keeps length≥3 parts, plus joined hyphen compounds (`2-byte` → `2byte`) so short
 * numeric prefixes are not dropped while standalone `2` never floods includes().
 */
export function followUpContentTokens(value: string): string[] {
  const lower = value.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (token: string) => {
    if (!token || token.length < 3 || STOPWORDS.has(token) || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  };
  for (const token of lower.split(/[^\p{L}\p{N}]+/u)) add(token);
  // Hyphen compounds: keep joined form (and length≥3 parts already covered by split).
  for (const match of lower.matchAll(/(\p{N}+)[-\u2010-\u2015](\p{L}{2,})/gu)) {
    add(`${match[1]}${match[2]}`);
  }
  for (const match of lower.matchAll(/(\p{L}{2,})[-\u2010-\u2015](\p{N}+)/gu)) {
    add(`${match[1]}${match[2]}`);
  }
  return out;
}

function normalizeWs(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^[*•-]\s+/, '').trim();
}

function bulletLines(summary: string): string[] {
  return summary
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Count question tokens that appear in a summary bullet (hyphen-normalized). */
function overlapCount(questionTokens: Set<string>, line: string): number {
  const hay = followUpMatchHaystack(stripBulletPrefix(line));
  let hits = 0;
  for (const token of questionTokens) {
    if (hay.includes(token)) hits += 1;
  }
  return hits;
}

/** True when a token is distinctive enough to focus from a single hit. */
function isDistinctiveFocusToken(token: string): boolean {
  return token.length >= 5 || /^\p{N}/u.test(token);
}

/**
 * When the user quotes or points at one Catch-up bullet, return that slice so
 * follow-up selection can ignore the rest of the summary.
 */
export function extractQuotedSummaryFocus(question: string, summary: string): string | null {
  const questionNorm = normalizeWs(question);
  const summaryNorm = normalizeWs(summary);
  if (!questionNorm || !summaryNorm) return null;

  const lines = bulletLines(summary);

  let bestSubstring: string | null = null;
  let bestSubstringLen = 0;
  for (const line of lines) {
    const stripped = stripBulletPrefix(line);
    for (const candidate of [line, stripped]) {
      const normalized = normalizeWs(candidate);
      if (normalized.length < FOCUS_SUBSTRING_MIN) continue;
      if (!questionNorm.includes(normalized)) continue;
      if (normalized.length > bestSubstringLen) {
        bestSubstring = stripped || candidate;
        bestSubstringLen = normalized.length;
      }
    }
  }
  if (bestSubstring) return bestSubstring;

  const questionTokens = new Set(followUpContentTokens(question));
  if (!questionTokens.size) return null;

  let bestLine: string | null = null;
  let bestOverlap = 0;
  for (const line of lines) {
    const stripped = stripBulletPrefix(line);
    if (!stripped) continue;
    const looksLikeBullet = /^[*•-]\s+/.test(line) || stripped.length <= 280;
    if (!looksLikeBullet) continue;
    const overlap = overlapCount(questionTokens, line);
    if (overlap >= FOLLOW_UP_FOCUS_HIT_MIN && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestLine = stripped;
    }
  }
  if (bestLine) return bestLine;

  // Single distinctive token that uniquely identifies one bullet (e.g. "2byte").
  let uniqueLine: string | null = null;
  let uniqueTokenLen = 0;
  for (const token of questionTokens) {
    if (!isDistinctiveFocusToken(token)) continue;
    const matching = lines.filter((line) => {
      const stripped = stripBulletPrefix(line);
      if (!stripped) return false;
      const looksLikeBullet = /^[*•-]\s+/.test(line) || stripped.length <= 280;
      if (!looksLikeBullet) return false;
      return followUpMatchHaystack(stripped).includes(token);
    });
    if (matching.length !== 1) continue;
    const only = matching[0];
    if (!only || token.length <= uniqueTokenLen) continue;
    uniqueTokenLen = token.length;
    uniqueLine = stripBulletPrefix(only);
  }
  return uniqueLine;
}

/** Query tokens for follow-up relevance: question + focus, or question + full summary. */
export function followUpQueryTokens(
  question: string,
  summary: string,
): {
  tokens: Set<string>;
  focus: string | null;
  /** True when scoring should ignore the full summary (quoted-bullet path). */
  focusOnly: boolean;
} {
  const focus = extractQuotedSummaryFocus(question, summary);
  const tokens = new Set(followUpContentTokens(question));
  if (focus) {
    for (const token of followUpContentTokens(focus)) tokens.add(token);
    return { tokens, focus, focusOnly: true };
  }
  for (const token of followUpContentTokens(summary)) tokens.add(token);
  return { tokens, focus: null, focusOnly: false };
}

export function countFollowUpQueryHits(
  queryTokens: Set<string>,
  message: AiSummaryMessage,
): number {
  const sender = followUpMatchHaystack(message.sender);
  const body = followUpMatchHaystack(message.body);
  let hits = 0;
  for (const token of queryTokens) {
    if (sender.includes(token) || body.includes(token)) hits += 1;
  }
  return hits;
}

/**
 * True when the question quotes a catch-up slice and this message overlaps that
 * point enough to force-include / pack-priority. Without a quoted focus, callers
 * should keep paste-only priority so summary tokens cannot flood the budget.
 */
export function isFollowUpFocusMatch(
  question: string,
  summary: string,
  message: AiSummaryMessage,
): boolean {
  const { tokens, focusOnly } = followUpQueryTokens(question, summary);
  if (!focusOnly) return false;
  return countFollowUpQueryHits(tokens, message) >= FOLLOW_UP_FOCUS_HIT_MIN;
}

/**
 * True when the message overlaps the question's own content tokens strongly enough
 * to pack ahead of newest filler (without using the full summary token flood).
 */
export function isFollowUpQuestionTopicMatch(question: string, message: AiSummaryMessage): boolean {
  const tokens = new Set(followUpContentTokens(question));
  if (!tokens.size) return false;
  const hits = countFollowUpQueryHits(tokens, message);
  if (hits >= FOLLOW_UP_FOCUS_HIT_MIN) return true;
  if (hits < 1) return false;
  const hay = `${followUpMatchHaystack(message.sender)}\0${followUpMatchHaystack(message.body)}`;
  for (const token of tokens) {
    if (!hay.includes(token)) continue;
    if (isDistinctiveFocusToken(token)) return true;
  }
  return false;
}
