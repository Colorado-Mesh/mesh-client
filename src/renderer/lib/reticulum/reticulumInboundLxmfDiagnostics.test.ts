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
    advanceReticulumInboundCatchUpWatermark(1_000, 4);
    advanceReticulumInboundCatchUpWatermark(500, 9);
    noteReticulumInboundRingLen(12);
    const snap = getReticulumInboundLxmfDiagnostics();
    expect(snap.lastEventsLaggedSkipped).toBe(7);
    expect(snap.lastInboundCatchUpCount).toBe(3);
    // Stored watermark is the exclusive lower bound for the next periodic since_ts/since_seq.
    expect(snap.inboundCatchUpWatermarkTs).toBe(1_000);
    expect(snap.inboundCatchUpWatermarkSeq).toBe(4);
    expect(snap.lastInboundRingLen).toBe(12);
    expect(snap.lastEventsLaggedAt).toEqual(expect.any(Number));
    expect(snap.lastInboundCatchUpAt).toEqual(expect.any(Number));
  });

  it('only advances the exclusive watermark forward', () => {
    advanceReticulumInboundCatchUpWatermark(2_500, 1);
    advanceReticulumInboundCatchUpWatermark(2_500, 1);
    advanceReticulumInboundCatchUpWatermark(1_000, 99);
    expect(getReticulumInboundLxmfDiagnostics().inboundCatchUpWatermarkTs).toBe(2_500);
    expect(getReticulumInboundLxmfDiagnostics().inboundCatchUpWatermarkSeq).toBe(1);
  });

  it('advances same-ms ring_seq without moving timestamp backward', () => {
    advanceReticulumInboundCatchUpWatermark(2_500, 1);
    advanceReticulumInboundCatchUpWatermark(2_500, 3);
    expect(getReticulumInboundLxmfDiagnostics().inboundCatchUpWatermarkTs).toBe(2_500);
    expect(getReticulumInboundLxmfDiagnostics().inboundCatchUpWatermarkSeq).toBe(3);
  });
});
