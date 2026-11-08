import { type GridCell, weatherPointCacheKey } from '@/shared/weather/grid';
import { OPEN_METEO_FORECAST_URL } from '@/shared/weather/radarProviders';
import type {
  WeatherCurrent,
  WeatherDailyPoint,
  WeatherGridPoint,
  WeatherHourlyPoint,
  WeatherPointForecast,
} from '@/shared/weather/types';
import { WEATHER_JSON_MAX_BYTES } from '@/shared/weather/validation';

import {
  fetchBounded,
  WEATHER_JSON_TIMEOUT_MS,
  type WeatherFetchDeps,
  weatherUserAgent,
} from './http';

export interface OpenMeteoDeps extends WeatherFetchDeps {
  getAppVersion: () => string;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseCurrent(raw: unknown): WeatherCurrent | null {
  if (raw == null || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const timeSec = num(c.time);
  return {
    timeMs: timeSec != null ? timeSec * 1000 : Date.now(),
    temperatureC: num(c.temperature_2m),
    apparentTemperatureC: num(c.apparent_temperature),
    relativeHumidityPct: num(c.relative_humidity_2m),
    precipitationMm: num(c.precipitation),
    weatherCode: num(c.weather_code),
    cloudCoverPct: num(c.cloud_cover),
    pressureHpa: num(c.pressure_msl),
    visibilityM: num(c.visibility),
    windSpeedMs: num(c.wind_speed_10m),
    windDirectionDeg: num(c.wind_direction_10m),
    windGustMs: num(c.wind_gusts_10m),
    isDay: typeof c.is_day === 'number' ? c.is_day === 1 : null,
  };
}

function parseHourly(raw: unknown): WeatherHourlyPoint[] {
  if (raw == null || typeof raw !== 'object') return [];
  const h = raw as Record<string, unknown>;
  const times = Array.isArray(h.time) ? h.time : [];
  const out: WeatherHourlyPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = num(times[i]);
    if (t == null) continue;
    out.push({
      timeMs: t * 1000,
      temperatureC: num(Array.isArray(h.temperature_2m) ? h.temperature_2m[i] : null),
      apparentTemperatureC: num(
        Array.isArray(h.apparent_temperature) ? h.apparent_temperature[i] : null,
      ),
      precipitationMm: num(Array.isArray(h.precipitation) ? h.precipitation[i] : null),
      precipitationProbabilityPct: num(
        Array.isArray(h.precipitation_probability) ? h.precipitation_probability[i] : null,
      ),
      weatherCode: num(Array.isArray(h.weather_code) ? h.weather_code[i] : null),
      windSpeedMs: num(Array.isArray(h.wind_speed_10m) ? h.wind_speed_10m[i] : null),
      windDirectionDeg: num(Array.isArray(h.wind_direction_10m) ? h.wind_direction_10m[i] : null),
      windGustMs: num(Array.isArray(h.wind_gusts_10m) ? h.wind_gusts_10m[i] : null),
    });
  }
  return out;
}

function parseDaily(raw: unknown): WeatherDailyPoint[] {
  if (raw == null || typeof raw !== 'object') return [];
  const d = raw as Record<string, unknown>;
  const times = Array.isArray(d.time) ? d.time : [];
  const out: WeatherDailyPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const dateIso = typeof times[i] === 'string' ? (times[i] as string) : null;
    if (!dateIso) continue;
    out.push({
      dateIso,
      temperatureMaxC: num(Array.isArray(d.temperature_2m_max) ? d.temperature_2m_max[i] : null),
      temperatureMinC: num(Array.isArray(d.temperature_2m_min) ? d.temperature_2m_min[i] : null),
      precipitationSumMm: num(Array.isArray(d.precipitation_sum) ? d.precipitation_sum[i] : null),
      precipitationProbabilityMaxPct: num(
        Array.isArray(d.precipitation_probability_max) ? d.precipitation_probability_max[i] : null,
      ),
      windSpeedMaxMs: num(Array.isArray(d.wind_speed_10m_max) ? d.wind_speed_10m_max[i] : null),
      windGustMaxMs: num(Array.isArray(d.wind_gusts_10m_max) ? d.wind_gusts_10m_max[i] : null),
      weatherCode: num(Array.isArray(d.weather_code) ? d.weather_code[i] : null),
      sunriseIso:
        typeof (Array.isArray(d.sunrise) ? d.sunrise[i] : null) === 'string'
          ? (d.sunrise as string[])[i]
          : null,
      sunsetIso:
        typeof (Array.isArray(d.sunset) ? d.sunset[i] : null) === 'string'
          ? (d.sunset as string[])[i]
          : null,
    });
  }
  return out;
}

function parseForecastObject(
  raw: Record<string, unknown>,
  fetchedAtMs: number,
): WeatherPointForecast {
  return {
    provider: 'open-meteo',
    latitude: num(raw.latitude) ?? 0,
    longitude: num(raw.longitude) ?? 0,
    elevationM: num(raw.elevation),
    timezone: typeof raw.timezone === 'string' ? raw.timezone : 'GMT',
    utcOffsetSeconds: num(raw.utc_offset_seconds) ?? 0,
    fetchedAtMs,
    current: parseCurrent(raw.current),
    hourly: parseHourly(raw.hourly),
    daily: parseDaily(raw.daily),
  };
}

export async function fetchPointForecast(
  lat: number,
  lon: number,
  deps: OpenMeteoDeps,
): Promise<WeatherPointForecast | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current:
      'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day',
    hourly:
      'temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    daily:
      'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,weather_code,sunrise,sunset',
    forecast_days: '7',
    forecast_hours: '48',
    timezone: 'auto',
    timeformat: 'unixtime',
    temperature_unit: 'celsius',
    wind_speed_unit: 'ms',
    precipitation_unit: 'mm',
  });
  const url = `${OPEN_METEO_FORECAST_URL}?${params.toString()}`;
  const result = await fetchBounded(url, {
    timeoutMs: WEATHER_JSON_TIMEOUT_MS,
    maxBytes: WEATHER_JSON_MAX_BYTES,
    accept: 'application/json',
    userAgent: weatherUserAgent(deps.getAppVersion()),
    deps,
  });
  if (!result) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body.toString('utf8'));
  } catch {
    // catch-no-log-ok invalid JSON → treat as provider miss
    return null;
  }
  const obj: unknown = Array.isArray(parsed) ? (parsed as unknown[])[0] : parsed;
  if (obj == null || typeof obj !== 'object') return null;
  const now = deps.now?.() ?? Date.now();
  return parseForecastObject(obj as Record<string, unknown>, now);
}

function parseGridPoint(raw: Record<string, unknown>, fallback: GridCell): WeatherGridPoint {
  const current =
    raw.current != null && typeof raw.current === 'object'
      ? (raw.current as Record<string, unknown>)
      : {};
  return {
    latitude: num(raw.latitude) ?? fallback.lat,
    longitude: num(raw.longitude) ?? fallback.lon,
    temperatureC: num(current.temperature_2m),
    windSpeedMs: num(current.wind_speed_10m),
    windDirectionDeg: num(current.wind_direction_10m),
    windGustMs: num(current.wind_gusts_10m),
    precipitationMm: num(current.precipitation),
    weatherCode: num(current.weather_code),
  };
}

export async function fetchGrid(
  cells: readonly GridCell[],
  deps: OpenMeteoDeps,
): Promise<{ points: WeatherGridPoint[]; fetchedAtMs: number; partial: boolean } | null> {
  if (cells.length === 0) {
    return { points: [], fetchedAtMs: deps.now?.() ?? Date.now(), partial: false };
  }
  const params = new URLSearchParams({
    latitude: cells.map((c) => c.lat.toFixed(2)).join(','),
    longitude: cells.map((c) => c.lon.toFixed(2)).join(','),
    current:
      'temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    timezone: 'GMT',
    temperature_unit: 'celsius',
    wind_speed_unit: 'ms',
    precipitation_unit: 'mm',
    cell_selection: 'land',
  });
  const url = `${OPEN_METEO_FORECAST_URL}?${params.toString()}`;
  const result = await fetchBounded(url, {
    timeoutMs: WEATHER_JSON_TIMEOUT_MS,
    maxBytes: WEATHER_JSON_MAX_BYTES,
    accept: 'application/json',
    userAgent: weatherUserAgent(deps.getAppVersion()),
    deps,
  });
  if (!result) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.body.toString('utf8'));
  } catch {
    // catch-no-log-ok invalid JSON → treat as provider miss
    return null;
  }
  const list: Record<string, unknown>[] = Array.isArray(parsed)
    ? (parsed as Record<string, unknown>[])
    : parsed != null && typeof parsed === 'object'
      ? [parsed as Record<string, unknown>]
      : [];
  const byId = new Map<number, Record<string, unknown>>();
  for (const item of list) {
    const id = num(item.location_id);
    if (id != null) byId.set(id, item);
  }
  const points: WeatherGridPoint[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const raw = byId.get(i) ?? list[i];
    if (!raw) continue;
    points.push(parseGridPoint(raw, cell));
  }
  const now = deps.now?.() ?? Date.now();
  return {
    points,
    fetchedAtMs: now,
    partial: points.length < cells.length,
  };
}

export { weatherPointCacheKey };
