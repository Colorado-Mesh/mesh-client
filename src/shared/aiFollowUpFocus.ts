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
]);

/** Minimum normalized length for treating a summary slice as quoted in the question. */
const FOCUS_SUBSTRING_MIN = 24;

/** Minimum overlapping content tokens to treat a message as on-focus. */
export const FOLLOW_UP_FOCUS_HIT_MIN = 2;

export function followUpContentTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function normalizeWs(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function stripBulletPrefix(line: string): string {
  return line.replace(/^[*•-]\s+/, '').trim();
}

/**
 * When the user quotes or points at one Catch-up bullet, return that slice so
 * follow-up selection can ignore the rest of the summary.
 */
export function extractQuotedSummaryFocus(question: string, summary: string): string | null {
  const questionNorm = normalizeWs(question);
  const summaryNorm = normalizeWs(summary);
  if (!questionNorm || !summaryNorm) return null;

  const lines = summary
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

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
  if (questionTokens.size < FOLLOW_UP_FOCUS_HIT_MIN) return null;

  let bestLine: string | null = null;
  let bestOverlap = 0;
  for (const line of lines) {
    const stripped = stripBulletPrefix(line);
    if (!stripped) continue;
    const looksLikeBullet = /^[*•-]\s+/.test(line) || stripped.length <= 280;
    if (!looksLikeBullet) continue;
    const overlap = followUpContentTokens(stripped).filter((token) =>
      questionTokens.has(token),
    ).length;
    if (overlap >= FOLLOW_UP_FOCUS_HIT_MIN && overlap > bestOverlap) {
      bestOverlap = overlap;
      bestLine = stripped;
    }
  }
  return bestLine;
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
  const sender = message.sender.toLowerCase();
  const body = message.body.toLowerCase();
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
