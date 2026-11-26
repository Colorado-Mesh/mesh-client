/** Persisted per-node environment sensor readings (`node_environment_telemetry`). */
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_SECOND } from './timeConstants';

/** Scalar fields stored as REAL columns. */
export const ENVIRONMENT_READING_FIELDS = [
  'temperature',
  'mcuTemperature',
  'relativeHumidity',
  'barometricPressure',
  'iaq',
  'gasResistance',
  'lux',
  'windSpeed',
  'windDirection',
  'windGust',
  'windLull',
  'weight',
  'rainfall1h',
  'rainfall24h',
  'lightningStrikeCount1h',
  'lightningDistanceKm',
  'pm10Standard',
  'pm25Standard',
  'pm40Standard',
  'pm100Standard',
  'co2',
  'pmTemperature',
  'pmHumidity',
  'pmVocIdx',
  'pmNoxIdx',
] as const;

export type EnvironmentReadingField = (typeof ENVIRONMENT_READING_FIELDS)[number];

/** Sparse channel arrays stored as JSON TEXT (channels 0–7). */
export const ENVIRONMENT_READING_ARRAY_FIELDS = ['adcVoltages', 'oneWireTemperatures'] as const;

export type EnvironmentReadingArrayField = (typeof ENVIRONMENT_READING_ARRAY_FIELDS)[number];

/** Units: temperature °C, relativeHumidity %, barometricPressure hPa, windSpeed m/s. */
export type EnvironmentReading = Partial<Record<EnvironmentReadingField, number>> & {
  adcVoltages?: (number | undefined)[];
  oneWireTemperatures?: (number | undefined)[];
};

/** SQLite column per scalar reading field; keep in sync with `node_environment_telemetry` DDL. */
export const ENVIRONMENT_READING_DB_COLUMNS: Readonly<Record<EnvironmentReadingField, string>> = {
  temperature: 'temperature',
  mcuTemperature: 'mcu_temperature',
  relativeHumidity: 'relative_humidity',
  barometricPressure: 'barometric_pressure',
  iaq: 'iaq',
  gasResistance: 'gas_resistance',
  lux: 'lux',
  windSpeed: 'wind_speed',
  windDirection: 'wind_direction',
  windGust: 'wind_gust',
  windLull: 'wind_lull',
  weight: 'weight',
  rainfall1h: 'rainfall_1h',
  rainfall24h: 'rainfall_24h',
  lightningStrikeCount1h: 'lightning_strike_count_1h',
  lightningDistanceKm: 'lightning_distance_km',
  pm10Standard: 'pm10_standard',
  pm25Standard: 'pm25_standard',
  pm40Standard: 'pm40_standard',
  pm100Standard: 'pm100_standard',
  co2: 'co2',
  pmTemperature: 'pm_temperature',
  pmHumidity: 'pm_humidity',
  pmVocIdx: 'pm_voc_idx',
  pmNoxIdx: 'pm_nox_idx',
};

/** SQLite JSON-text columns for sparse channel arrays. */
export const ENVIRONMENT_READING_ARRAY_DB_COLUMNS: Readonly<
  Record<EnvironmentReadingArrayField, string>
> = {
  adcVoltages: 'adc_voltages_json',
  oneWireTemperatures: 'one_wire_temperatures_json',
};

const ENVIRONMENT_TELEMETRY_SOURCES = ['rf', 'mqtt', 'rpc', 'push'] as const;
export type EnvironmentTelemetrySource = (typeof ENVIRONMENT_TELEMETRY_SOURCES)[number];

export function isEnvironmentTelemetrySource(value: unknown): value is EnvironmentTelemetrySource {
  return (
    typeof value === 'string' &&
    (ENVIRONMENT_TELEMETRY_SOURCES as readonly string[]).includes(value)
  );
}

/** Rows older than this are pruned (startup / session DB maintenance). */
export const ENVIRONMENT_TELEMETRY_RETENTION_MS = 7 * MS_PER_DAY;
/** Newest rows kept per (protocol, identity, node) in SQLite and in memory. */
export const ENVIRONMENT_TELEMETRY_MAX_PER_NODE = 500;
/** Distinct nodes kept per (protocol, identity) in memory and when hydrating history. */
export const ENVIRONMENT_TELEMETRY_MAX_NODES = 2000;
/** Identical readings for one node inside this window are treated as RF/MQTT duplicates. */
export const ENVIRONMENT_TELEMETRY_DEDUP_WINDOW_MS = 60 * MS_PER_SECOND;
/** Periodic prune interval while the app is running. */
export const ENVIRONMENT_TELEMETRY_PRUNE_INTERVAL_MS = MS_PER_HOUR;
/** Prune after this many successful inserts within a session (in addition to the hourly timer). */
export const ENVIRONMENT_TELEMETRY_PRUNE_EVERY_N_INSERTS = 50;

/** Chart time-window presets for Device → Telemetry (must not exceed retention). */
export const ENVIRONMENT_TELEMETRY_CHART_WINDOWS = [
  { id: '1h', ms: MS_PER_HOUR },
  { id: '24h', ms: 24 * MS_PER_HOUR },
  { id: '7d', ms: ENVIRONMENT_TELEMETRY_RETENTION_MS },
] as const;
export type EnvironmentTelemetryChartWindowId =
  (typeof ENVIRONMENT_TELEMETRY_CHART_WINDOWS)[number]['id'];

/** Max distinct node lines per metric when Device → Telemetry plots “All nodes”. */
export const ENVIRONMENT_CHART_ALL_NODES_MAX_OVERLAY = 32;
/** Max chart rows when plotting all nodes (downsample beyond this). */
export const ENVIRONMENT_CHART_ALL_NODES_MAX_ROWS = 1500;

/** Empty / legacy rows before identity scoping; treated as belonging to the hydrating identity. */
export const ENVIRONMENT_TELEMETRY_LEGACY_IDENTITY_ID = '';

/** Row shape returned by `db:getEnvironmentTelemetry`. */
export interface EnvironmentTelemetryRow {
  protocol: string;
  identity_id: string;
  node_id: number;
  recorded_at: number;
  source: string;
  temperature: number | null;
  mcu_temperature: number | null;
  relative_humidity: number | null;
  barometric_pressure: number | null;
  iaq: number | null;
  gas_resistance: number | null;
  lux: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  wind_gust: number | null;
  wind_lull: number | null;
  weight: number | null;
  rainfall_1h: number | null;
  rainfall_24h: number | null;
  lightning_strike_count_1h: number | null;
  lightning_distance_km: number | null;
  pm10_standard: number | null;
  pm25_standard: number | null;
  pm40_standard: number | null;
  pm100_standard: number | null;
  co2: number | null;
  pm_temperature: number | null;
  pm_humidity: number | null;
  pm_voc_idx: number | null;
  pm_nox_idx: number | null;
  adc_voltages_json: string | null;
  one_wire_temperatures_json: string | null;
}

function sanitizeSparseNumberArray(value: unknown): (number | undefined)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: (number | undefined)[] = [];
  let any = false;
  for (let i = 0; i < Math.min(value.length, 8); i++) {
    const v: unknown = value[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[i] = v;
      any = true;
    }
  }
  return any ? out : undefined;
}

function parseSparseNumberArrayJson(raw: unknown): (number | undefined)[] | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  try {
    return sanitizeSparseNumberArray(JSON.parse(raw) as unknown);
  } catch {
    // catch-no-log-ok malformed JSON from DB — treat as absent
    return undefined;
  }
}

export function serializeSparseNumberArray(
  values: (number | undefined)[] | undefined,
): string | null {
  if (!values || values.length === 0) return null;
  const compact: (number | null)[] = [];
  let any = false;
  for (let i = 0; i < Math.min(values.length, 8); i++) {
    const v = values[i];
    if (typeof v === 'number' && Number.isFinite(v)) {
      compact[i] = v;
      any = true;
    } else {
      compact[i] = null;
    }
  }
  return any ? JSON.stringify(compact) : null;
}

/**
 * Keep only finite numeric reading fields (and sparse channel arrays). Returns `null` when
 * nothing usable remains (untrusted IPC input and partial telemetry variants both pass here).
 */
export function sanitizeEnvironmentReading(value: unknown): EnvironmentReading | null {
  if (typeof value !== 'object' || value === null) return null;
  const src = value as Record<string, unknown>;
  const out: EnvironmentReading = {};
  let any = false;
  for (const field of ENVIRONMENT_READING_FIELDS) {
    const v = src[field];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[field] = v;
      any = true;
    }
  }
  const adc = sanitizeSparseNumberArray(src.adcVoltages);
  if (adc) {
    out.adcVoltages = adc;
    any = true;
  }
  const oneWire = sanitizeSparseNumberArray(src.oneWireTemperatures);
  if (oneWire) {
    out.oneWireTemperatures = oneWire;
    any = true;
  }
  return any ? out : null;
}

function sparseArraysEqual(
  a: (number | undefined)[] | undefined,
  b: (number | undefined)[] | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function environmentReadingsEqual(a: EnvironmentReading, b: EnvironmentReading): boolean {
  if (!ENVIRONMENT_READING_FIELDS.every((f) => a[f] === b[f])) return false;
  return (
    sparseArraysEqual(a.adcVoltages, b.adcVoltages) &&
    sparseArraysEqual(a.oneWireTemperatures, b.oneWireTemperatures)
  );
}

/** `MeshNode.env_*` field per scalar reading field (latest-reading columns on the node row). */
const ENVIRONMENT_READING_NODE_FIELDS: Readonly<Record<EnvironmentReadingField, string>> = {
  temperature: 'env_temperature',
  mcuTemperature: 'env_mcu_temperature',
  relativeHumidity: 'env_humidity',
  barometricPressure: 'env_pressure',
  iaq: 'env_iaq',
  gasResistance: 'env_gas_resistance',
  lux: 'env_lux',
  windSpeed: 'env_wind_speed',
  windDirection: 'env_wind_direction',
  windGust: 'env_wind_gust',
  windLull: 'env_wind_lull',
  weight: 'env_weight',
  rainfall1h: 'env_rainfall_1h',
  rainfall24h: 'env_rainfall_24h',
  lightningStrikeCount1h: 'env_lightning_strike_count_1h',
  lightningDistanceKm: 'env_lightning_distance_km',
  pm10Standard: 'env_pm10',
  pm25Standard: 'env_pm25',
  pm40Standard: 'env_pm40',
  pm100Standard: 'env_pm100',
  co2: 'env_co2',
  pmTemperature: 'env_pm_temperature',
  pmHumidity: 'env_pm_humidity',
  pmVocIdx: 'env_voc_idx',
  pmNoxIdx: 'env_nox_idx',
};

/**
 * Marker key on an MQTT `nodeUpdate` that carries a fresh environment reading, so the
 * renderer records history only for real readings (not for unrelated node patches).
 */
export const ENVIRONMENT_NODE_UPDATE_MARKER = 'env_recorded_at';

/**
 * Remove the environment marker from an MQTT node update (so it never reaches node state)
 * and return its timestamp, or undefined when the update carries no reading.
 */
export function takeEnvironmentNodeUpdateMarker(update: object): number | undefined {
  const value: unknown = Reflect.get(update, ENVIRONMENT_NODE_UPDATE_MARKER);
  Reflect.deleteProperty(update, ENVIRONMENT_NODE_UPDATE_MARKER);
  return typeof value === 'number' ? value : undefined;
}

export function environmentNodePatchFromReading(
  reading: EnvironmentReading,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of ENVIRONMENT_READING_FIELDS) {
    const v = reading[field];
    if (v !== undefined) out[ENVIRONMENT_READING_NODE_FIELDS[field]] = v;
  }
  return out;
}

export function environmentReadingFromNodePatch(patch: object): EnvironmentReading | null {
  const src = patch as Readonly<Record<string, unknown>>;
  const raw: Record<string, unknown> = {};
  for (const field of ENVIRONMENT_READING_FIELDS) {
    raw[field] = src[ENVIRONMENT_READING_NODE_FIELDS[field]];
  }
  return sanitizeEnvironmentReading(raw);
}

/** Map snake_case keys (Meshtastic MQTT JSON / SQLite columns) to a reading. */
export function environmentReadingFromSnakeCase(source: object): EnvironmentReading | null {
  const src = source as Readonly<Record<string, unknown>>;
  const raw: Record<string, unknown> = {};
  for (const field of ENVIRONMENT_READING_FIELDS) {
    raw[field] = src[ENVIRONMENT_READING_DB_COLUMNS[field]];
  }
  raw.adcVoltages = parseSparseNumberArrayJson(
    src[ENVIRONMENT_READING_ARRAY_DB_COLUMNS.adcVoltages],
  );
  raw.oneWireTemperatures = parseSparseNumberArrayJson(
    src[ENVIRONMENT_READING_ARRAY_DB_COLUMNS.oneWireTemperatures],
  );
  // Also accept camelCase array keys (MQTT / IPC).
  if (raw.adcVoltages === undefined) raw.adcVoltages = src.adcVoltages;
  if (raw.oneWireTemperatures === undefined) raw.oneWireTemperatures = src.oneWireTemperatures;
  return sanitizeEnvironmentReading(raw);
}

export function environmentReadingFromRow(row: EnvironmentTelemetryRow): EnvironmentReading {
  return environmentReadingFromSnakeCase(row) ?? {};
}

/** CSV / export column id for a scalar field (snake_case, prefixed). */
export function environmentReadingCsvHeader(field: EnvironmentReadingField): string {
  return `env_${ENVIRONMENT_READING_DB_COLUMNS[field]}`;
}
