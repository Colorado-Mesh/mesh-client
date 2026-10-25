import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearRendererTimings,
  createRendererTimingRing,
  getRendererTimingsSnapshot,
  measureRendererTiming,
  recordRendererTiming,
  RENDERER_TIMING_MAX_SAMPLES,
  setRendererTimingsEnabled,
} from './rendererTimings';

describe('rendererTimings', () => {
  afterEach(() => {
    clearRendererTimings();
    setRendererTimingsEnabled(true);
  });

  it('records samples into a bounded ring', () => {
    const ring = createRendererTimingRing({
      now: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })(),
      isIsolated: () => true,
      isEnabled: () => true,
    });
    for (let i = 0; i < RENDERER_TIMING_MAX_SAMPLES + 5; i += 1) {
      ring.record('ingest', i);
    }
    const snap = ring.getSnapshot();
    expect(snap.samples).toHaveLength(RENDERER_TIMING_MAX_SAMPLES);
    expect(snap.samples[0]?.durationMs).toBe(5);
    expect(snap.resolutionLabel).toBe('fine');
    expect(snap.crossOriginIsolated).toBe(true);
  });

  it('labels coarse resolution when not isolated', () => {
    const ring = createRendererTimingRing({
      now: () => 0,
      isIsolated: () => false,
      isEnabled: () => true,
    });
    expect(ring.getSnapshot().resolutionLabel).toBe('coarse');
  });

  it('is a no-op when disabled', () => {
    const ring = createRendererTimingRing({
      now: () => 10,
      isIsolated: () => true,
      isEnabled: () => false,
    });
    ring.record('ingest', 5);
    expect(ring.measure('topologyBuild', () => 42)).toBe(42);
    expect(ring.getSnapshot().samples).toHaveLength(0);
  });

  it('measure records elapsed duration', () => {
    let t = 100;
    const ring = createRendererTimingRing({
      now: () => t,
      isIsolated: () => true,
      isEnabled: () => true,
    });
    const result = ring.measure('diagnosticsPass', () => {
      t = 107.5;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(ring.getSnapshot().samples).toEqual([
      expect.objectContaining({ name: 'diagnosticsPass', durationMs: 7.5 }),
    ]);
  });

  it('default ring exports work and respect setEnabled', () => {
    recordRendererTiming('other', 1.25);
    expect(getRendererTimingsSnapshot().samples.at(-1)?.durationMs).toBe(1.25);
    setRendererTimingsEnabled(false);
    recordRendererTiming('other', 9);
    expect(measureRendererTiming('ingest', () => 1)).toBe(1);
    expect(getRendererTimingsSnapshot().samples.filter((s) => s.durationMs === 9)).toHaveLength(0);
  });

  it('ignores non-finite or negative durations', () => {
    const ring = createRendererTimingRing({
      now: () => 0,
      isIsolated: () => true,
      isEnabled: () => true,
    });
    ring.record('ingest', Number.NaN);
    ring.record('ingest', -1);
    expect(ring.getSnapshot().samples).toHaveLength(0);
  });

  it('module source does not call Date.now for sample timestamps', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/renderer/lib/rendererTimings.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\bDate\.now\s*\(/);
  });
});
