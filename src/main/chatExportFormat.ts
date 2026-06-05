import { isMeshtasticBroadcastNodeNum } from '../shared/nodeNameUtils';

export interface ChatExportLineInput {
  timestamp?: unknown;
  sender_name?: unknown;
  channel?: unknown;
  to?: unknown;
  payload?: unknown;
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
