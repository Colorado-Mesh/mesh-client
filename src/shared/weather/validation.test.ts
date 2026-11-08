import { describe, expect, it } from 'vitest';

import { clampZoom, isLatLon, isLatLonBounds, normalizeLon, parseWeatherUnits } from './validation';

describe('weather validation', () => {
  it('rejects invalid lat/lon and bounds', () => {
    expect(isLatLon({ lat: Number.NaN, lon: 0 })).toBe(false);
    expect(isLatLon({ lat: 91, lon: 0 })).toBe(false);
    expect(isLatLonBounds({ north: 10, south: 20, east: 1, west: 0 })).toBe(false);
    expect(isLatLonBounds({ north: 10, south: 0, east: 400, west: 0 })).toBe(false);
  });

  it('accepts antimeridian east < west', () => {
    expect(isLatLonBounds({ north: 10, south: -10, east: -170, west: 170 })).toBe(true);
  });

  it('validates unit enums', () => {
    expect(parseWeatherUnits({ temp: 'c', wind: 'kmh', precip: 'mm' })).toEqual({
      temp: 'c',
      wind: 'kmh',
      precip: 'mm',
    });
    expect(parseWeatherUnits({ temp: 'K', wind: 'kmh', precip: 'mm' })).toBeNull();
  });

  it('normalizes lon and clamps zoom', () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(clampZoom(99)).toBe(18);
    expect(clampZoom(-1)).toBe(0);
  });
});
