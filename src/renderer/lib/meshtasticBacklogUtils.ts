/** Duration after MQTT connect during which inbound messages are treated as backlog. */
export const MQTT_RECONNECT_BACKLOG_MS = 30_000;

export function mqttMessageTreatAsHistory(now: number, reconnectBacklogUntil: number): boolean {
  return reconnectBacklogUntil > 0 && now < reconnectBacklogUntil;
}

export function decodeStoreForwardTextPayload(data: Uint8Array): string | null {
  if (!data.length) return null;
  try {
    const text = new TextDecoder().decode(data).trim();
    return text || null;
  } catch {
    // catch-no-log-ok invalid UTF-8 in store-forward payload
    return null;
  }
}

export interface HistoryMessageDedupFields {
  isHistory?: boolean;
  sender_id: number;
  payload: string;
  timestamp?: number;
}

export function isDuplicateHistoryMessage(
  messages: HistoryMessageDedupFields[],
  candidate: HistoryMessageDedupFields,
  windowMs = 5000,
): boolean {
  return messages.some(
    (m) =>
      m.isHistory &&
      m.sender_id === candidate.sender_id &&
      m.payload === candidate.payload &&
      Math.abs((m.timestamp ?? 0) - (candidate.timestamp ?? 0)) < windowMs,
  );
}
