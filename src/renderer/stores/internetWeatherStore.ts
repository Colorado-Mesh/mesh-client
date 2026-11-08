import { create } from 'zustand';

import type {
  RadarFrames,
  RadarProviderId,
  WeatherErrorCode,
  WeatherGrid,
  WeatherPrecipUnit,
  WeatherWindUnit,
} from '@/shared/weather/types';

import {
  getRadarPreferences,
  getWeatherUnits,
  isInternetWeatherEnabled,
  mergeAppSetting,
  setInternetWeatherEnabled,
} from '../lib/appSettingsStorage';

type Status = 'idle' | 'loading' | 'ready' | 'error';

interface InternetWeatherState {
  enabled: boolean;
  radarProvider: 'auto' | RadarProviderId;
  radarOpacity: number;
  showCoverage: boolean;
  windUnit: WeatherWindUnit;
  precipUnit: WeatherPrecipUnit;
  radarFrames: RadarFrames | null;
  radarFrameIndex: number;
  radarPlaying: boolean;
  grid: WeatherGrid | null;
  gridStatus: Status;
  radarStatus: Status;
  lastError: { code: WeatherErrorCode; message: string } | null;
  lastUpdatedMs: number | null;

  setEnabled: (enabled: boolean) => void;
  setRadarProvider: (provider: 'auto' | RadarProviderId) => void;
  setRadarOpacity: (opacity: number) => void;
  setShowCoverage: (show: boolean) => void;
  setWindUnit: (unit: WeatherWindUnit) => void;
  setPrecipUnit: (unit: WeatherPrecipUnit) => void;
  setRadarFrames: (frames: RadarFrames | null) => void;
  setRadarFrameIndex: (index: number) => void;
  setRadarPlaying: (playing: boolean) => void;
  setGrid: (grid: WeatherGrid | null) => void;
  setGridStatus: (status: Status) => void;
  setRadarStatus: (status: Status) => void;
  setError: (error: { code: WeatherErrorCode; message: string } | null) => void;
  setLastUpdatedMs: (ms: number | null) => void;
  clear: () => void;
}

const prefs = getRadarPreferences();
const units = getWeatherUnits();

export const useInternetWeatherStore = create<InternetWeatherState>((set, get) => ({
  enabled: isInternetWeatherEnabled(),
  radarProvider: prefs.provider,
  radarOpacity: prefs.opacity,
  showCoverage: prefs.showCoverage,
  windUnit: units.wind,
  precipUnit: units.precip,
  radarFrames: null,
  radarFrameIndex: 0,
  radarPlaying: false,
  grid: null,
  gridStatus: 'idle',
  radarStatus: 'idle',
  lastError: null,
  lastUpdatedMs: null,

  setEnabled: (enabled) => {
    setInternetWeatherEnabled(enabled);
    set({ enabled });
    if (!enabled) get().clear();
  },
  setRadarProvider: (radarProvider) => {
    mergeAppSetting('mapWeatherRadarProvider', radarProvider, 'internetWeather setRadarProvider');
    set({ radarProvider });
  },
  setRadarOpacity: (opacity) => {
    const radarOpacity = Math.min(0.9, Math.max(0.2, opacity));
    mergeAppSetting('mapWeatherRadarOpacity', radarOpacity, 'internetWeather setRadarOpacity');
    set({ radarOpacity });
  },
  setShowCoverage: (showCoverage) => {
    mergeAppSetting('mapWeatherRadarCoverage', showCoverage, 'internetWeather setShowCoverage');
    set({ showCoverage });
  },
  setWindUnit: (windUnit) => {
    mergeAppSetting('mapWeatherWindUnit', windUnit, 'internetWeather setWindUnit');
    set({ windUnit });
  },
  setPrecipUnit: (precipUnit) => {
    mergeAppSetting('mapWeatherPrecipUnit', precipUnit, 'internetWeather setPrecipUnit');
    set({ precipUnit });
  },
  setRadarFrames: (radarFrames) => {
    const max = radarFrames ? Math.max(0, radarFrames.frames.length - 1) : 0;
    const radarFrameIndex = Math.min(get().radarFrameIndex, max);
    set({ radarFrames, radarFrameIndex });
  },
  setRadarFrameIndex: (index) => {
    const max = get().radarFrames ? Math.max(0, get().radarFrames!.frames.length - 1) : 0;
    set({ radarFrameIndex: Math.min(max, Math.max(0, index)) });
  },
  setRadarPlaying: (radarPlaying) => {
    set({ radarPlaying });
  },
  setGrid: (grid) => {
    set({ grid });
  },
  setGridStatus: (gridStatus) => {
    set({ gridStatus });
  },
  setRadarStatus: (radarStatus) => {
    set({ radarStatus });
  },
  setError: (lastError) => {
    set({ lastError });
  },
  setLastUpdatedMs: (lastUpdatedMs) => {
    set({ lastUpdatedMs });
  },
  clear: () => {
    set({
      radarFrames: null,
      radarFrameIndex: 0,
      radarPlaying: false,
      grid: null,
      gridStatus: 'idle',
      radarStatus: 'idle',
      lastError: null,
      lastUpdatedMs: null,
    });
  },
}));
