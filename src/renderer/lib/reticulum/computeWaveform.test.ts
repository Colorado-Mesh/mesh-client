import { describe, expect, it } from 'vitest';

import { computeWaveform } from './computeWaveform';

describe('computeWaveform', () => {
  it('returns barCount zeros for empty samples', () => {
    expect(computeWaveform(new Float32Array(0), 10)).toEqual(new Array<number>(10).fill(0));
  });

  it('returns barCount zeros when barCount is 0', () => {
    expect(computeWaveform(new Float32Array([0.5, -0.5]), 0)).toEqual([]);
  });

  it('returns normalized values in [0, 1] for non-silent input', () => {
    // Alternating peak pattern
    const samples = new Float32Array(80);
    for (let i = 0; i < 80; i++) samples[i] = i % 2 === 0 ? 1.0 : -0.5;
    const bars = computeWaveform(samples, 10);
    expect(bars).toHaveLength(10);
    for (const b of bars) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
    // Max bar should be 1 after normalization
    expect(Math.max(...bars)).toBeCloseTo(1, 5);
  });

  it('returns zeros for all-zero samples', () => {
    const bars = computeWaveform(new Float32Array(100), 5);
    expect(bars).toEqual([0, 0, 0, 0, 0]);
  });

  it('handles fewer samples than barCount', () => {
    const samples = new Float32Array([1, 0, 0.5]);
    const bars = computeWaveform(samples, 10);
    expect(bars).toHaveLength(10);
    expect(bars.every((b) => b >= 0 && b <= 1)).toBe(true);
  });
});
