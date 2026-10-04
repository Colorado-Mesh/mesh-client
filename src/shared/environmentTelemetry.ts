/** Persisted per-node environment sensor readings (`node_environment_telemetry`). */
import { MS_PER_DAY, MS_PER_SECOND } from './timeConstants';

export const ENVIRONMENT_READING_FIELDS = [
  'temperature',
  'relativeHumidity',
  'barometricPressure',
  'iaq',
  'gasResistance',
  'lux',
  'windSpeed',
  'windDirection',
  'pm25Standard',
  'co2',
] as const;

export type EnvironmentReadingField = (typeof ENVIRONMENT_READING_FIELDS)[number];

/** Units: temperature °C, relativeHumidity %, barometricPressure hPa, windSpeed m/s. */
export type EnvironmentReading = Partial<Record<EnvironmentReadingField, number>>;

/** SQLite column per reading field; keep in sync with `node_environment_telemetry` DDL. */
export const ENVIRONMENT_READING_DB_COLUMNS: Readonly<Record<EnvironmentReadingField, string>> = {
  temperature: 'temperature',
  relativeHumidity: 'relative_humidity',
  barometricPressure: 'barometric_pressure',
  iaq: 'iaq',
  gasResistance: 'gas_resistance',
  lux: 'lux',
  windSpeed: 'wind_speed',
  windDirection: 'wind_direction',
  pm25Standard: 'pm25_standard',
  co2: 'co2',
};

export const ENVIRONMENT_TELEMETRY_SOURCES = ['rf', 'mqtt', 'rpc'] as const;
export type EnvironmentTelemetrySource = (typeof ENVIRONMENT_TELEMETRY_SOURCES)[number];

export function isEnvironmentTelemetrySource(value: unknown): value is EnvironmentTelemetrySource {
  return (
    typeof value === 'string' &&
    (ENVIRONMENT_TELEMETRY_SOURCES as readonly string[]).includes(value)
  );
}

/** Rows older than this are pruned (startup / session DB maintenance). */
export const ENVIRONMENT_TELEMETRY_RETENTION_MS = 7 * MS_PER_DAY;
/** Newest rows kept per (protocol, node) in SQLite and in memory. */
export const ENVIRONMENT_TELEMETRY_MAX_PER_NODE = 500;
/** Distinct nodes kept per protocol in memory and when hydrating history. */
export const ENVIRONMENT_TELEMETRY_MAX_NODES = 2000;
/** Identical readings for one node inside this window are treated as RF/MQTT duplicates. */
export const ENVIRONMENT_TELEMETRY_DEDUP_WINDOW_MS = 60 * MS_PER_SECOND;

/** Row shape returned by `db:getEnvironmentTelemetry`. */
export interface EnvironmentTelemetryRow {
  protocol: string;
  node_id: number;
  recorded_at: number;
  source: string;
  temperature: number | null;
  relative_humidity: number | null;
  barometric_pressure: number | null;
  iaq: number | null;
  gas_resistance: number | null;
  lux: number | null;
  wind_speed: number | null;
  wind_direction: number | null;
  pm25_standard: number | null;
  co2: number | null;
}

/**
 * Keep only finite numeric reading fields. Returns `null` when nothing usable remains
 * (untrusted IPC input and partial telemetry variants both pass through here).
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
  return any ? out : null;
}

export function environmentReadingsEqual(a: EnvironmentReading, b: EnvironmentReading): boolean {
  return ENVIRONMENT_READING_FIELDS.every((f) => a[f] === b[f]);
}

/** `MeshNode.env_*` field per reading field (latest-reading columns on the node row). */
export const ENVIRONMENT_READING_NODE_FIELDS: Readonly<Record<EnvironmentReadingField, string>> = {
  temperature: 'env_temperature',
  relativeHumidity: 'env_humidity',
  barometricPressure: 'env_pressure',
  iaq: 'env_iaq',
  gasResistance: 'env_gas_resistance',
  lux: 'env_lux',
  windSpeed: 'env_wind_speed',
  windDirection: 'env_wind_direction',
  pm25Standard: 'env_pm25',
  co2: 'env_co2',
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
  return sanitizeEnvironmentReading(raw);
}

export function environmentReadingFromRow(row: EnvironmentTelemetryRow): EnvironmentReading {
  return environmentReadingFromSnakeCase(row) ?? {};
}
