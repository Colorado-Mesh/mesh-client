import { describe, expect, it } from 'vitest';

import type { TerrainFrequencyMhz } from './profileMath';
import {
  computeTerrainClearance,
  earthBulgeM,
  fresnelRadiusM,
  interpolateLatLon,
  losHeightM,
  sampleGreatCirclePoints,
  wavelengthM,
} from './profileMath';

describe('wavelengthM', () => {
  it('returns lambda = c / f for each supported band', () => {
    expect(wavelengthM(433)).toBeCloseTo(0.692, 2);
    expect(wavelengthM(868)).toBeCloseTo(0.345, 2);
    expect(wavelengthM(915)).toBeCloseTo(0.328, 2);
  });
});

describe('fresnelRadiusM', () => {
  it('is zero when the path length or offsets are invalid', () => {
    expect(fresnelRadiusM(915, 0, 0)).toBe(0);
    expect(fresnelRadiusM(915, 100, 0)).toBe(0);
    expect(fresnelRadiusM(915, 100, 50)).toBe(0);
    expect(fresnelRadiusM(915, -10, 100)).toBe(0);
  });

  it('is largest at the path midpoint', () => {
    const mid = fresnelRadiusM(915, 500, 1000);
    const quarter = fresnelRadiusM(915, 250, 1000);
    expect(mid).toBeGreaterThan(quarter);
  });
});

describe('earthBulgeM', () => {
  it('is zero for invalid inputs', () => {
    expect(earthBulgeM(0, 1000)).toBe(0);
    expect(earthBulgeM(1000, 1000)).toBe(0);
    expect(earthBulgeM(500, 0)).toBe(0);
    expect(earthBulgeM(-10, 1000)).toBe(0);
  });

  it('is largest at the midpoint', () => {
    expect(earthBulgeM(500, 1000)).toBeGreaterThan(earthBulgeM(100, 1000));
  });
});

describe('losHeightM', () => {
  it('interpolates antenna heights along the path', () => {
    expect(losHeightM(0, 1000, 1000, 1000, 10, 20)).toBe(1010);
    expect(losHeightM(1000, 1000, 1000, 1000, 10, 20)).toBe(1020);
    expect(losHeightM(500, 1000, 1000, 1000, 10, 20)).toBe(1015);
  });

  it('clamps t to [0, 1]', () => {
    expect(losHeightM(-100, 1000, 1000, 1000, 10, 20)).toBe(1010);
    expect(losHeightM(2000, 1000, 1000, 1000, 10, 20)).toBe(1020);
  });

  it('returns start antenna height for zero path length', () => {
    expect(losHeightM(0, 0, 1000, 1000, 10, 20)).toBe(1010);
  });
});

describe('interpolateLatLon', () => {
  it('lerps each coordinate independently', () => {
    expect(interpolateLatLon([0, 0], [10, 20], 0.5)).toEqual([5, 10]);
    expect(interpolateLatLon([0, 0], [10, 20], 0)).toEqual([0, 0]);
    expect(interpolateLatLon([0, 0], [10, 20], 1)).toEqual([10, 20]);
  });
});

describe('sampleGreatCirclePoints', () => {
  it('returns [] for fewer than 2 samples or non-finite inputs', () => {
    expect(sampleGreatCirclePoints([0, 0], [1, 1], 1)).toEqual([]);
    expect(sampleGreatCirclePoints([NaN, 0], [1, 1], 3)).toEqual([]);
    expect(sampleGreatCirclePoints([0, 0], [Infinity, 1], 3)).toEqual([]);
  });

  it('spaces points along the great circle with distance from start', () => {
    const pts = sampleGreatCirclePoints([0, 0], [0, 10], 3);
    expect(pts).toHaveLength(3);
    const distancesM = pts.map((p) => p.distanceM);
    expect(distancesM[0]).toBe(0);
    expect(Math.max(...distancesM)).toBeGreaterThan(0);
    expect(pts.every((p) => p.lat === 0)).toBe(true);
  });
});

describe('computeTerrainClearance', () => {
  const freq = 915 as TerrainFrequencyMhz;

  it('returns unknown for fewer than 2 samples', () => {
    expect(
      computeTerrainClearance({
        distancesM: [0],
        elevationsM: [100],
        frequencyMhz: freq,
        antennaHeightStartM: 2,
        antennaHeightEndM: 2,
      }).clearance,
    ).toBe('unknown');
  });

  it('returns unknown when start or end elevation is missing', () => {
    const r = computeTerrainClearance({
      distancesM: [0, 500, 1000],
      elevationsM: [100, null, 100],
      frequencyMhz: freq,
      antennaHeightStartM: 2,
      antennaHeightEndM: 2,
    });
    expect(r.clearance).toBe('unknown');
  });

  it('returns clear when every sample is above the terrain', () => {
    const r = computeTerrainClearance({
      distancesM: [0, 500, 1000],
      elevationsM: [100, 100, 100],
      frequencyMhz: freq,
      antennaHeightStartM: 1000,
      antennaHeightEndM: 1000,
    });
    expect(r.clearance).toBe('clear');
    expect(r.minClearanceM).toBeGreaterThan(0);
    expect(r.samples).toHaveLength(3);
  });

  it('returns obstructed when terrain clears the line of sight', () => {
    const r = computeTerrainClearance({
      distancesM: [0, 500, 1000],
      elevationsM: [100, 2000, 100],
      frequencyMhz: freq,
      antennaHeightStartM: 10,
      antennaHeightEndM: 10,
    });
    expect(r.clearance).toBe('obstructed');
    expect(r.minClearanceM).toBeLessThan(0);
  });

  it('fills null fields when elevation is missing', () => {
    const r = computeTerrainClearance({
      distancesM: [0, 500],
      elevationsM: [null, null],
      frequencyMhz: freq,
      antennaHeightStartM: 10,
      antennaHeightEndM: 10,
    });
    expect(r.clearance).toBe('unknown');
    expect(r.minClearanceM).toBeNull();
    for (const s of r.samples) {
      expect(s.effectiveElevationM).toBeNull();
      expect(s.losHeightM).toBeNull();
      expect(s.fresnelRadiusM).toBeNull();
      expect(s.clearanceM).toBeNull();
    }
  });
});
