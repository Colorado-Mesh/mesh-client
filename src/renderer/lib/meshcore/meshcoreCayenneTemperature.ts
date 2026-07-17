/**
 * Assign environmental vs MCU temperature from Cayenne LPP entries.
 *
 * Protocol convention: channel 0 = environmental sensor temperature;
 * any other channel with LPP_TEMPERATURE = MCU/internal temperature.
 */

export interface CayenneTempEntry {
  channel: number;
  type: number;
  value: unknown;
}

export interface CayenneTemperatureFields {
  temperature?: number;
  mcuTemperature?: number;
}

export function assignCayenneTemperatureFields(
  entries: readonly CayenneTempEntry[],
  lppTemperatureType: number,
): CayenneTemperatureFields {
  const out: CayenneTemperatureFields = {};
  for (const entry of entries) {
    if (entry.type !== lppTemperatureType || typeof entry.value !== 'number') continue;
    if (entry.channel === 0) {
      out.temperature = entry.value;
    } else {
      out.mcuTemperature = entry.value;
    }
  }
  return out;
}
