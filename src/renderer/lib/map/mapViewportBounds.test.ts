import { describe, expect, it } from 'vitest';

import { boundsFromViewport } from './mapViewportBounds';

describe('boundsFromViewport', () => {
  it('clamps latitude to ±85.05', () => {
    const center = [89, 0];
    const z = 0;
    const result = boundsFromViewport(center as [number, number], z);
    expect(result.north).toBeLessThanOrEqual(85.05);
    expect(result.south).toBeGreaterThanOrEqual(-85.05);
  });

  it('zooms give smaller spans at higher zoom', () => {
    const center: [number, number] = [40, -100];
    const z16 = boundsFromViewport(center, 16);
    const z17 = boundsFromViewport(center, 17);
    expect(z17.east - z17.west).toBeLessThan(z16.east - z16.west);
    expect(z17.north - z17.south).toBeLessThan(z16.north - z16.south);
  });

  it('zooms give larger spans at lower zoom', () => {
    const center: [number, number] = [40, -100];
    const z10 = boundsFromViewport(center, 10);
    const z9 = boundsFromViewport(center, 9);
    expect(z9.east - z9.west).toBeGreaterThan(z10.east - z10.west);
    expect(z9.north - z9.south).toBeGreaterThan(z10.north - z10.south);
  });

  it('handles zoom 0 (world) by clamping latitude only', () => {
    const z0 = boundsFromViewport([0, 0], 0);
    expect(z0.north).toBe(85.05);
    expect(z0.south).toBe(-85.05);
    expect(z0.east).toBe(180);
    expect(z0.west).toBe(-180);
  });

  it('clamps negative latitude', () => {
    const center = [-89, 0];
    const z = 0;
    const result = boundsFromViewport(center as [number, number], z);
    expect(result.north).toBeLessThanOrEqual(85.05);
    expect(result.south).toBeGreaterThanOrEqual(-85.05);
  });
});
