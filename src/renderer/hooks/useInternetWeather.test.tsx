// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';

import { useInternetWeather } from './useInternetWeather';

const mapBounds = {
  getNorth: () => 40.1,
  getSouth: () => 39.9,
  getEast: () => -104.9,
  getWest: () => -105.1,
};

const map = {
  getBounds: () => mapBounds,
  getZoom: () => 8,
};

const mapEventHandlers: Record<string, () => void> = {};

vi.mock('react-leaflet', () => ({
  useMap: () => map,
  useMapEvents: (handlers: Record<string, () => void>) => {
    Object.assign(mapEventHandlers, handlers);
    return map;
  },
}));

function HookHost(): null {
  useInternetWeather();
  return null;
}

describe('useInternetWeather', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useInternetWeatherStore.getState().clear();
    useInternetWeatherStore.setState({ enabled: false });
    useMapLayerStore.setState({
      showRadar: false,
      showWeatherTemperature: false,
      showWeatherWind: false,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
    vi.mocked(window.electronAPI.weather.grid).mockClear();
    vi.mocked(window.electronAPI.weather.radarFrames).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not fetch when master toggle is off', () => {
    useMapLayerStore.setState({ showRadar: true });
    render(<HookHost />);
    vi.advanceTimersByTime(400);
    expect(window.electronAPI.weather.radarFrames).not.toHaveBeenCalled();
    expect(window.electronAPI.weather.grid).not.toHaveBeenCalled();
  });

  it('does not fetch when offline', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    useInternetWeatherStore.setState({ enabled: true });
    useMapLayerStore.setState({ showRadar: true });
    render(<HookHost />);
    vi.advanceTimersByTime(400);
    expect(window.electronAPI.weather.radarFrames).not.toHaveBeenCalled();
    expect(useInternetWeatherStore.getState().lastError?.code).toBe('offline');
  });

  it('ignores stale responses after a newer generation', async () => {
    useInternetWeatherStore.setState({ enabled: true });
    useMapLayerStore.setState({ showWeatherTemperature: true });
    let resolveFirst: ((v: unknown) => void) | undefined;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(window.electronAPI.weather.grid)
      .mockImplementationOnce(() => first as never)
      .mockResolvedValueOnce({
        ok: true,
        data: {
          provider: 'open-meteo',
          points: [],
          fetchedAtMs: 2,
          partial: false,
          stepDeg: 0.5,
        },
      } as never);

    render(<HookHost />);
    vi.advanceTimersByTime(400);
    expect(window.electronAPI.weather.grid).toHaveBeenCalledTimes(1);

    mapEventHandlers.moveend?.();
    vi.advanceTimersByTime(400);
    expect(window.electronAPI.weather.grid).toHaveBeenCalledTimes(2);

    // Resolve the newer request first, then the stale first response.
    await Promise.resolve();
    await Promise.resolve();
    expect(useInternetWeatherStore.getState().grid?.fetchedAtMs).toBe(2);

    resolveFirst?.({
      ok: true,
      data: {
        provider: 'open-meteo',
        points: [
          {
            latitude: 1,
            longitude: 2,
            temperatureC: 9,
            windSpeedMs: null,
            windDirectionDeg: null,
            windGustMs: null,
            precipitationMm: null,
            weatherCode: null,
          },
        ],
        fetchedAtMs: 1,
        partial: false,
        stepDeg: 0.5,
      },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(useInternetWeatherStore.getState().grid?.fetchedAtMs).toBe(2);
  });
});
