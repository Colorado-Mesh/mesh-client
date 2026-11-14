import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  net: { isOnline: () => true },
}));

vi.mock('./openMeteo', () => ({
  fetchPointForecast: vi.fn(),
  fetchGrid: vi.fn(),
}));

vi.mock('./rainViewer', () => ({
  fetchRainViewerManifest: vi.fn(),
}));

import type { WeatherPointForecast } from '@/shared/weather/types';

import { fetchGrid, fetchPointForecast } from './openMeteo';
import { fetchRainViewerManifest } from './rainViewer';
import { createWeatherProtocolState } from './weather-protocol';
import { createWeatherService } from './weather-service';

function samplePoint(): WeatherPointForecast {
  return {
    provider: 'open-meteo',
    latitude: 40,
    longitude: -105,
    elevationM: 1600,
    timezone: 'America/Denver',
    utcOffsetSeconds: -25200,
    fetchedAtMs: 1_000,
    current: {
      timeMs: 1_000,
      temperatureC: 12,
      apparentTemperatureC: 11,
      relativeHumidityPct: 40,
      precipitationMm: 0,
      weatherCode: 0,
      cloudCoverPct: 10,
      pressureHpa: 1010,
      visibilityM: 10000,
      windSpeedMs: 2,
      windGustMs: 3,
      windDirectionDeg: 180,
      isDay: true,
    },
    hourly: [],
    daily: [],
  };
}

describe('createWeatherService', () => {
  beforeEach(() => {
    vi.mocked(fetchPointForecast).mockReset();
    vi.mocked(fetchGrid).mockReset();
    vi.mocked(fetchRainViewerManifest).mockReset();
  });

  it('returns offline without calling providers', async () => {
    const svc = createWeatherService(
      {
        getAppVersion: () => 'test',
        isOnline: () => false,
        now: () => 1_000,
      },
      createWeatherProtocolState(),
    );
    await expect(svc.pointForecast(40, -105)).resolves.toEqual({
      ok: false,
      error: { code: 'offline', message: 'offline' },
    });
    expect(fetchPointForecast).not.toHaveBeenCalled();
  });

  it('rejects invalid coordinates', async () => {
    const svc = createWeatherService(
      {
        getAppVersion: () => 'test',
        isOnline: () => true,
        now: () => 1_000,
      },
      createWeatherProtocolState(),
    );
    await expect(svc.pointForecast(Number.NaN, -105)).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_request', message: 'invalid_request' },
    });
  });

  it('caches a successful point forecast and serves it on the next call', async () => {
    const point = samplePoint();
    vi.mocked(fetchPointForecast).mockResolvedValue(point);
    const svc = createWeatherService(
      {
        getAppVersion: () => 'test',
        isOnline: () => true,
        now: () => 1_000,
      },
      createWeatherProtocolState(),
    );
    const first = await svc.pointForecast(40.001, -105.001);
    expect(first).toEqual({ ok: true, data: point });
    const second = await svc.pointForecast(40.004, -105.004);
    expect(second).toEqual({ ok: true, data: point });
    expect(fetchPointForecast).toHaveBeenCalledTimes(1);
  });

  it('maps provider failure to provider_error and negative-caches', async () => {
    vi.mocked(fetchPointForecast).mockResolvedValue(null);
    let nowMs = 1_000;
    const svc = createWeatherService(
      {
        getAppVersion: () => 'test',
        isOnline: () => true,
        now: () => nowMs,
      },
      createWeatherProtocolState(),
    );
    await expect(svc.pointForecast(40, -105)).resolves.toEqual({
      ok: false,
      error: { code: 'provider_error', message: 'provider_error' },
    });
    nowMs += 1;
    await expect(svc.pointForecast(40, -105)).resolves.toEqual({
      ok: false,
      error: { code: 'provider_error', message: 'provider_error' },
    });
    expect(fetchPointForecast).toHaveBeenCalledTimes(1);
  });

  it('clearMemoryCache drops the point cache', async () => {
    const point = samplePoint();
    vi.mocked(fetchPointForecast).mockResolvedValue(point);
    const svc = createWeatherService(
      {
        getAppVersion: () => 'test',
        isOnline: () => true,
        now: () => 1_000,
      },
      createWeatherProtocolState(),
    );
    await svc.pointForecast(40, -105);
    svc.clearMemoryCache();
    await svc.pointForecast(40, -105);
    expect(fetchPointForecast).toHaveBeenCalledTimes(2);
  });

  it('returns iem-nexrad radar frames without fetching RainViewer', async () => {
    const svc = createWeatherService(
      {
        getAppVersion: () => 'test',
        isOnline: () => true,
        now: () => 1_700_000_000_000,
      },
      createWeatherProtocolState(),
    );
    const res = await svc.radarFrames({
      bounds: { west: -105.5, south: 39.5, east: -104.5, north: 40.5 },
      zoom: 8,
      provider: 'iem-nexrad',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.provider).toBe('iem-nexrad');
    }
    expect(fetchRainViewerManifest).not.toHaveBeenCalled();
  });
});
