import { create } from 'zustand';

import type { WeatherTempUnit } from '@/shared/weather/types';

/** Same key historically used by App.tsx / Telemetry for °F preference. */
export const USE_FAHRENHEIT_STORAGE_KEY = 'mesh-client:useFahrenheit';

function loadUseFahrenheit(): boolean {
  try {
    return localStorage.getItem(USE_FAHRENHEIT_STORAGE_KEY) === 'true';
  } catch {
    // catch-no-log-ok: localStorage unavailable in node / restricted environments
    return false;
  }
}

function persistUseFahrenheit(value: boolean): void {
  try {
    localStorage.setItem(USE_FAHRENHEIT_STORAGE_KEY, String(value));
  } catch {
    // catch-no-log-ok: localStorage unavailable in node / restricted environments
  }
}

interface TemperatureUnitState {
  useFahrenheit: boolean;
  setUseFahrenheit: (value: boolean) => void;
  toggleUseFahrenheit: () => void;
}

export const useTemperatureUnitStore = create<TemperatureUnitState>((set, get) => ({
  useFahrenheit: loadUseFahrenheit(),
  setUseFahrenheit(value) {
    persistUseFahrenheit(value);
    set({ useFahrenheit: value });
  },
  toggleUseFahrenheit() {
    const next = !get().useFahrenheit;
    persistUseFahrenheit(next);
    set({ useFahrenheit: next });
  },
}));

/** Internet weather display unit derived from the App Telemetry F/C preference. */
export function weatherTempUnitFromStore(useFahrenheit: boolean): WeatherTempUnit {
  return useFahrenheit ? 'f' : 'c';
}

/** Meshtastic `Config.DisplayConfig.DisplayUnits.IMPERIAL`. */
export const MESHTASTIC_DISPLAY_UNITS_IMPERIAL = 1;

/** Sync App °F preference from Meshtastic Radio → Display Units. */
export function setUseFahrenheitFromMeshtasticDisplayUnits(units: number): void {
  useTemperatureUnitStore.getState().setUseFahrenheit(units === MESHTASTIC_DISPLAY_UNITS_IMPERIAL);
}
