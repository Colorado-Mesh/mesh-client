import type { AiEngine, AiFollowUpContextKind, AiSummaryMessage } from '@/shared/ai-types';
import { AI_FOLLOW_UP_CONTEXT_MAX_CHARS } from '@/shared/ai-types';
import {
  countFollowUpQueryHits,
  FOLLOW_UP_FOCUS_HIT_MIN,
  followUpContentTokens,
  followUpMatchHaystack,
  followUpQueryTokens,
  isFollowUpQuestionTopicMatch,
} from '@/shared/aiFollowUpFocus';

export { extractQuotedSummaryFocus } from '@/shared/aiFollowUpFocus';

/** Minimum body length for paste / substring force-include. */
const PASTE_MATCH_MIN_BODY = 12;

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
 * - On-device engines get a deterministic relevance subset, using the question
 *   plus either a quoted summary focus or the full summary (so "how?" can still
 *   find the bullet's subject).
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
 * Score messages by question (+ quoted focus or full summary) tokens, always
 * keep paste matches, focus/topic matches, and the newest 8, take the top `max`,
 * then return chronological unique rows.
 */
export function selectRelevantMessages(
  question: string,
  summary: string,
  messages: AiSummaryMessage[],
  max = 24,
): AiSummaryMessage[] {
  const { tokens: queryTokens, focusOnly } = followUpQueryTokens(question, summary);
  const questionTokens = new Set(followUpContentTokens(question));
  const summaryTokens = focusOnly ? new Set<string>() : new Set(followUpContentTokens(summary));
  const pasteMatches = messages.filter((message) => isFollowUpPasteMatch(question, message.body));
  const focusMatches = focusOnly
    ? messages.filter(
        (message) => countFollowUpQueryHits(queryTokens, message) >= FOLLOW_UP_FOCUS_HIT_MIN,
      )
    : [];
  const topicMatches = messages.filter((message) =>
    isFollowUpQuestionTopicMatch(question, message),
  );
  if (!queryTokens.size && !pasteMatches.length) return messages;
  const scored = messages.map((message, index) => {
    const sender = followUpMatchHaystack(message.sender);
    const body = followUpMatchHaystack(message.body);
    let score = index / Math.max(1, messages.length); // recency tiebreak
    if (isFollowUpPasteMatch(question, message.body)) score += 1000;
    if (focusOnly && countFollowUpQueryHits(queryTokens, message) >= FOLLOW_UP_FOCUS_HIT_MIN)
      score += 500;
    if (isFollowUpQuestionTopicMatch(question, message)) score += 300;
    for (const token of questionTokens) {
      if (sender.includes(token)) score += 4;
      if (body.includes(token)) score += 2;
    }
    if (focusOnly) {
      for (const token of queryTokens) {
        if (questionTokens.has(token)) continue;
        if (sender.includes(token)) score += 4;
        if (body.includes(token)) score += 2;
      }
    } else {
      for (const token of summaryTokens) {
        if (sender.includes(token)) score += 2;
        if (body.includes(token)) score += 1;
      }
    }
    return { message, index, score };
  });
  const newest = messages.slice(-8);
  const top = scored
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, max)
    .map((entry) => entry.message);
  const byKey = new Map<string, AiSummaryMessage>();
  // Paste/focus always; topic/top only fill remaining slots up to max so topic
  // hits cannot displace higher-priority matches or inflate past the cap.
  for (const message of [...pasteMatches, ...focusMatches]) byKey.set(messageKey(message), message);
  for (const message of [...topicMatches, ...top]) {
    const key = messageKey(message);
    if (byKey.has(key) || byKey.size >= max) continue;
    byKey.set(key, message);
  }
  for (const message of newest) byKey.set(messageKey(message), message);
  return [...byKey.values()].sort((a, b) => a.at - b.at);
}
