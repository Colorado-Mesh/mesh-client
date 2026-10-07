import { describe, expect, it } from 'vitest';

import type { OurPositionReference } from './locationTrust';
import { nodeBearingRange } from './nodeBearingRange';

const trusted: OurPositionReference = {
  lat: 39.7,
  lon: -105.0,
  source: 'device',
  trust: 'trusted',
};
const northNode = { latitude: 40.0, longitude: -105.0 };

describe('nodeBearingRange', () => {
  it('returns bearing and distance in miles from a trusted origin', () => {
    const result = nodeBearingRange(trusted, northNode, undefined, 'miles', 'en');
    expect(result?.bearing).toBe('000°');
    expect(result?.distance).toMatch(/^20\.7 mi$/);
  });

  it('formats kilometres when the unit setting is km', () => {
    const result = nodeBearingRange(trusted, northNode, undefined, 'km', 'en');
    expect(result?.distance).toMatch(/^33\.4 km$/);
  });

  it('falls back to the newest tracked point when the node has no position', () => {
    const result = nodeBearingRange(
      trusted,
      { latitude: null, longitude: null },
      [
        { t: 1, lat: 39.7, lon: -104.0 },
        { t: 2, lat: 39.7, lon: -104.9 },
      ],
      'km',
      'en',
    );
    expect(result?.bearing).toBe('090°');
    expect(result?.distance).toMatch(/km$/);
  });

  it.each(['needsConfirm', 'approximate', 'unknown'] as const)(
    'returns null when origin trust is %s',
    (trust) => {
      expect(nodeBearingRange({ ...trusted, trust }, northNode, undefined, 'km')).toBeNull();
    },
  );

  it('returns null without an origin or a node position', () => {
    expect(nodeBearingRange(null, northNode, undefined, 'km')).toBeNull();
    expect(nodeBearingRange(trusted, { latitude: 0, longitude: 0 }, undefined, 'km')).toBeNull();
  });
});
