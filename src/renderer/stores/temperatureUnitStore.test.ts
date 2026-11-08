import { beforeEach, describe, expect, it } from 'vitest';

import {
  MESHTASTIC_DISPLAY_UNITS_IMPERIAL,
  setUseFahrenheitFromMeshtasticDisplayUnits,
  USE_FAHRENHEIT_STORAGE_KEY,
  useTemperatureUnitStore,
  weatherTempUnitFromStore,
} from './temperatureUnitStore';

describe('temperatureUnitStore', () => {
  beforeEach(() => {
    localStorage.removeItem(USE_FAHRENHEIT_STORAGE_KEY);
    useTemperatureUnitStore.setState({ useFahrenheit: false });
  });

  it('setUseFahrenheit persists and updates state', () => {
    useTemperatureUnitStore.getState().setUseFahrenheit(true);
    expect(useTemperatureUnitStore.getState().useFahrenheit).toBe(true);
    expect(localStorage.getItem(USE_FAHRENHEIT_STORAGE_KEY)).toBe('true');
  });

  it('loadUseFahrenheit survives a store re-create style read after persist', () => {
    useTemperatureUnitStore.getState().setUseFahrenheit(true);
    expect(localStorage.getItem(USE_FAHRENHEIT_STORAGE_KEY)).toBe('true');
    // Simulate app restart: state reset then re-read from localStorage.
    useTemperatureUnitStore.setState({
      useFahrenheit: localStorage.getItem(USE_FAHRENHEIT_STORAGE_KEY) === 'true',
    });
    expect(useTemperatureUnitStore.getState().useFahrenheit).toBe(true);
  });

  it('toggleUseFahrenheit flips and persists', () => {
    useTemperatureUnitStore.getState().toggleUseFahrenheit();
    expect(useTemperatureUnitStore.getState().useFahrenheit).toBe(true);
    useTemperatureUnitStore.getState().toggleUseFahrenheit();
    expect(useTemperatureUnitStore.getState().useFahrenheit).toBe(false);
    expect(localStorage.getItem(USE_FAHRENHEIT_STORAGE_KEY)).toBe('false');
  });

  it('weatherTempUnitFromStore maps boolean to c/f', () => {
    expect(weatherTempUnitFromStore(false)).toBe('c');
    expect(weatherTempUnitFromStore(true)).toBe('f');
  });

  it('setUseFahrenheitFromMeshtasticDisplayUnits maps Imperial to °F', () => {
    setUseFahrenheitFromMeshtasticDisplayUnits(0);
    expect(useTemperatureUnitStore.getState().useFahrenheit).toBe(false);
    setUseFahrenheitFromMeshtasticDisplayUnits(MESHTASTIC_DISPLAY_UNITS_IMPERIAL);
    expect(useTemperatureUnitStore.getState().useFahrenheit).toBe(true);
  });
});
