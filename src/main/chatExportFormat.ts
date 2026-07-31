import { isMeshtasticBroadcastNodeNum } from '../shared/nodeNameUtils';

/** Max UTF-16 code units for a single message payload in chat:export. */
export const CHAT_EXPORT_MAX_PAYLOAD_CHARS = 64 * 1024;
/** Max UTF-16 code units for sender_name in chat:export. */
export const CHAT_EXPORT_MAX_SENDER_NAME_CHARS = 512;
/** Soft cap on total serialized export bytes (UTF-8). */
export const CHAT_EXPORT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

export interface ChatExportLineInput {
  timestamp?: unknown;
  sender_name?: unknown;
  channel?: unknown;
  to?: unknown;
  payload?: unknown;
}

/**
 * Reject oversized payload / sender_name fields before formatting.
 * Throws a clear `chat:export: …` error when any message exceeds limits.
 */
export function assertChatExportMessageSizes(messages: unknown[]): void {
  for (let i = 0; i < messages.length; i++) {
    const item = messages[i];
    if (typeof item !== 'object' || item === null) continue;
    const row = item as ChatExportLineInput;
    if (typeof row.payload === 'string' && row.payload.length > CHAT_EXPORT_MAX_PAYLOAD_CHARS) {
      throw new Error(
        `chat:export: message[${i}] payload exceeds max length (${CHAT_EXPORT_MAX_PAYLOAD_CHARS})`,
      );
    }
    if (
      typeof row.sender_name === 'string' &&
      row.sender_name.length > CHAT_EXPORT_MAX_SENDER_NAME_CHARS
    ) {
      throw new Error(
        `chat:export: message[${i}] sender_name exceeds max length (${CHAT_EXPORT_MAX_SENDER_NAME_CHARS})`,
      );
    }
  }
}

/** Format one chat export line; broadcast `to` is channel traffic, not a DM. */
export function formatChatExportLine(item: ChatExportLineInput): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const time = new Date(Number(item.timestamp ?? 0)).toISOString().replace('T', ' ').slice(0, 19);
  const sender = typeof item.sender_name === 'string' ? item.sender_name : '';
  const ch = typeof item.channel === 'number' ? item.channel : 0;
  const to = typeof item.to === 'number' ? item.to : undefined;
  const dest = to != null && !isMeshtasticBroadcastNodeNum(to) ? ' (DM)' : ` (ch${ch})`;
  const body = typeof item.payload === 'string' ? item.payload : '';
  return `[${time}] ${sender}${dest}: ${body}`;
}

export function formatChatExportLines(messages: unknown[]): string[] {
  return messages.flatMap((m) => {
    const line = formatChatExportLine(m as ChatExportLineInput);
    return line != null ? [line] : [];
  });
}

/**
 * Format export lines and enforce total serialized size.
 * Call after {@link assertChatExportMessageSizes}.
 */
export function formatChatExportLinesWithTotalCap(messages: unknown[]): string {
  const lines = formatChatExportLines(messages);
  const text = lines.join('\n') + '\n';
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > CHAT_EXPORT_MAX_TOTAL_BYTES) {
    throw new Error(
      `chat:export: serialized output exceeds max size (${CHAT_EXPORT_MAX_TOTAL_BYTES} bytes)`,
    );
  }
  return text;
}
