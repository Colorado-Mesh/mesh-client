import { MAX_RAW_PACKET_LOG_ENTRIES } from './rawPacketLogConstants';

/** Correlation window: event 7/8 must arrive within this many ms of the matching event 136. */
export const MESHCORE_CHAT_CORRELATE_WINDOW_MS = 1500;

/** Minimal shape needed for chat-entry correlation (avoids importing RxPacketEntry from useMeshCore). */
export interface ChatCorrelateRxLike {
  ts: number;
  payloadTypeString: string | null;
  fromNodeId: number | null;
}

/**
 * Correlate an incoming DM (event 7) or channel message (event 8) with raw packet log entries.
 *
 * Two outcomes:
 * - If a recent unattributed entry of the matching payload type is found within `windowMs`, its
 *   `fromNodeId` is backfilled (fixes "no sender name" for TXT_MSG/GRP_TXT rows).
 * - If no match is found, `synthetic` is appended (fixes chat packets missing from raw log).
 */
export function meshcoreCorrelateOrSynthesizeChatEntry<T extends ChatCorrelateRxLike>(
  prev: T[],
  payloadTypeString: 'TXT_MSG' | 'GRP_TXT',
  fromNodeId: number | null,
  synthetic: T,
  windowMs: number = MESHCORE_CHAT_CORRELATE_WINDOW_MS,
): T[] {
  const now = synthetic.ts;
  for (let i = prev.length - 1; i >= 0; i--) {
    const e = prev[i];
    if (now - e.ts > windowMs) break;
    if (e.payloadTypeString === payloadTypeString && e.fromNodeId === null) {
      const updated = prev.slice();
      updated[i] = { ...e, fromNodeId };
      return updated;
    }
  }
  const next = [...prev, synthetic];
  return next.length > MAX_RAW_PACKET_LOG_ENTRIES
    ? next.slice(next.length - MAX_RAW_PACKET_LOG_ENTRIES)
    : next;
}
