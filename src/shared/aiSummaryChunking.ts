import type { AiEngine, AiSummaryMessage, AiSummaryPassMode } from './ai-types';
import { AI_MAX_MESSAGES, aiSummaryPromptBudget } from './ai-types';
import { buildAiSummaryPrompt } from './aiSummaryPrompt';

export type AiSummaryPromptContext = Omit<
  Parameters<typeof buildAiSummaryPrompt>[0],
  'messages' | 'maxChars' | 'maxPromptBytes'
>;

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

/** Pack the complete transcript using the same escaped prompt framing as main. */
export function packAiSummaryChunks(
  messages: AiSummaryMessage[],
  engine: AiEngine,
  context: Partial<AiSummaryPromptContext> = {},
): AiSummaryMessage[][] {
  if (!messages.length) return [];
  const budget = aiSummaryPromptBudget(engine);
  const frame = { conversationLabel: '', protocol: '', surface: '', locale: 'en', ...context };
  const empty = buildAiSummaryPrompt({ ...frame, messages: [], maxChars: Infinity });
  const framingBytes = utf8Bytes(empty.system + empty.user);
  if (framingBytes >= budget.maxPromptBytes) throw new Error('tooLarge');
  const cost = (message: AiSummaryMessage) => {
    const prompt = buildAiSummaryPrompt({ ...frame, messages: [message], maxChars: Infinity });
    return {
      bytes: utf8Bytes(prompt.system + prompt.user) - framingBytes + 1,
      chars: prompt.user.length - empty.user.length + 1,
    };
  };
  const fits = (size: ReturnType<typeof cost>) =>
    size.bytes + framingBytes <= budget.maxPromptBytes && size.chars <= budget.maxChars;
  const chunks: AiSummaryMessage[][] = [];
  let current: AiSummaryMessage[] = [];
  let bytes = framingBytes;
  let chars = 0;
  const append = (message: AiSummaryMessage) => {
    const size = cost(message);
    if (
      current.length &&
      (current.length >= AI_MAX_MESSAGES ||
        bytes + size.bytes > budget.maxPromptBytes ||
        chars + size.chars > budget.maxChars)
    ) {
      chunks.push(current);
      current = [];
      bytes = framingBytes;
      chars = 0;
    }
    current.push(message);
    bytes += size.bytes;
    chars += size.chars;
  };
  for (const message of [...messages].sort((a, b) => a.at - b.at)) {
    if (fits(cost(message))) {
      append(message);
      continue;
    }
    const body = Array.from(message.body);
    let start = 0;
    while (start < body.length) {
      let low = 0;
      let high = Math.min(body.length - start, budget.maxChars, budget.maxPromptBytes);
      while (low < high) {
        const length = Math.ceil((low + high) / 2);
        if (fits(cost({ ...message, body: body.slice(start, start + length).join('') })))
          low = length;
        else high = length - 1;
      }
      if (!low) throw new Error('tooLarge');
      append({ ...message, body: body.slice(start, start + low).join('') });
      start += low;
    }
    if (!body.length) throw new Error('tooLarge');
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Pack digest strings into reduce-sized batches as synthetic messages. */
export function packAiDigestChunks(
  digests: string[],
  engine: AiEngine,
  context: Partial<AiSummaryPromptContext> = {},
): AiSummaryMessage[][] {
  const asMessages: AiSummaryMessage[] = digests.map((body, index) => ({
    at: index + 1,
    sender: `Part ${index + 1}`,
    body,
  }));
  return packAiSummaryChunks(asMessages, engine, { ...context, mode: 'reduce' });
}

export function needsMultiPass(messages: AiSummaryMessage[], engine: AiEngine): boolean {
  return packAiSummaryChunks(messages, engine).length > 1;
}

export type { AiSummaryPassMode };
