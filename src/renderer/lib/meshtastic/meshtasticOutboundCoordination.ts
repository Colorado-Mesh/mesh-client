/**
 * Tracks in-flight non-chat wantAck outbounds (e.g. the share-location Waypoint).
 *
 * SDK routing NAKs for non-chat packets carry wire ids that match no chat row;
 * while one is in flight, the single-"sending" fallback in
 * `meshtasticSdkRoutingErrorLog.ts` must not misattribute its NAK to a pending
 * chat message (proven failure: Waypoint MAX_RETRANSMIT marking the location
 * text "no ACK").
 */

let nonChatOutboundInFlight = 0;

/**
 * Wire ids of settled non-chat packets. The same routing-error log line is
 * re-applied asynchronously (main-process log echo via `log.onLine`) after the
 * in-flight flag drops, so settled ids must stay excluded for a while.
 */
const NON_CHAT_WIRE_ID_TTL_MS = 5 * 60_000;
const settledNonChatWireIds = new Map<number, number>();

function pruneSettledNonChatWireIds(now: number): void {
  for (const [id, at] of settledNonChatWireIds) {
    if (now - at > NON_CHAT_WIRE_ID_TTL_MS) settledNonChatWireIds.delete(id);
  }
}

/** Mark a non-chat wantAck outbound (Waypoint etc.) as in flight. */
export function beginMeshtasticNonChatOutbound(): void {
  nonChatOutboundInFlight += 1;
}

/** Non-chat outbound settled (resolved or rejected). */
export function endMeshtasticNonChatOutbound(): void {
  nonChatOutboundInFlight = Math.max(0, nonChatOutboundInFlight - 1);
}

/** True while any non-chat wantAck outbound awaits its routing response. */
export function hasMeshtasticNonChatOutboundInFlight(): boolean {
  return nonChatOutboundInFlight > 0;
}

/** Remember a settled non-chat wire id so late log-echo re-applies skip it. */
export function registerMeshtasticNonChatWirePacketId(wireId: number | undefined | null): void {
  if (wireId == null || !Number.isFinite(wireId)) return;
  const now = Date.now();
  pruneSettledNonChatWireIds(now);
  settledNonChatWireIds.set(wireId >>> 0, now);
}

/** True when the wire id belongs to a known non-chat packet (Waypoint etc.). */
export function isMeshtasticNonChatWirePacketId(wireId: number): boolean {
  const at = settledNonChatWireIds.get(wireId >>> 0);
  if (at == null) return false;
  if (Date.now() - at > NON_CHAT_WIRE_ID_TTL_MS) {
    settledNonChatWireIds.delete(wireId >>> 0);
    return false;
  }
  return true;
}

/** Test helper — reset coordination state. */
export function resetMeshtasticOutboundCoordinationForTests(): void {
  nonChatOutboundInFlight = 0;
  settledNonChatWireIds.clear();
}
