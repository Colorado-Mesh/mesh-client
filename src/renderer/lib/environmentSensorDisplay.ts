import { MS_PER_DAY } from './timeConstants';

/** Environment metric drawn by the map sensor layer. */
export const MAP_SENSOR_METRICS = [
  'temperature',
  'relativeHumidity',
  'barometricPressure',
  'iaq',
  'pm25Standard',
  'co2',
  'lux',
  'windSpeed',
] as const;
export type MapSensorMetric = (typeof MAP_SENSOR_METRICS)[number];

export function isMapSensorMetric(value: unknown): value is MapSensorMetric {
  return typeof value === 'string' && (MAP_SENSOR_METRICS as readonly string[]).includes(value);
}

/** Sensor markers hide readings older than this (history is kept longer for sparklines). */
export const SENSOR_LAYER_MAX_AGE_MS = MS_PER_DAY;

/** Leaflet path colors (canvas renderer cannot read CSS custom properties). */
export const SENSOR_COLOR_NEUTRAL = '#93a0b7';
const SENSOR_COLOR_COLD = '#60a5fa';
const SENSOR_COLOR_COOL = '#22d3ee';
const SENSOR_COLOR_MILD = '#4ade80';
const SENSOR_COLOR_WARM = '#fbbf24';
const SENSOR_COLOR_HOT = '#f87171';
const SENSOR_COLOR_LOW_PRESSURE = '#a78bfa';

interface ColorBand {
  /** Inclusive upper bound in the metric's base unit (°C, %, hPa). */
  below: number;
  color: string;
}

const BANDS: Readonly<Record<MapSensorMetric, readonly ColorBand[]>> = {
  temperature: [
    { below: 0, color: SENSOR_COLOR_COLD },
    { below: 10, color: SENSOR_COLOR_COOL },
    { below: 20, color: SENSOR_COLOR_MILD },
    { below: 30, color: SENSOR_COLOR_WARM },
    { below: Number.POSITIVE_INFINITY, color: SENSOR_COLOR_HOT },
  ],
  relativeHumidity: [
    { below: 30, color: SENSOR_COLOR_WARM },
    { below: 60, color: SENSOR_COLOR_MILD },
    { below: Number.POSITIVE_INFINITY, color: SENSOR_COLOR_COLD },
  ],
  barometricPressure: [
    { below: 1000, color: SENSOR_COLOR_LOW_PRESSURE },
    { below: 1020, color: SENSOR_COLOR_MILD },
    { below: Number.POSITIVE_INFINITY, color: SENSOR_COLOR_WARM },
  ],
  iaq: [
    { below: 50, color: SENSOR_COLOR_MILD },
    { below: 100, color: SENSOR_COLOR_WARM },
    { below: Number.POSITIVE_INFINITY, color: SENSOR_COLOR_HOT },
  ],
  pm25Standard: [
    { below: 12, color: SENSOR_COLOR_MILD },
    { below: 35, color: SENSOR_COLOR_WARM },
    { below: Number.POSITIVE_INFINITY, color: SENSOR_COLOR_HOT },
  ],
  co2: [
    { below: 800, color: SENSOR_COLOR_MILD },
    { below: 1200, color: SENSOR_COLOR_WARM },
    { below: Number.POSITIVE_INFINITY, color: SENSOR_COLOR_HOT },
  ],
  lux: [
    { below: 100, color: SENSOR_COLOR_COLD },
    { below: 1000, color: SENSOR_COLOR_COOL },
    { below: Number.POSITIVE_INFINITY, color: SENSOR_COLOR_WARM },
  ],
  windSpeed: [
    { below: 3, color: SENSOR_COLOR_MILD },
    { below: 8, color: SENSOR_COLOR_WARM },
    { below: Number.POSITIVE_INFINITY, color: SENSOR_COLOR_HOT },
  ],
};

/** Band color for a value in the metric's base unit; neutral when missing or not finite. */
export function sensorColorForValue(metric: MapSensorMetric, value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return SENSOR_COLOR_NEUTRAL;
  for (const band of BANDS[metric]) {
    if (value < band.below) return band.color;
  }
  return SENSOR_COLOR_NEUTRAL;
}

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

type Translate = (key: string, opts: Record<string, unknown>) => string;

/** Localized value with unit; temperature input is always °C. */
export function formatSensorMetric(
  t: Translate,
  metric: MapSensorMetric,
  value: number,
  useFahrenheit: boolean,
): string {
  if (metric === 'temperature') {
    return useFahrenheit
      ? t('sensorLayer.valueTempF', { value: celsiusToFahrenheit(value).toFixed(1) })
      : t('sensorLayer.valueTempC', { value: value.toFixed(1) });
  }
  if (metric === 'relativeHumidity') {
    return t('sensorLayer.valueHumidity', { value: value.toFixed(0) });
  }
  if (metric === 'barometricPressure') {
    return t('sensorLayer.valuePressure', { value: value.toFixed(1) });
  }
  if (metric === 'iaq') {
    return t('sensorLayer.valueIaq', { value: value.toFixed(0) });
  }
  if (metric === 'pm25Standard') {
    return t('sensorLayer.valuePm25', { value: value.toFixed(1) });
  }
  if (metric === 'co2') {
    return t('sensorLayer.valueCo2', { value: value.toFixed(0) });
  }
  if (metric === 'lux') {
    return t('sensorLayer.valueLux', { value: value.toFixed(0) });
  }
  return t('sensorLayer.valueWind', { value: value.toFixed(1) });
}
