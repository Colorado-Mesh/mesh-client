import { describe, expect, it } from 'vitest';

import {
  celsiusToFahrenheit,
  convertPrecip,
  convertTemp,
  convertWind,
  fahrenheitToCelsius,
  mmToInches,
  msToKmh,
  msToKnots,
  msToMph,
  roundDisplay,
} from './units';

describe('weather units', () => {
  it('round-trips C↔F', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(fahrenheitToCelsius(32)).toBe(0);
    expect(roundDisplay(fahrenheitToCelsius(celsiusToFahrenheit(20)), 5)).toBe(20);
  });

  it('converts wind and precip', () => {
    expect(msToKmh(1)).toBeCloseTo(3.6);
    expect(msToMph(1)).toBeCloseTo(2.2369, 3);
    expect(msToKnots(1)).toBeCloseTo(1.9438, 3);
    expect(mmToInches(25.4)).toBeCloseTo(1);
  });

  it('returns null for non-finite inputs', () => {
    expect(convertTemp(null, 'c')).toBeNull();
    expect(convertTemp(Number.NaN, 'f')).toBeNull();
    expect(convertWind(Infinity, 'kmh')).toBeNull();
    expect(convertPrecip(undefined, 'mm')).toBeNull();
  });

  it('does not mutate stored SI when converting for display', () => {
    const stored = 10;
    expect(convertTemp(stored, 'f')).toBe(50);
    expect(stored).toBe(10);
    expect(roundDisplay(convertWind(10, 'kmh')!, 1)).toBe(36);
    expect(stored).toBe(10);
  });
});
