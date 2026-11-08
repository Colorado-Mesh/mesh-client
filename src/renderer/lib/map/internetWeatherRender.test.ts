import { describe, expect, it } from 'vitest';

import {
  idwTemperature,
  windArrowDelta,
  windFromDirectionToArrowRad,
} from './internetWeatherRender';

describe('idwTemperature', () => {
  it('returns null with fewer than one point', () => {
    expect(idwTemperature(40, -105, [])).toBeNull();
  });

  it('returns the nearest value when sitting on a sample', () => {
    expect(
      idwTemperature(40, -105, [
        { lat: 40, lon: -105, value: 12 },
        { lat: 41, lon: -104, value: 20 },
      ]),
    ).toBe(12);
  });

  it('blends two distant points', () => {
    const v = idwTemperature(40, -105, [
      { lat: 39, lon: -105, value: 0 },
      { lat: 41, lon: -105, value: 20 },
    ]);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(8);
    expect(v!).toBeLessThan(12);
  });
});

describe('windFromDirectionToArrowRad', () => {
  it('adds 180° so from-north draws toward south (canvas +y down)', () => {
    const rad = windFromDirectionToArrowRad(0);
    const { dx, dy } = windArrowDelta(rad, 10);
    expect(dx).toBeCloseTo(0, 5);
    expect(dy).toBeCloseTo(10, 5);
  });

  it('from-east draws toward west', () => {
    const rad = windFromDirectionToArrowRad(90);
    const { dx, dy } = windArrowDelta(rad, 10);
    expect(dx).toBeCloseTo(-10, 5);
    expect(dy).toBeCloseTo(0, 5);
  });
});
