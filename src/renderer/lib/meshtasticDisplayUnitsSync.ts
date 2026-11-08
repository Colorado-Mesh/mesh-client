import {
  meshtasticConfigSlice,
  stripMeshtasticProtobufMeta,
} from '@/renderer/lib/meshtastic/meshtasticConfigApply';
import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import {
  MESHTASTIC_DISPLAY_UNITS_IMPERIAL,
  setUseFahrenheitFromMeshtasticDisplayUnits,
} from '@/renderer/stores/temperatureUnitStore';

/** Read Meshtastic DisplayConfig.units from a config slice (null when absent). */
export function displayUnitsFromMeshtasticConfigSlice(displaySlice: unknown): number | null {
  const cfg = stripMeshtasticProtobufMeta(meshtasticConfigSlice(displaySlice));
  return typeof cfg.units === 'number' ? cfg.units : null;
}

/**
 * Apply Meshtastic Display Units to App °C/°F and map wind/precip convenience units.
 * Imperial → °F + mph + in; Metric → °C + kmh + mm.
 */
export function syncAppUnitsFromMeshtasticDisplayUnits(units: number): void {
  setUseFahrenheitFromMeshtasticDisplayUnits(units);
  const imperial = units === MESHTASTIC_DISPLAY_UNITS_IMPERIAL;
  useInternetWeatherStore.getState().setWindUnit(imperial ? 'mph' : 'kmh');
  useInternetWeatherStore.getState().setPrecipUnit(imperial ? 'in' : 'mm');
}
