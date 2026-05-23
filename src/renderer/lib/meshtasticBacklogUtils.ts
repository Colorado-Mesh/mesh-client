import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { StoreForward } from '@meshtastic/protobufs';

/** Duration after MQTT connect during which inbound messages are treated as backlog. */
export const MQTT_RECONNECT_BACKLOG_MS = 30_000;

export function mqttMessageTreatAsHistory(now: number, reconnectBacklogUntil: number): boolean {
  return reconnectBacklogUntil > 0 && now < reconnectBacklogUntil;
}

export interface StoreForwardHistoryRequestOptions {
  /** History window in minutes; 0 lets the server use its configured default. */
  windowMinutes?: number;
  /** Index from a prior ROUTER_HISTORY response; 0 for first request. */
  lastRequest?: number;
}

/** Build CLIENT_HISTORY request bytes for STORE_FORWARD_APP port. */
export function buildStoreForwardHistoryRequestBytes(
  options: StoreForwardHistoryRequestOptions = {},
): Uint8Array {
  const windowMinutes = options.windowMinutes ?? 0;
  const lastRequest = options.lastRequest ?? 0;
  const msg = create(StoreForward.StoreAndForwardSchema, {
    rr: StoreForward.StoreAndForward_RequestResponse.CLIENT_HISTORY,
    variant: {
      case: 'history',
      value: create(StoreForward.StoreAndForward_HistorySchema, {
        historyMessages: 0,
        window: windowMinutes,
        lastRequest,
      }),
    },
  });
  return toBinary(StoreForward.StoreAndForwardSchema, msg);
}

export function decodeStoreForwardTextPayload(data: Uint8Array): string | null {
  if (!data.length) return null;
  try {
    const parsed = fromBinary(StoreForward.StoreAndForwardSchema, data) as unknown as {
      variant: { case?: string; value?: Uint8Array };
    };
    if (parsed.variant.case !== 'text') return null;
    const textBytes = parsed.variant.value;
    if (!textBytes?.length) return null;
    const text = new TextDecoder().decode(textBytes).trim();
    return text || null;
  } catch {
    // catch-no-log-ok malformed StoreAndForward protobuf
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
