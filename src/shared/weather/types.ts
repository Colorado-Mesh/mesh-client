/** Normalized SI weather types shared by main and renderer. */

export type RadarProviderId = 'rainviewer' | 'iem-nexrad';

export type WeatherTempUnit = 'c' | 'f';
export type WeatherWindUnit = 'kmh' | 'mph' | 'ms' | 'kn';
export type WeatherPrecipUnit = 'mm' | 'in';

export interface WeatherUnits {
  temp: WeatherTempUnit;
  wind: WeatherWindUnit;
  precip: WeatherPrecipUnit;
}

export interface WeatherCurrent {
  timeMs: number;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  relativeHumidityPct: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  cloudCoverPct: number | null;
  pressureHpa: number | null;
  visibilityM: number | null;
  windSpeedMs: number | null;
  windDirectionDeg: number | null;
  windGustMs: number | null;
  isDay: boolean | null;
}

export interface WeatherHourlyPoint {
  timeMs: number;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  weatherCode: number | null;
  windSpeedMs: number | null;
  windDirectionDeg: number | null;
  windGustMs: number | null;
}

export interface WeatherDailyPoint {
  /** YYYY-MM-DD in the point's local timezone */
  dateIso: string;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  precipitationSumMm: number | null;
  precipitationProbabilityMaxPct: number | null;
  windSpeedMaxMs: number | null;
  windGustMaxMs: number | null;
  weatherCode: number | null;
  sunriseIso: string | null;
  sunsetIso: string | null;
}

export interface WeatherPointForecast {
  provider: 'open-meteo';
  latitude: number;
  longitude: number;
  elevationM: number | null;
  timezone: string;
  utcOffsetSeconds: number;
  fetchedAtMs: number;
  current: WeatherCurrent | null;
  hourly: WeatherHourlyPoint[];
  daily: WeatherDailyPoint[];
}

export interface WeatherGridPoint {
  latitude: number;
  longitude: number;
  temperatureC: number | null;
  windSpeedMs: number | null;
  windDirectionDeg: number | null;
  windGustMs: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
}

export interface WeatherGrid {
  provider: 'open-meteo';
  fetchedAtMs: number;
  stepDeg: number;
  points: WeatherGridPoint[];
  /** True when one or more requested points failed and the grid is interpolated from the rest. */
  partial: boolean;
}

export interface RadarFrame {
  provider: RadarProviderId;
  /** Opaque, already URL-safe id validated by main. */
  id: string;
  timeMs: number;
  kind: 'past' | 'nowcast';
  /** Fully built `mesh-weather://` URL template for Leaflet (`{z}/{x}/{y}`). */
  tileUrlTemplate: string;
}

export interface RadarFrames {
  provider: RadarProviderId;
  fetchedAtMs: number;
  maxNativeZoom: number;
  frames: RadarFrame[];
  attribution: string;
  /** `mesh-weather://` URL for the coverage mask, when the provider supports it. */
  coverageUrlTemplate: string | null;
}

export type WeatherErrorCode =
  | 'offline'
  | 'rate_limited'
  | 'timeout'
  | 'provider_error'
  | 'invalid_request'
  | 'unsupported_region';

export type WeatherResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: WeatherErrorCode; message: string; retryAfterMs?: number } };

export interface WeatherPointRequest {
  lat: number;
  lon: number;
}

export interface WeatherGridRequest {
  bounds: { north: number; south: number; east: number; west: number };
  zoom: number;
}

export interface WeatherRadarFramesRequest {
  bounds: { north: number; south: number; east: number; west: number };
  zoom: number;
  provider: 'auto' | RadarProviderId;
}

/** WMO weather_code → i18n key fragment under `internetWeather.conditions.*`. */
export const WMO_WEATHER_CODES: Readonly<Record<number, string>> = {
  0: 'clear',
  1: 'mainlyClear',
  2: 'partlyCloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rimeFog',
  51: 'lightDrizzle',
  53: 'drizzle',
  55: 'denseDrizzle',
  56: 'lightFreezingDrizzle',
  57: 'freezingDrizzle',
  61: 'lightRain',
  63: 'rain',
  65: 'heavyRain',
  66: 'lightFreezingRain',
  67: 'freezingRain',
  71: 'lightSnow',
  73: 'snow',
  75: 'heavySnow',
  77: 'snowGrains',
  80: 'lightShowers',
  81: 'showers',
  82: 'violentShowers',
  85: 'lightSnowShowers',
  86: 'snowShowers',
  95: 'thunderstorm',
  96: 'thunderstormHail',
  99: 'thunderstormHeavyHail',
};
