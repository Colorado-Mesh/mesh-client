import type { WeatherPrecipUnit, WeatherTempUnit, WeatherUnits, WeatherWindUnit } from './types';

export const WEATHER_GRID_MAX_POINTS = 64;
export const WEATHER_GRID_MIN_STEP_DEG = 0.05;
export const WEATHER_GRID_MAX_STEP_DEG = 10;
export const WEATHER_JSON_MAX_BYTES = 2 * 1024 * 1024;
export const WEATHER_TILE_MAX_BYTES = 2 * 1024 * 1024;
export const WEATHER_RADAR_MAX_ZOOM = 18;
export const WEATHER_MAX_LAT = 90;
export const WEATHER_MAX_LON = 180;

export interface LatLonBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isLatLon(value: unknown): value is { lat: number; lon: number } {
  if (value == null || typeof value !== 'object') return false;
  const v = value as { lat?: unknown; lon?: unknown };
  return (
    isFiniteNumber(v.lat) &&
    isFiniteNumber(v.lon) &&
    Math.abs(v.lat) <= WEATHER_MAX_LAT &&
    Math.abs(v.lon) <= WEATHER_MAX_LON
  );
}

export function isLatLonBounds(value: unknown): value is LatLonBounds {
  if (value == null || typeof value !== 'object') return false;
  const v = value as Partial<LatLonBounds>;
  if (
    !isFiniteNumber(v.north) ||
    !isFiniteNumber(v.south) ||
    !isFiniteNumber(v.east) ||
    !isFiniteNumber(v.west)
  ) {
    return false;
  }
  if (Math.abs(v.north) > WEATHER_MAX_LAT || Math.abs(v.south) > WEATHER_MAX_LAT) return false;
  if (Math.abs(v.east) > 360 || Math.abs(v.west) > 360) return false;
  if (v.north < v.south) return false;
  return true;
}

const TEMP_UNITS = new Set<WeatherTempUnit>(['c', 'f']);
const WIND_UNITS = new Set<WeatherWindUnit>(['kmh', 'mph', 'ms', 'kn']);
const PRECIP_UNITS = new Set<WeatherPrecipUnit>(['mm', 'in']);

export function parseWeatherUnits(value: unknown): WeatherUnits | null {
  if (value == null || typeof value !== 'object') return null;
  const v = value as Partial<WeatherUnits>;
  if (
    typeof v.temp !== 'string' ||
    typeof v.wind !== 'string' ||
    typeof v.precip !== 'string' ||
    !TEMP_UNITS.has(v.temp) ||
    !WIND_UNITS.has(v.wind) ||
    !PRECIP_UNITS.has(v.precip)
  ) {
    return null;
  }
  return {
    temp: v.temp,
    wind: v.wind,
    precip: v.precip,
  };
}

export function clampGridStep(stepDeg: number): number {
  if (!Number.isFinite(stepDeg)) return WEATHER_GRID_MAX_STEP_DEG;
  return Math.min(WEATHER_GRID_MAX_STEP_DEG, Math.max(WEATHER_GRID_MIN_STEP_DEG, stepDeg));
}

export function clampLat(lat: number): number {
  return Math.min(WEATHER_MAX_LAT, Math.max(-WEATHER_MAX_LAT, lat));
}

/** Normalize longitude into [-180, 180]. */
export function normalizeLon(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 0;
  return Math.min(WEATHER_RADAR_MAX_ZOOM, Math.max(0, Math.floor(zoom)));
}

export function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
