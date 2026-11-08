import { describe, expect, it } from 'vitest';

import {
  computeTerrainClearance,
  fresnelRadiusM,
  interpolateLatLon,
  sampleGreatCirclePoints,
  wavelengthM,
} from './terrainProfileMath';

describe('wavelengthM', () => {
  it('matches LoRa ISM bands', () => {
    expect(wavelengthM(915)).toBeCloseTo(0.3276, 3);
    expect(wavelengthM(868)).toBeCloseTo(0.3454, 3);
    expect(wavelengthM(433)).toBeCloseTo(0.6924, 3);
  });
});

describe('fresnelRadiusM', () => {
  it('is zero at endpoints', () => {
    expect(fresnelRadiusM(915, 0, 10_000)).toBe(0);
    expect(fresnelRadiusM(915, 10_000, 10_000)).toBe(0);
  });

  it('peaks near mid-path', () => {
    const mid = fresnelRadiusM(915, 5_000, 10_000);
    const quarter = fresnelRadiusM(915, 2_500, 10_000);
    expect(mid).toBeGreaterThan(quarter);
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(30);
  });

  it('grows with lower frequency', () => {
    expect(fresnelRadiusM(433, 5_000, 10_000)).toBeGreaterThan(fresnelRadiusM(915, 5_000, 10_000));
  });
});

describe('sampleGreatCirclePoints', () => {
  it('returns empty for count < 2', () => {
    expect(sampleGreatCirclePoints([0, 0], [1, 0], 1)).toEqual([]);
  });

  it('includes endpoints and midpoints', () => {
    const pts = sampleGreatCirclePoints([0, 0], [1, 0], 3);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toMatchObject({ lat: 0, lon: 0, distanceM: 0 });
    expect(pts[2]?.lat).toBeCloseTo(1, 5);
    expect(pts[1]?.distanceM).toBeCloseTo((pts[2]?.distanceM ?? 0) / 2, 5);
  });
});

describe('interpolateLatLon', () => {
  it('lerps endpoints', () => {
    expect(interpolateLatLon([0, 0], [10, 20], 0.5)).toEqual([5, 10]);
  });
});

describe('computeTerrainClearance', () => {
  it('returns unknown when endpoint elevations missing', () => {
    const result = computeTerrainClearance({
      distancesM: [0, 5000, 10000],
      elevationsM: [null, 100, null],
      frequencyMhz: 915,
      antennaHeightStartM: 2,
      antennaHeightEndM: 2,
    });
    expect(result.clearance).toBe('unknown');
    expect(result.minClearanceM).toBeNull();
  });

  it('marks flat terrain with tall enough antennas as clear', () => {
    const result = computeTerrainClearance({
      distancesM: [0, 5000, 10000],
      elevationsM: [100, 100, 100],
      frequencyMhz: 915,
      // Mid-path first Fresnel radius ≈ 14 m on a 10 km 915 MHz link.
      antennaHeightStartM: 20,
      antennaHeightEndM: 20,
    });
    expect(result.clearance).toBe('clear');
    expect(result.minClearanceM).toBeGreaterThan(0);
  });

  it('marks a mid-path mountain as obstructed', () => {
    const result = computeTerrainClearance({
      distancesM: [0, 5000, 10000],
      elevationsM: [100, 500, 100],
      frequencyMhz: 915,
      antennaHeightStartM: 2,
      antennaHeightEndM: 2,
    });
    expect(result.clearance).toBe('obstructed');
    expect(result.minClearanceM).toBeLessThan(0);
  });
});
