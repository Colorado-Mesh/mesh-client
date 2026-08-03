import { beforeEach, describe, expect, it } from 'vitest';

import {
  advanceReticulumInboundCatchUpWatermark,
  getReticulumInboundLxmfDiagnostics,
  noteReticulumEventsLagged,
  noteReticulumInboundCatchUp,
  noteReticulumInboundRingLen,
  resetReticulumInboundLxmfDiagnosticsForTests,
} from './reticulumInboundLxmfDiagnostics';

describe('reticulumInboundLxmfDiagnostics', () => {
  beforeEach(() => {
    resetReticulumInboundLxmfDiagnosticsForTests();
  });

  it('records lag, catch-up, watermark, and ring len', () => {
    noteReticulumEventsLagged(7);
    noteReticulumInboundCatchUp(3);
    advanceReticulumInboundCatchUpWatermark(1_000);
    advanceReticulumInboundCatchUpWatermark(500);
    noteReticulumInboundRingLen(12);
    const snap = getReticulumInboundLxmfDiagnostics();
    expect(snap.lastEventsLaggedSkipped).toBe(7);
    expect(snap.lastInboundCatchUpCount).toBe(3);
    // Stored watermark is the exclusive lower bound for the next periodic since_ts.
    expect(snap.inboundCatchUpWatermarkTs).toBe(1_000);
    expect(snap.lastInboundRingLen).toBe(12);
    expect(snap.lastEventsLaggedAt).toEqual(expect.any(Number));
    expect(snap.lastInboundCatchUpAt).toEqual(expect.any(Number));
  });

  it('only advances the exclusive watermark forward', () => {
    advanceReticulumInboundCatchUpWatermark(2_500);
    advanceReticulumInboundCatchUpWatermark(2_500);
    advanceReticulumInboundCatchUpWatermark(1_000);
    expect(getReticulumInboundLxmfDiagnostics().inboundCatchUpWatermarkTs).toBe(2_500);
  });
});
