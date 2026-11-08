// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import { useMapToolStore } from '@/renderer/stores/mapToolStore';
import { useTemperatureUnitStore } from '@/renderer/stores/temperatureUnitStore';

import { WeatherPopup } from './WeatherPopup';

const handlers: {
  click?: (e: { latlng: { lat: number; lng: number }; originalEvent?: Event }) => void;
  dragstart?: () => void;
  dragend?: () => void;
} = {};

vi.mock('react-leaflet', () => ({
  useMapEvents: (h: typeof handlers) => {
    Object.assign(handlers, h);
    return {};
  },
  Popup: ({ children }: { children?: ReactNode }) => <div data-testid="popup">{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

describe('WeatherPopup', () => {
  beforeEach(() => {
    handlers.click = undefined;
    handlers.dragstart = undefined;
    handlers.dragend = undefined;
    useInternetWeatherStore.getState().clear();
    useInternetWeatherStore.setState({ enabled: true });
    useMapToolStore.setState({ measureActive: false });
    useTemperatureUnitStore.setState({ useFahrenheit: false });
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
    vi.mocked(window.electronAPI.weather.pointForecast).mockReset();
  });

  it('skips fetch while measure tool is active', () => {
    useMapToolStore.setState({ measureActive: true });
    render(<WeatherPopup />);
    act(() => {
      handlers.click?.({ latlng: { lat: 40, lng: -105 } });
    });
    expect(window.electronAPI.weather.pointForecast).not.toHaveBeenCalled();
    expect(screen.queryByTestId('popup')).toBeNull();
  });

  it('skips fetch when the click came from map chrome', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    render(<WeatherPopup />);
    act(() => {
      handlers.click?.({
        latlng: { lat: 40, lng: -105 },
        originalEvent: { target: button } as unknown as Event,
      });
    });
    expect(window.electronAPI.weather.pointForecast).not.toHaveBeenCalled();
    button.remove();
  });

  it('shows loading then success', async () => {
    vi.mocked(window.electronAPI.weather.pointForecast).mockResolvedValue({
      ok: true,
      data: {
        provider: 'open-meteo',
        latitude: 40,
        longitude: -105,
        elevationM: 1600,
        fetchedAtMs: 1,
        timezone: 'auto',
        utcOffsetSeconds: -25200,
        current: {
          timeMs: 1,
          temperatureC: 20,
          apparentTemperatureC: 19,
          relativeHumidityPct: 40,
          precipitationMm: 0,
          weatherCode: 0,
          cloudCoverPct: 10,
          pressureHpa: 1013,
          visibilityM: null,
          windSpeedMs: 3,
          windGustMs: 5,
          windDirectionDeg: 180,
          isDay: true,
        },
        hourly: [],
        daily: [],
      },
    });
    render(<WeatherPopup />);
    act(() => {
      handlers.click?.({ latlng: { lat: 40, lng: -105 } });
    });
    expect(screen.getByText('internetWeather.loading')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/internetWeather.conditions.clear/)).toBeTruthy();
    });
    expect(screen.getByText(/20°C/)).toBeTruthy();
  });

  it('shows Fahrenheit when the App temperature preference is °F', async () => {
    useTemperatureUnitStore.setState({ useFahrenheit: true });
    vi.mocked(window.electronAPI.weather.pointForecast).mockResolvedValue({
      ok: true,
      data: {
        provider: 'open-meteo',
        latitude: 40,
        longitude: -105,
        elevationM: null,
        fetchedAtMs: 1,
        timezone: 'auto',
        utcOffsetSeconds: 0,
        current: {
          timeMs: 1,
          temperatureC: 20,
          apparentTemperatureC: null,
          relativeHumidityPct: null,
          precipitationMm: null,
          weatherCode: 0,
          cloudCoverPct: null,
          pressureHpa: null,
          visibilityM: null,
          windSpeedMs: null,
          windGustMs: null,
          windDirectionDeg: null,
          isDay: true,
        },
        hourly: [],
        daily: [],
      },
    });
    render(<WeatherPopup />);
    act(() => {
      handlers.click?.({ latlng: { lat: 40, lng: -105 } });
    });
    await waitFor(() => {
      expect(screen.getByText(/68°F/)).toBeTruthy();
    });
  });

  it('shows offline error without calling retry until clicked', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    render(<WeatherPopup />);
    act(() => {
      handlers.click?.({ latlng: { lat: 40, lng: -105 } });
    });
    expect(window.electronAPI.weather.pointForecast).not.toHaveBeenCalled();
    expect(screen.getByText('internetWeather.offline')).toBeTruthy();
  });

  it('ignores a stale forecast after a newer click', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(window.electronAPI.weather.pointForecast)
      .mockImplementationOnce(
        () => first as ReturnType<typeof window.electronAPI.weather.pointForecast>,
      )
      .mockResolvedValueOnce({
        ok: true,
        data: {
          provider: 'open-meteo',
          latitude: 41,
          longitude: -104,
          elevationM: null,
          fetchedAtMs: 2,
          timezone: 'auto',
          utcOffsetSeconds: 0,
          current: {
            timeMs: 2,
            temperatureC: 30,
            apparentTemperatureC: null,
            relativeHumidityPct: null,
            precipitationMm: null,
            weatherCode: 0,
            cloudCoverPct: null,
            pressureHpa: null,
            visibilityM: null,
            windSpeedMs: null,
            windGustMs: null,
            windDirectionDeg: null,
            isDay: true,
          },
          hourly: [],
          daily: [],
        },
      });
    render(<WeatherPopup />);
    act(() => {
      handlers.click?.({ latlng: { lat: 40, lng: -105 } });
    });
    act(() => {
      handlers.click?.({ latlng: { lat: 41, lng: -104 } });
    });
    await waitFor(() => {
      expect(screen.getByText(/30°C/)).toBeTruthy();
    });
    act(() => {
      resolveFirst({
        ok: true,
        data: {
          provider: 'open-meteo',
          latitude: 40,
          longitude: -105,
          elevationM: null,
          fetchedAtMs: 1,
          timezone: 'auto',
          utcOffsetSeconds: 0,
          current: {
            timeMs: 1,
            temperatureC: 10,
            apparentTemperatureC: null,
            relativeHumidityPct: null,
            precipitationMm: null,
            weatherCode: 3,
            cloudCoverPct: null,
            pressureHpa: null,
            visibilityM: null,
            windSpeedMs: null,
            windGustMs: null,
            windDirectionDeg: null,
            isDay: true,
          },
          hourly: [],
          daily: [],
        },
      });
    });
    expect(screen.getByText(/30°C/)).toBeTruthy();
    expect(screen.queryByText(/10°C/)).toBeNull();
  });

  it('retry maps offline errors and catches rejections', async () => {
    vi.mocked(window.electronAPI.weather.pointForecast)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'provider_error', message: 'fail' },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'offline', message: 'offline' },
      });
    render(<WeatherPopup />);
    act(() => {
      handlers.click?.({ latlng: { lat: 40, lng: -105 } });
    });
    await waitFor(() => {
      expect(screen.getByText('internetWeather.loadFailed')).toBeTruthy();
    });
    act(() => {
      screen.getByRole('button', { name: 'internetWeather.retry' }).click();
    });
    await waitFor(() => {
      expect(screen.getByText('internetWeather.offline')).toBeTruthy();
    });
  });

  it('has no axe violations when ready', async () => {
    vi.mocked(window.electronAPI.weather.pointForecast).mockResolvedValue({
      ok: true,
      data: {
        provider: 'open-meteo',
        latitude: 40,
        longitude: -105,
        elevationM: null,
        fetchedAtMs: Date.now(),
        timezone: 'auto',
        utcOffsetSeconds: 0,
        current: {
          timeMs: 1,
          temperatureC: 10,
          apparentTemperatureC: null,
          relativeHumidityPct: null,
          precipitationMm: null,
          weatherCode: 0,
          cloudCoverPct: null,
          pressureHpa: null,
          visibilityM: null,
          windSpeedMs: null,
          windGustMs: null,
          windDirectionDeg: null,
          isDay: true,
        },
        hourly: [],
        daily: [],
      },
    });
    const { container } = render(<WeatherPopup />);
    act(() => {
      handlers.click?.({ latlng: { lat: 40, lng: -105 } });
    });
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
