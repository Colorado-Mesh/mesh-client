/**
 * Project Cayenne LPP readings into the fixed EnvironmentReading shape used by
 * environmentTelemetryStore / Map / Device → Telemetry history charts.
 *
 * Non-mappable kinds (accel, digital I/O, GPS, …) stay in cayenneTelemetryStore only.
 */
import type { EnvironmentReading } from '@/shared/environmentTelemetry';
import { sanitizeEnvironmentReading } from '@/shared/environmentTelemetry';

import {
  assignCayenneTemperatureFields,
  type CayenneTempEntry,
} from './meshcore/meshcoreCayenneTemperature';
import type { CayenneKind, CayenneReading } from './meshtastic/cayenneLpp';

/** MeshCore / Cayenne LPP type id for temperature (shared with @liamcottle/meshcore.js). */
export const CAYENNE_LPP_TEMPERATURE_TYPE = 103;

const MAPPABLE_KINDS: ReadonlySet<CayenneKind> = new Set([
  'temperature',
  'humidity',
  'barometer',
  'illuminance',
  'direction',
  'concentration',
]);

export interface CayenneLppWireEntry {
  channel: number;
  type: number;
  value: unknown;
}

/**
 * Map decoded Meshtastic Cayenne readings (kind-based) into an EnvironmentReading.
 * Channel 0 temperature → ambient; other temperature channels → mcuTemperature.
 */
export function cayenneDecodedToEnvironmentReading(
  readings: readonly CayenneReading[],
): EnvironmentReading | null {
  if (readings.length === 0) return null;
  const tempEntries: CayenneTempEntry[] = [];
  const raw: Record<string, unknown> = {};
  for (const reading of readings) {
    if (!MAPPABLE_KINDS.has(reading.kind)) continue;
    const value = reading.values.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    switch (reading.kind) {
      case 'temperature':
        tempEntries.push({
          channel: reading.channel,
          type: CAYENNE_LPP_TEMPERATURE_TYPE,
          value,
        });
        break;
      case 'humidity':
        raw.relativeHumidity = value;
        break;
      case 'barometer':
        raw.barometricPressure = value;
        break;
      case 'illuminance':
        raw.lux = value;
        break;
      case 'direction':
        raw.windDirection = value;
        break;
      case 'concentration':
        // Cayenne concentration is ppm — treat as CO₂ when no other co2 source is present.
        raw.co2 ??= value;
        break;
      default:
        break;
    }
  }
  const temps = assignCayenneTemperatureFields(tempEntries, CAYENNE_LPP_TEMPERATURE_TYPE);
  if (temps.temperature !== undefined) raw.temperature = temps.temperature;
  if (temps.mcuTemperature !== undefined) raw.mcuTemperature = temps.mcuTemperature;
  return sanitizeEnvironmentReading(raw);
}

/**
 * Map MeshCore CayenneLpp.parse wire entries (type-id based) into an EnvironmentReading.
 * Extends the legacy temp/humidity/pressure extract with lux / direction / concentration.
 */
export function cayenneWireEntriesToEnvironmentReading(
  entries: readonly CayenneLppWireEntry[],
): EnvironmentReading | null {
  if (entries.length === 0) return null;
  const temps = assignCayenneTemperatureFields(entries, CAYENNE_LPP_TEMPERATURE_TYPE);
  const raw: Record<string, unknown> = {
    temperature: temps.temperature,
    mcuTemperature: temps.mcuTemperature,
  };
  for (const entry of entries) {
    if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) continue;
    switch (entry.type) {
      case 104: // LPP_RELATIVE_HUMIDITY
        raw.relativeHumidity = entry.value;
        break;
      case 115: // LPP_BAROMETRIC_PRESSURE
        raw.barometricPressure = entry.value;
        break;
      case 101: // LPP_LUMINOSITY / illuminance
        raw.lux = entry.value;
        break;
      case 132: // LPP_DIRECTION
        raw.windDirection = entry.value;
        break;
      case 125: // LPP_CONCENTRATION
        raw.co2 ??= entry.value;
        break;
      default:
        break;
    }
  }
  return sanitizeEnvironmentReading(raw);
}
