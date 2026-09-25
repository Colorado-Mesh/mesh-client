import { forward } from 'mgrs';
import { describe, expect, it } from 'vitest';

import {
  estimateMgrsSquareCount,
  mgrsSquaresInBbox,
  mgrsSquareSizeMeters,
  pickMgrsPrecisionForBbox,
} from './mgrsGrid';

const DENVER: [number, number] = [39.7392, -104.9903];

function contains(bounds: [[number, number], [number, number]], lat: number, lon: number) {
  const [[s, w], [n, e]] = bounds;
  return lat >= s - 1e-6 && lat <= n + 1e-6 && lon >= w - 1e-6 && lon <= e + 1e-6;
}

describe('mgrsSquareSizeMeters', () => {
  it('maps precision digits to square size', () => {
    expect(mgrsSquareSizeMeters(0)).toBe(100_000);
    expect(mgrsSquareSizeMeters(1)).toBe(10_000);
    expect(mgrsSquareSizeMeters(5)).toBe(1);
    expect(mgrsSquareSizeMeters(9)).toBe(1);
  });
});

describe('mgrsSquaresInBbox', () => {
  it('covers a small viewport with unique 10 km squares', () => {
    const [lat, lon] = DENVER;
    const squares = mgrsSquaresInBbox(lat - 0.1, lon - 0.1, lat + 0.1, lon + 0.1, 1);
    expect(squares.length).toBeGreaterThan(1);
    expect(squares.length).toBeLessThan(20);
    expect(new Set(squares.map((s) => s.label)).size).toBe(squares.length);
    expect(squares.every((s) => s.label.startsWith('13S'))).toBe(true);

    const here = squares.find((s) => s.label === forward([lon, lat], 1));
    expect(here).toBeDefined();
    expect(contains(here!.bounds, lat, lon)).toBe(true);
  });

  it('includes the square at every corner of the viewport', () => {
    const [lat, lon] = DENVER;
    const s = lat - 0.05;
    const n = lat + 0.05;
    const w = lon - 0.05;
    const e = lon + 0.05;
    const labels = new Set(mgrsSquaresInBbox(s, w, n, e, 2).map((sq) => sq.label));
    for (const [cLat, cLon] of [
      [s, w],
      [s, e],
      [n, w],
      [n, e],
    ] as const) {
      expect(labels.has(forward([cLon, cLat], 2))).toBe(true);
    }
  });

  it('includes squares on both sides of a UTM zone boundary', () => {
    const labels = mgrsSquaresInBbox(39.9, -102.05, 40.0, -101.95, 1).map((s) => s.label);
    expect(labels.some((l) => l.startsWith('13'))).toBe(true);
    expect(labels.some((l) => l.startsWith('14'))).toBe(true);
  });

  it('returns [] when the viewport would exceed the cap', () => {
    expect(mgrsSquaresInBbox(30, -110, 45, -95, 3)).toEqual([]);
    expect(mgrsSquaresInBbox(39, -105, 40, -104, 1, 5)).toEqual([]);
  });

  it('handles antimeridian-crossing viewports', () => {
    const squares = mgrsSquaresInBbox(-17.1, 179.9, -17.0, -179.9, 1);
    const labels = squares.map((s) => s.label);
    expect(labels.some((l) => l.startsWith('60'))).toBe(true);
    expect(labels.some((l) => l.startsWith('1'))).toBe(true);
  });

  it('returns [] for invalid or polar-only viewports', () => {
    expect(mgrsSquaresInBbox(NaN, 0, 1, 1, 1)).toEqual([]);
    expect(mgrsSquaresInBbox(85, 0, 89, 1, 0)).toEqual([]);
    expect(mgrsSquaresInBbox(-89, 0, -85, 1, 0)).toEqual([]);
  });
});

describe('pickMgrsPrecisionForBbox', () => {
  it('chooses finer precision for smaller viewports', () => {
    const [lat, lon] = DENVER;
    const wide = pickMgrsPrecisionForBbox(lat - 2, lon - 2, lat + 2, lon + 2);
    const narrow = pickMgrsPrecisionForBbox(lat - 0.01, lon - 0.01, lat + 0.01, lon + 0.01);
    expect(wide).toBe(0);
    expect(narrow).not.toBeNull();
    expect(narrow!).toBeGreaterThan(wide!);
    expect(
      estimateMgrsSquareCount(lat - 0.01, lon - 0.01, lat + 0.01, lon + 0.01, narrow!),
    ).toBeLessThanOrEqual(400);
  });

  it('returns null for a whole-world viewport', () => {
    expect(pickMgrsPrecisionForBbox(-85, -180, 85, 180)).toBeNull();
  });
});
