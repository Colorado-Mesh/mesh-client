import { describe, expect, it } from 'vitest';

import { polylineLengthKm, polylineSegmentsKm } from './measureMath';

describe('polylineLengthKm', () => {
  it('returns 0 for fewer than two points', () => {
    expect(polylineLengthKm([])).toBe(0);
    expect(polylineLengthKm([[40, -105]])).toBe(0);
  });

  it('sums haversine segments', () => {
    // 1° of latitude ≈ 111.19 km on a 6371 km sphere
    const km = polylineLengthKm([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(km).toBeCloseTo(222.39, 1);
  });

  it('matches a known city pair (Denver → Boulder ≈ 39 km)', () => {
    const km = polylineLengthKm([
      [39.7392, -104.9903],
      [40.015, -105.2705],
    ]);
    expect(km).toBeGreaterThan(38);
    expect(km).toBeLessThan(40);
  });

  it('treats invalid segments as zero length', () => {
    expect(
      polylineSegmentsKm([
        [0, 0],
        [NaN, 0],
        [1, 0],
      ]),
    ).toEqual([0, 0]);
  });
});
