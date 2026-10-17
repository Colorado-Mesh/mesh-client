import type { AiEngine, AiSummaryMessage, AiSummaryPassMode } from './ai-types';
import { AI_MAX_MESSAGES, AI_TYPICAL_SUMMARY_LINE_BYTES, aiSummaryPromptBudget } from './ai-types';

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

/** Pack messages into contiguous chronological chunks that fit one engine prompt budget. */
export function packAiSummaryChunks(
  messages: AiSummaryMessage[],
  engine: AiEngine,
  typicalLineBytes = AI_TYPICAL_SUMMARY_LINE_BYTES,
): AiSummaryMessage[][] {
  if (!messages.length) return [];
  const { maxPromptBytes, maxChars } = aiSummaryPromptBudget(engine);
  // Leave headroom for system/framing (~900 bytes typical).
  const framingReserve = 900;
  const byteBudget = Math.max(typicalLineBytes, maxPromptBytes - framingReserve);
  const charBudget = Math.max(80, maxChars - 400);
  const ordered = [...messages].sort((a, b) => a.at - b.at || a.sender.localeCompare(b.sender));
  const chunks: AiSummaryMessage[][] = [];
  let current: AiSummaryMessage[] = [];
  let bytes = 0;
  let chars = 0;
  for (const message of ordered) {
    const lineBytes =
      utf8Bytes(`[ts] ${JSON.stringify(message.sender)}: ${JSON.stringify(message.body)}`) + 1;
    const lineChars = message.body.length + message.sender.length + 40;
    const wouldExceed =
      current.length >= AI_MAX_MESSAGES ||
      bytes + lineBytes > byteBudget ||
      chars + lineChars > charBudget;
    if (wouldExceed && current.length) {
      chunks.push(current);
      current = [];
      bytes = 0;
      chars = 0;
    }
    if (lineBytes > byteBudget || lineChars > charBudget || message.body.length > charBudget) {
      // Oversized single message: skip rather than blocking the chunker.
      continue;
    }
    current.push(message);
    bytes += lineBytes;
    chars += lineChars;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Pack digest strings into reduce-sized batches as synthetic messages. */
export function packAiDigestChunks(digests: string[], engine: AiEngine): AiSummaryMessage[][] {
  const asMessages: AiSummaryMessage[] = digests.map((body, index) => ({
    at: index + 1,
    sender: `Part ${index + 1}`,
    body,
  }));
  return packAiSummaryChunks(asMessages, engine);
}

export function needsMultiPass(messages: AiSummaryMessage[], engine: AiEngine): boolean {
  return packAiSummaryChunks(messages, engine).length > 1;
}

export type { AiSummaryPassMode };
