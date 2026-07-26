import { describe, expect, it } from 'vitest';

import { isValidLatLon } from './geoCoords';

describe('isValidLatLon', () => {
  it('accepts WGS84 extremes', () => {
    expect(isValidLatLon(-90, -180)).toBe(true);
    expect(isValidLatLon(90, 180)).toBe(true);
    expect(isValidLatLon(0, 0)).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    expect(isValidLatLon(90.0001, 0)).toBe(false);
    expect(isValidLatLon(-90.0001, 0)).toBe(false);
    expect(isValidLatLon(0, 180.0001)).toBe(false);
    expect(isValidLatLon(0, -180.0001)).toBe(false);
  });

  it('rejects nullish and non-finite values', () => {
    expect(isValidLatLon(null, 0)).toBe(false);
    expect(isValidLatLon(0, undefined)).toBe(false);
    expect(isValidLatLon(NaN, 0)).toBe(false);
    expect(isValidLatLon(0, Infinity)).toBe(false);
  });
});
