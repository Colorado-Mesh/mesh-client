import type { AiSummaryMessage, AiSummaryScope } from '@/shared/ai-types';
import { MS_PER_HOUR } from '@/shared/timeConstants';

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
