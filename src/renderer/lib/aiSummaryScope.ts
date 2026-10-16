import type { AiSummaryMessage, AiSummaryScope } from '@/shared/ai-types';
import { MS_PER_HOUR } from '@/shared/timeConstants';

/** Remove overlapping history/live copies without collapsing distinct repeated messages. */
export function mergeSummaryMessages(
  history: readonly AiSummaryMessage[],
  live: readonly AiSummaryMessage[],
): AiSummaryMessage[] {
  const keyFor = (message: AiSummaryMessage) =>
    JSON.stringify([message.at, message.sender, message.body]);
  const overlap = new Map<string, number>();
  for (const message of history) {
    const key = keyFor(message);
    overlap.set(key, (overlap.get(key) ?? 0) + 1);
  }
  const merged = [...history];
  for (const message of live) {
    const key = keyFor(message);
    const remaining = overlap.get(key) ?? 0;
    if (remaining > 0) overlap.set(key, remaining - 1);
    else merged.push(message);
  }
  return merged;
}

export function selectSummaryMessages(input: {
  messages: AiSummaryMessage[];
  scope: AiSummaryScope;
  watermark?: number;
  now?: number;
}): AiSummaryMessage[] {
  return input.messages.filter(
    (message) =>
      input.scope.kind === 'loaded' ||
      (input.scope.kind === 'unread'
        ? message.at > (input.watermark ?? 0)
        : message.at >= (input.now ?? Date.now()) - input.scope.hours * MS_PER_HOUR),
  );
}
