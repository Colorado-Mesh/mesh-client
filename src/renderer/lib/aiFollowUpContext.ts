import type { AiEngine, AiFollowUpContextKind, AiSummaryMessage } from '@/shared/ai-types';
import { AI_FOLLOW_UP_CONTEXT_MAX_CHARS } from '@/shared/ai-types';

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
]);

/** Minimum body length for paste / substring force-include. */
const PASTE_MATCH_MIN_BODY = 12;

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function normalizeWs(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function messageKey(message: AiSummaryMessage): string {
  return `${message.at}\u0000${message.sender}\u0000${message.body}`;
}

/** True when the question likely pastes or quotes this message body. */
export function isFollowUpPasteMatch(question: string, body: string): boolean {
  const normalizedBody = normalizeWs(body);
  if (normalizedBody.length < PASTE_MATCH_MIN_BODY) return false;
  const normalizedQuestion = normalizeWs(question);
  if (!normalizedQuestion) return false;
  if (normalizedQuestion.includes(normalizedBody)) return true;
  if (
    normalizedBody.includes(normalizedQuestion) &&
    normalizedQuestion.length >= PASTE_MATCH_MIN_BODY
  )
    return true;
  return false;
}

/**
 * Keep newest messages until total body characters reach `maxChars`.
 * Always keeps at least the newest message when the input is non-empty.
 */
export function retainFollowUpMessages(
  messages: AiSummaryMessage[],
  maxChars = AI_FOLLOW_UP_CONTEXT_MAX_CHARS,
): { messages: AiSummaryMessage[]; clipped: boolean } {
  if (!messages.length) return { messages: [], clipped: false };
  let total = 0;
  for (const message of messages) total += message.body.length;
  if (total <= maxChars) return { messages, clipped: false };
  const kept: AiSummaryMessage[] = [];
  let used = 0;
  for (const message of [...messages].reverse()) {
    if (kept.length > 0 && used + message.body.length > maxChars) break;
    kept.push(message);
    used += message.body.length;
  }
  return { messages: kept.reverse(), clipped: true };
}

export interface FollowUpRetainedContext {
  messages?: AiSummaryMessage[];
  digests?: string[];
  limited: boolean;
}

export interface FollowUpContextSelection {
  messages: AiSummaryMessage[];
  contextKind: AiFollowUpContextKind;
  limited: boolean;
}

/**
 * Choose the source material sent with a follow-up.
 * - Raw retained transcript wins when present (needed for verbatim paste grounding).
 * - Digests are a fallback when only multi-pass digests were kept.
 * - Endpoint engines get the full retained transcript.
 * - On-device engines get a deterministic relevance subset, using both the
 *   question and the summary as the query (so "how?" can still find the
 *   bullet's subject).
 */
export function selectFollowUpContext(
  question: string,
  summary: string,
  context: FollowUpRetainedContext | undefined,
  engine: AiEngine,
): FollowUpContextSelection {
  const all = context?.messages ?? [];
  if (all.length) {
    if (engine !== 'os' && engine !== 'bundled')
      return {
        messages: all,
        contextKind: 'transcript',
        limited: context?.limited ?? false,
      };
    return {
      messages: selectRelevantMessages(question, summary, all),
      contextKind: 'transcript',
      limited: context?.limited ?? false,
    };
  }
  if (context?.digests?.length) {
    return {
      messages: context.digests.map((body, index) => ({
        at: index + 1,
        sender: `Part ${index + 1}`,
        body,
      })),
      contextKind: 'digests',
      limited: context.limited,
    };
  }
  return { messages: [], contextKind: 'none', limited: true };
}

/**
 * Score messages by question + summary tokens (summary weighted lower), always
 * keep paste matches and the newest 8, take the top `max`, then return
 * chronological unique rows.
 */
export function selectRelevantMessages(
  question: string,
  summary: string,
  messages: AiSummaryMessage[],
  max = 24,
): AiSummaryMessage[] {
  const questionTokens = new Set(tokens(question));
  const summaryTokens = new Set(tokens(summary));
  const pasteMatches = messages.filter((message) => isFollowUpPasteMatch(question, message.body));
  if (!questionTokens.size && !summaryTokens.size && !pasteMatches.length) return messages;
  const scored = messages.map((message, index) => {
    const sender = message.sender.toLowerCase();
    const body = message.body.toLowerCase();
    let score = index / Math.max(1, messages.length); // recency tiebreak
    if (isFollowUpPasteMatch(question, message.body)) score += 1000;
    for (const token of questionTokens) {
      if (sender.includes(token)) score += 4;
      if (body.includes(token)) score += 2;
    }
    for (const token of summaryTokens) {
      if (sender.includes(token)) score += 2;
      if (body.includes(token)) score += 1;
    }
    return { message, index, score };
  });
  const newest = messages.slice(-8);
  const top = scored
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, max)
    .map((entry) => entry.message);
  const byKey = new Map<string, AiSummaryMessage>();
  for (const message of [...pasteMatches, ...top, ...newest])
    byKey.set(messageKey(message), message);
  return [...byKey.values()].sort((a, b) => a.at - b.at);
}
