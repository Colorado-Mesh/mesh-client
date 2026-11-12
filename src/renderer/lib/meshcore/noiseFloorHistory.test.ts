import { describe, expect, it } from 'vitest';

import {
  aggregateNoiseFloorSamples,
  appendNoiseFloorSample,
  isValidNoiseFloorReading,
  NOISE_FLOOR_HISTORY_MAX_POINTS,
  NOISE_FLOOR_SAMPLE_DEDUP_MS,
  type NoiseFloorSample,
  noiseFloorSparklinePoints,
} from './noiseFloorHistory';

describe('noiseFloorHistory', () => {
  it('treats zero as a valid reading and rejects non-finite values', () => {
    expect(isValidNoiseFloorReading(0)).toBe(true);
    expect(isValidNoiseFloorReading(-112)).toBe(true);
    expect(isValidNoiseFloorReading(Number.NaN)).toBe(false);
    expect(isValidNoiseFloorReading(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidNoiseFloorReading(undefined)).toBe(false);
  });

  it('aggregates min/max/last and returns null for an empty series', () => {
    expect(aggregateNoiseFloorSamples([])).toBeNull();
    const samples: NoiseFloorSample[] = [
      { t: 1, noiseFloor: 0 },
      { t: 2, noiseFloor: -100 },
      { t: 3, noiseFloor: -90 },
    ];
    expect(aggregateNoiseFloorSamples(samples)).toEqual({
      min: -100,
      max: 0,
      last: -90,
      count: 3,
    });
  });

  it('appends, dedupes identical consecutive samples, and caps length', () => {
    const first = appendNoiseFloorSample([], { t: 1_000, noiseFloor: -110 });
    expect(first).toHaveLength(1);
    expect(
      appendNoiseFloorSample(first!, {
        t: 1_000 + NOISE_FLOOR_SAMPLE_DEDUP_MS - 1,
        noiseFloor: -110,
      }),
    ).toBeNull();
    const second = appendNoiseFloorSample(first!, {
      t: 1_000 + NOISE_FLOOR_SAMPLE_DEDUP_MS,
      noiseFloor: -110,
    });
    expect(second).toHaveLength(2);

    let series: readonly NoiseFloorSample[] = [];
    for (let i = 0; i < NOISE_FLOOR_HISTORY_MAX_POINTS + 5; i++) {
      const next = appendNoiseFloorSample(
        series,
        { t: 10_000 + i * NOISE_FLOOR_SAMPLE_DEDUP_MS, noiseFloor: -100 - (i % 3) },
        { nowMs: 10_000 + i * NOISE_FLOOR_SAMPLE_DEDUP_MS },
      );
      expect(next).not.toBeNull();
      series = next!;
    }
    expect(series.length).toBe(NOISE_FLOOR_HISTORY_MAX_POINTS);
  });

  it('builds sparkline points only when at least two samples exist', () => {
    expect(noiseFloorSparklinePoints([{ t: 0, noiseFloor: -110 }])).toBeNull();
    expect(
      noiseFloorSparklinePoints([
        { t: 0, noiseFloor: -120 },
        { t: 100, noiseFloor: -100 },
      ]),
    ).toBe('0.0,38.0 200.0,2.0');
  });
});
