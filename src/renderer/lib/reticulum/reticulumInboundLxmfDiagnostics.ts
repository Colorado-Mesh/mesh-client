/**
 * Process-local diagnostics for inbound LXMF catch-up / WS lag (debug snapshot + logs).
 * Not persisted; cleared only in tests.
 */

export interface ReticulumInboundLxmfDiagnosticsSnapshot {
  lastEventsLaggedAt: number | null;
  lastEventsLaggedSkipped: number | null;
  lastInboundCatchUpAt: number | null;
  lastInboundCatchUpCount: number | null;
  /**
   * Exclusive lower-bound watermark (ms) for periodic `since_ts` catch-up.
   * Pair with {@link inboundCatchUpWatermarkSeq} for the complete cursor.
   */
  inboundCatchUpWatermarkTs: number | null;
  /**
   * Opaque sidecar `ring_seq` paired with {@link inboundCatchUpWatermarkTs}.
   * Next fetch uses both so same-ms twins after the stamped sequence are still returned.
   */
  inboundCatchUpWatermarkSeq: number | null;
  lastInboundRingLen: number | null;
}

const state: ReticulumInboundLxmfDiagnosticsSnapshot = {
  lastEventsLaggedAt: null,
  lastEventsLaggedSkipped: null,
  lastInboundCatchUpAt: null,
  lastInboundCatchUpCount: null,
  inboundCatchUpWatermarkTs: null,
  inboundCatchUpWatermarkSeq: null,
  lastInboundRingLen: null,
};

export function getReticulumInboundLxmfDiagnostics(): ReticulumInboundLxmfDiagnosticsSnapshot {
  return { ...state };
}

export function noteReticulumEventsLagged(skipped: number | undefined): void {
  state.lastEventsLaggedAt = Date.now();
  state.lastEventsLaggedSkipped =
    typeof skipped === 'number' && Number.isFinite(skipped) ? Math.trunc(skipped) : null;
}

export function noteReticulumInboundCatchUp(count: number): void {
  state.lastInboundCatchUpAt = Date.now();
  state.lastInboundCatchUpCount = count;
}

/**
 * Advance the exclusive `(timestamp, ring_seq)` catch-up cursor.
 * Only moves forward; a higher timestamp resets the sequence half of the cursor.
 */
export function advanceReticulumInboundCatchUpWatermark(
  timestampMs: number,
  ringSeq?: number | null,
): void {
  if (!Number.isFinite(timestampMs)) return;
  const ts = Math.floor(timestampMs);
  const seq = typeof ringSeq === 'number' && Number.isFinite(ringSeq) ? Math.floor(ringSeq) : null;

  const curTs = state.inboundCatchUpWatermarkTs;
  const curSeq = state.inboundCatchUpWatermarkSeq;
  if (curTs == null || ts > curTs) {
    state.inboundCatchUpWatermarkTs = ts;
    state.inboundCatchUpWatermarkSeq = seq;
    return;
  }
  if (ts === curTs && seq != null && (curSeq == null || seq > curSeq)) {
    state.inboundCatchUpWatermarkSeq = seq;
  }
}

export function noteReticulumInboundRingLen(len: number | null | undefined): void {
  if (typeof len === 'number' && Number.isFinite(len) && len >= 0) {
    state.lastInboundRingLen = Math.trunc(len);
  }
}

/** Test helper. */
export function resetReticulumInboundLxmfDiagnosticsForTests(): void {
  state.lastEventsLaggedAt = null;
  state.lastEventsLaggedSkipped = null;
  state.lastInboundCatchUpAt = null;
  state.lastInboundCatchUpCount = null;
  state.inboundCatchUpWatermarkTs = null;
  state.inboundCatchUpWatermarkSeq = null;
  state.lastInboundRingLen = null;
}
