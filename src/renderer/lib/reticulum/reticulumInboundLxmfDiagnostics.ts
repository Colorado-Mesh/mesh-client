/**
 * Process-local diagnostics for inbound LXMF catch-up / WS lag (debug snapshot + logs).
 * Not persisted; cleared only in tests.
 */

export interface ReticulumInboundLxmfDiagnosticsSnapshot {
  lastEventsLaggedAt: number | null;
  lastEventsLaggedSkipped: number | null;
  lastInboundCatchUpAt: number | null;
  lastInboundCatchUpCount: number | null;
  /** Inclusive watermark (ms) for periodic `since_ts` catch-up. */
  inboundCatchUpWatermarkTs: number | null;
  lastInboundRingLen: number | null;
}

const state: ReticulumInboundLxmfDiagnosticsSnapshot = {
  lastEventsLaggedAt: null,
  lastEventsLaggedSkipped: null,
  lastInboundCatchUpAt: null,
  lastInboundCatchUpCount: null,
  inboundCatchUpWatermarkTs: null,
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

export function advanceReticulumInboundCatchUpWatermark(timestampMs: number): void {
  if (!Number.isFinite(timestampMs)) return;
  const ts = Math.floor(timestampMs);
  if (state.inboundCatchUpWatermarkTs == null || ts > state.inboundCatchUpWatermarkTs) {
    state.inboundCatchUpWatermarkTs = ts;
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
  state.lastInboundRingLen = null;
}
