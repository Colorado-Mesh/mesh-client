import { describe, expect, it } from 'vitest';

import {
  FORECAST_AREA_DEFAULT_RADIUS_M,
  FORECAST_AREA_MAX_RADIUS_M,
  FORECAST_AREA_MIN_RADIUS_M,
  forecastAreaColor,
  forecastAreaRadiusMeters,
  forecastDisplayTemp,
} from './weatherForecastArea';

describe('weatherForecastArea', () => {
  describe('forecastAreaRadiusMeters', () => {
    it('returns default radius when population is null, undefined, or non-positive', () => {
      expect(forecastAreaRadiusMeters(undefined)).toBe(FORECAST_AREA_DEFAULT_RADIUS_M);
      expect(forecastAreaRadiusMeters(null as unknown as number)).toBe(
        FORECAST_AREA_DEFAULT_RADIUS_M,
      );
      expect(forecastAreaRadiusMeters(0)).toBe(FORECAST_AREA_DEFAULT_RADIUS_M);
      expect(forecastAreaRadiusMeters(-500)).toBe(FORECAST_AREA_DEFAULT_RADIUS_M);
      expect(forecastAreaRadiusMeters(NaN)).toBe(FORECAST_AREA_DEFAULT_RADIUS_M);
    });

    it('clamps radius to minimum for small towns', () => {
      expect(forecastAreaRadiusMeters(50)).toBe(FORECAST_AREA_MIN_RADIUS_M);
    });

    it('clamps radius to maximum for large metropolitan areas', () => {
      expect(forecastAreaRadiusMeters(10_000_000)).toBe(FORECAST_AREA_MAX_RADIUS_M);
    });

    it('computes proportional radius for mid-sized cities', () => {
      const radius = forecastAreaRadiusMeters(50_000);
      expect(radius).toBeGreaterThan(FORECAST_AREA_MIN_RADIUS_M);
      expect(radius).toBeLessThan(FORECAST_AREA_MAX_RADIUS_M);
      expect(radius).toBeCloseTo(1_200 * Math.sqrt(50), 1);
    });
  });

  describe('forecastDisplayTemp', () => {
    it('prefers tempValue when present', () => {
      expect(
        forecastDisplayTemp({
          tempValue: 72,
          tempUnit: 'F',
          highLow: { high: 75, low: 55 },
        }),
      ).toEqual({ value: 72, unit: 'F' });
    });

    it('falls back to highLow.high when tempValue is undefined', () => {
      expect(
        forecastDisplayTemp({
          tempUnit: 'C',
          highLow: { high: 24, low: 15 },
        }),
      ).toEqual({ value: 24, unit: 'C' });
    });

    it('defaults unit to F when tempUnit is not specified', () => {
      expect(
        forecastDisplayTemp({
          tempValue: 68,
        }),
      ).toEqual({ value: 68, unit: 'F' });
    });

    it('returns null when no valid temperature exists', () => {
      expect(forecastDisplayTemp({})).toBeNull();
      expect(forecastDisplayTemp({ tempValue: NaN })).toBeNull();
    });
  });

  describe('forecastAreaColor', () => {
    it('returns valid sensor color string for known temperatures', () => {
      const color = forecastAreaColor({ tempValue: 20, tempUnit: 'C' });
      expect(typeof color).toBe('string');
      expect(color.length).toBeGreaterThan(0);
    });

    it('returns neutral color string when temperature is absent', () => {
      const color = forecastAreaColor({});
      expect(typeof color).toBe('string');
      expect(color.length).toBeGreaterThan(0);
    });
  });
});
