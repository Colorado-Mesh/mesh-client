import { describe, expect, it } from 'vitest';

import { haversineKm } from './geoDistance';

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(40, -105, 40, -105)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineKm(40, -105, 41, -104)).toBe(haversineKm(41, -104, 40, -105));
  });

  it('approximates known great-circle distances', () => {
    // Denver (39.7392, -104.9903) to Boulder (40.0150, -105.2705) ≈ 30.3 km.
    const denverToBoulder = haversineKm(39.7392, -104.9903, 40.015, -105.2705);
    expect(denverToBoulder).toBeGreaterThan(20);
    expect(denverToBoulder).toBeLessThan(40);
  });

  it('approximates an antipodal half-earth distance (~20015 km)', () => {
    const halfEarth = haversineKm(0, 0, 0, 180);
    expect(Math.round(halfEarth)).toBe(20015);
  });

  it('handles poles', () => {
    expect(haversineKm(90, 0, -90, 0)).toBeGreaterThan(19900);
    expect(haversineKm(90, 0, 90, 179)).toBeLessThan(1e-10);
  });
});
