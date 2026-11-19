import type { AiSummaryMessage, AiSummaryScope } from '@/shared/ai-types';
import { MS_PER_HOUR } from '@/shared/timeConstants';

/**
 * A loaded message for Catch up. `order` is its arrival time (or its stamp for rows saved before
 * arrival times were kept), which the "since last read" choice compares with the read mark.
 * Rows read back from the database carry it when they were asked for by arrival; otherwise they
 * are compared by `at`.
 */
export interface AiSummaryLiveMessage extends AiSummaryMessage {
  order?: number;
}

/**
 * Remove overlapping history/live copies without collapsing distinct repeated messages. An
 * overlapping pair keeps the live copy in the history copy's place.
 */
export function mergeSummaryMessages(
  history: readonly AiSummaryLiveMessage[],
  live: readonly AiSummaryLiveMessage[],
): AiSummaryLiveMessage[] {
  const keyFor = (message: AiSummaryMessage) =>
    JSON.stringify([message.at, message.sender, message.body]);
  const liveIndexes = new Map<string, number[]>();
  live.forEach((message, index) => {
    const key = keyFor(message);
    const indexes = liveIndexes.get(key);
    if (indexes) indexes.push(index);
    else liveIndexes.set(key, [index]);
  });
  const used = live.map(() => false);
  const merged: AiSummaryLiveMessage[] = history.map((message) => {
    const index = liveIndexes.get(keyFor(message))?.shift();
    if (index === undefined) return message;
    used[index] = true;
    return live[index];
  });
  live.forEach((message, index) => {
    if (!used[index]) merged.push(message);
  });
  return merged;
}

export function selectSummaryMessages<T extends AiSummaryLiveMessage>(input: {
  messages: T[];
  scope: AiSummaryScope;
  watermark?: number;
  now?: number;
}): T[] {
  return input.messages.filter(
    (message) =>
      input.scope.kind === 'loaded' ||
      (input.scope.kind === 'unread'
        ? (message.order ?? message.at) > (input.watermark ?? 0)
        : message.at >= (input.now ?? Date.now()) - input.scope.hours * MS_PER_HOUR),
  );
}
