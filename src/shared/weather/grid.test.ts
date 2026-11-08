import { describe, expect, it } from 'vitest';

import { buildGridCells, chooseGridStep, weatherPointCacheKey } from './grid';
import { WEATHER_GRID_MAX_POINTS } from './validation';

describe('weather grid', () => {
  it('keeps point count at or below the max', () => {
    const bounds = { north: 60, south: 20, east: 40, west: -40 };
    const step = chooseGridStep(bounds, 8);
    const cells = buildGridCells({
      bounds,
      zoom: 8,
      stepDeg: step,
      maxPoints: WEATHER_GRID_MAX_POINTS,
    });
    expect(cells.length).toBeLessThanOrEqual(WEATHER_GRID_MAX_POINTS);
    expect(cells.length).toBeGreaterThan(0);
  });

  it('handles antimeridian viewports', () => {
    const bounds = { north: 20, south: -20, east: -170, west: 170 };
    const step = chooseGridStep(bounds, 6);
    const cells = buildGridCells({
      bounds,
      zoom: 6,
      stepDeg: step,
      maxPoints: WEATHER_GRID_MAX_POINTS,
    });
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.lon).toBeGreaterThanOrEqual(-180);
      expect(c.lon).toBeLessThanOrEqual(180);
    }
  });

  it('clamps high latitudes', () => {
    const bounds = { north: 89, south: 80, east: 10, west: -10 };
    const cells = buildGridCells({
      bounds,
      zoom: 4,
      stepDeg: 2,
      maxPoints: WEATHER_GRID_MAX_POINTS,
    });
    for (const c of cells) {
      expect(c.lat).toBeLessThanOrEqual(85);
    }
  });

  it('deduplicates and orders deterministically', () => {
    const bounds = { north: 48, south: 47, east: -121, west: -122 };
    const a = buildGridCells({ bounds, zoom: 10, stepDeg: 0.25, maxPoints: 64 });
    const b = buildGridCells({ bounds, zoom: 10, stepDeg: 0.25, maxPoints: 64 });
    expect(a).toEqual(b);
    const keys = a.map((c) => `${c.lat},${c.lon}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('rounds cache keys to two decimals', () => {
    expect(weatherPointCacheKey(47.6062, -122.3321)).toBe('47.61,-122.33');
  });

  it('covers the full latitude span when capped instead of truncating northern rows', () => {
    const bounds = { north: 60, south: 20, east: 40, west: -40 };
    const cells = buildGridCells({
      bounds,
      zoom: 10,
      stepDeg: 0.25,
      maxPoints: WEATHER_GRID_MAX_POINTS,
    });
    expect(cells.length).toBeLessThanOrEqual(WEATHER_GRID_MAX_POINTS);
    const lats = cells.map((c) => c.lat);
    // Even subsample keeps edges — not only the southern rows of a south→north walk.
    expect(Math.min(...lats)).toBeLessThanOrEqual(bounds.south + 0.5);
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(bounds.north - 0.5);
  });
});
