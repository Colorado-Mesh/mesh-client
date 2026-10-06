import type { WeatherForecastEntry } from '../stores/weatherForecastStore';
import { sensorColorForValue } from './environmentSensorDisplay';
import { forecastTempCelsius, type WeatherTempUnit } from './weatherForecastParse';

export const FORECAST_AREA_MIN_RADIUS_M = 3_000;
export const FORECAST_AREA_MAX_RADIUS_M = 25_000;
/** Radius when population is unknown (requester / sender-located forecasts). */
export const FORECAST_AREA_DEFAULT_RADIUS_M = 8_000;

/**
 * Approximate area a city forecast covers, from population: about 1.2 km × √(pop / 1000),
 * clamped so villages stay visible and metros do not swallow neighbors.
 */
export function forecastAreaRadiusMeters(population: number | undefined): number {
  if (population == null || !Number.isFinite(population) || population <= 0) {
    return FORECAST_AREA_DEFAULT_RADIUS_M;
  }
  const radius = 1_200 * Math.sqrt(population / 1_000);
  return Math.min(FORECAST_AREA_MAX_RADIUS_M, Math.max(FORECAST_AREA_MIN_RADIUS_M, radius));
}

/** Temperature shown on the map label: the period temperature, else the high. */
export function forecastDisplayTemp(
  entry: Pick<WeatherForecastEntry, 'tempValue' | 'tempUnit' | 'highLow'>,
): { value: number; unit: WeatherTempUnit } | null {
  const value = entry.tempValue ?? entry.highLow?.high;
  if (value == null || !Number.isFinite(value)) return null;
  return { value, unit: entry.tempUnit ?? 'F' };
}

/** Area color on the shared sensor temperature ramp; neutral when no temperature is known. */
export function forecastAreaColor(
  entry: Pick<WeatherForecastEntry, 'tempValue' | 'tempUnit' | 'highLow'>,
): string {
  const temp = forecastDisplayTemp(entry);
  const celsius = temp ? forecastTempCelsius({ tempValue: temp.value, tempUnit: temp.unit }) : null;
  return sensorColorForValue('temperature', celsius ?? undefined);
}
