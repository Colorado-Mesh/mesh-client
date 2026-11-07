import type { AiEngine, AiFollowUpContextKind, AiSummaryMessage } from '@/shared/ai-types';

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

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
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
 * - Digests win when the original run was multi-pass (small + already dense).
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
  const all = context?.messages ?? [];
  if (!all.length) return { messages: [], contextKind: 'none', limited: true };
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

/**
 * Score messages by question + summary tokens (summary weighted lower), always
 * keep the newest 8, take the top `max`, then return chronological unique rows.
 */
export function selectRelevantMessages(
  question: string,
  summary: string,
  messages: AiSummaryMessage[],
  max = 24,
): AiSummaryMessage[] {
  const questionTokens = new Set(tokens(question));
  const summaryTokens = new Set(tokens(summary));
  if (!questionTokens.size && !summaryTokens.size) return messages;
  const scored = messages.map((message, index) => {
    const sender = message.sender.toLowerCase();
    const body = message.body.toLowerCase();
    let score = index / Math.max(1, messages.length); // recency tiebreak
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
  for (const message of [...top, ...newest])
    byKey.set(`${message.at}\u0000${message.sender}\u0000${message.body}`, message);
  return [...byKey.values()].sort((a, b) => a.at - b.at);
}
