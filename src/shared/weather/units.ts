import type { WeatherPrecipUnit, WeatherTempUnit, WeatherWindUnit } from './types';

export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

export function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

export function msToKmh(v: number): number {
  return v * 3.6;
}

export function msToMph(v: number): number {
  return v * 2.2369362921;
}

export function msToKnots(v: number): number {
  return v * 1.9438444924;
}

export function mmToInches(v: number): number {
  return v / 25.4;
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

export function convertTemp(
  celsius: number | null | undefined,
  unit: WeatherTempUnit,
): number | null {
  const c = finiteOrNull(celsius);
  if (c == null) return null;
  return unit === 'f' ? celsiusToFahrenheit(c) : c;
}

export function convertWind(ms: number | null | undefined, unit: WeatherWindUnit): number | null {
  const v = finiteOrNull(ms);
  if (v == null) return null;
  if (unit === 'kmh') return msToKmh(v);
  if (unit === 'mph') return msToMph(v);
  if (unit === 'kn') return msToKnots(v);
  return v;
}

export function convertPrecip(
  mm: number | null | undefined,
  unit: WeatherPrecipUnit,
): number | null {
  const v = finiteOrNull(mm);
  if (v == null) return null;
  return unit === 'in' ? mmToInches(v) : v;
}

export function tempUnitLabel(unit: WeatherTempUnit): '°C' | '°F' {
  return unit === 'f' ? '°F' : '°C';
}

export function windUnitLabelKey(unit: WeatherWindUnit): string {
  if (unit === 'mph') return 'internetWeather.unitMph';
  if (unit === 'ms') return 'internetWeather.unitMs';
  if (unit === 'kn') return 'internetWeather.unitKn';
  return 'internetWeather.unitKmh';
}

export function precipUnitLabelKey(unit: WeatherPrecipUnit): string {
  return unit === 'in' ? 'internetWeather.unitIn' : 'internetWeather.unitMm';
}

/** Round only at display time. */
export function roundDisplay(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
