// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import {
  MESHTASTIC_DISPLAY_UNITS_IMPERIAL,
  USE_FAHRENHEIT_STORAGE_KEY,
  useTemperatureUnitStore,
} from '@/renderer/stores/temperatureUnitStore';

import {
  displayUnitsFromMeshtasticConfigSlice,
  syncAppUnitsFromMeshtasticDisplayUnits,
} from './meshtasticDisplayUnitsSync';

describe('meshtasticDisplayUnitsSync', () => {
  beforeEach(() => {
    localStorage.removeItem(USE_FAHRENHEIT_STORAGE_KEY);
    useTemperatureUnitStore.setState({ useFahrenheit: false });
    useInternetWeatherStore.setState({ windUnit: 'kmh', precipUnit: 'mm' });
  });

  it('reads units from a display config slice', () => {
    expect(displayUnitsFromMeshtasticConfigSlice(null)).toBeNull();
    expect(
      displayUnitsFromMeshtasticConfigSlice({ units: MESHTASTIC_DISPLAY_UNITS_IMPERIAL }),
    ).toBe(MESHTASTIC_DISPLAY_UNITS_IMPERIAL);
  });

  it('maps Imperial to °F, mph, and inches when the user changes Display Units', () => {
    syncAppUnitsFromMeshtasticDisplayUnits(MESHTASTIC_DISPLAY_UNITS_IMPERIAL);
    expect(useTemperatureUnitStore.getState().useFahrenheit).toBe(true);
    expect(localStorage.getItem(USE_FAHRENHEIT_STORAGE_KEY)).toBe('true');
    expect(useInternetWeatherStore.getState().windUnit).toBe('mph');
    expect(useInternetWeatherStore.getState().precipUnit).toBe('in');
  });

  it('maps Metric to °C, km/h, and mm', () => {
    useTemperatureUnitStore.getState().setUseFahrenheit(true);
    useInternetWeatherStore.setState({ windUnit: 'mph', precipUnit: 'in' });
    syncAppUnitsFromMeshtasticDisplayUnits(0);
    expect(useTemperatureUnitStore.getState().useFahrenheit).toBe(false);
    expect(localStorage.getItem(USE_FAHRENHEIT_STORAGE_KEY)).toBe('false');
    expect(useInternetWeatherStore.getState().windUnit).toBe('kmh');
    expect(useInternetWeatherStore.getState().precipUnit).toBe('mm');
  });
});
