import { ipcMain } from 'electron';

import type {
  WeatherGridRequest,
  WeatherPointRequest,
  WeatherRadarFramesRequest,
} from '@/shared/weather/types';
import { isFiniteNumber, isLatLon, isLatLonBounds } from '@/shared/weather/validation';

import { assertIpcSender } from '../validate-ipc-sender';
import {
  createWeatherService,
  type WeatherService,
  type WeatherServiceDeps,
} from '../weather/weather-service';

export type WeatherHandlerDeps = WeatherServiceDeps;

let service: WeatherService | null = null;

function getService(deps: WeatherHandlerDeps): WeatherService {
  service ??= createWeatherService(deps);
  return service;
}

/** Test seam: replace or clear the singleton service. */
export function resetWeatherServiceForTests(): void {
  service = null;
}

function parsePointRequest(raw: unknown): WeatherPointRequest | null {
  if (raw == null || typeof raw !== 'object') return null;
  const v = raw as Partial<WeatherPointRequest>;
  if (!isLatLon({ lat: v.lat, lon: v.lon })) return null;
  return { lat: v.lat!, lon: v.lon! };
}

function parseGridRequest(raw: unknown): WeatherGridRequest | null {
  if (raw == null || typeof raw !== 'object') return null;
  const v = raw as Partial<WeatherGridRequest>;
  if (!isLatLonBounds(v.bounds) || !isFiniteNumber(v.zoom)) return null;
  return { bounds: v.bounds, zoom: v.zoom };
}

function parseRadarRequest(raw: unknown): WeatherRadarFramesRequest | null {
  if (raw == null || typeof raw !== 'object') return null;
  const v = raw as Partial<WeatherRadarFramesRequest>;
  if (!isLatLonBounds(v.bounds) || !isFiniteNumber(v.zoom)) return null;
  const provider =
    v.provider === 'rainviewer' || v.provider === 'iem-nexrad' || v.provider === 'auto'
      ? v.provider
      : null;
  if (!provider) return null;
  return { bounds: v.bounds, zoom: v.zoom, provider };
}

export function registerWeatherIpcHandlers(deps: WeatherHandlerDeps): void {
  ipcMain.handle('weather:pointForecast', (event, raw: unknown) => {
    assertIpcSender(event, 'weather:pointForecast');
    const req = parsePointRequest(raw);
    if (!req) return { ok: false, error: { code: 'invalid_request', message: 'invalid_request' } };
    return getService(deps).pointForecast(req.lat, req.lon);
  });

  ipcMain.handle('weather:grid', (event, raw: unknown) => {
    assertIpcSender(event, 'weather:grid');
    const req = parseGridRequest(raw);
    if (!req) return { ok: false, error: { code: 'invalid_request', message: 'invalid_request' } };
    return getService(deps).grid(req.bounds, req.zoom);
  });

  ipcMain.handle('weather:radarFrames', (event, raw: unknown) => {
    assertIpcSender(event, 'weather:radarFrames');
    const req = parseRadarRequest(raw);
    if (!req) return { ok: false, error: { code: 'invalid_request', message: 'invalid_request' } };
    return getService(deps).radarFrames(req);
  });

  ipcMain.handle('weather:clearMemoryCache', (event) => {
    assertIpcSender(event, 'weather:clearMemoryCache');
    getService(deps).clearMemoryCache();
    return { ok: true as const };
  });
}
