import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  net: { isOnline: () => true },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

import { ipcMain } from 'electron';

import { assertIpcSender } from '../validate-ipc-sender';
import { registerWeatherIpcHandlers, resetWeatherServiceForTests } from './weather-handlers';

type Handler = (event: unknown, raw?: unknown) => Promise<unknown>;

function handlers(): Map<string, Handler> {
  const map = new Map<string, Handler>();
  for (const call of vi.mocked(ipcMain.handle).mock.calls) {
    map.set(call[0], call[1] as Handler);
  }
  return map;
}

describe('weather-handlers', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    vi.mocked(assertIpcSender).mockClear();
    resetWeatherServiceForTests();
    registerWeatherIpcHandlers({
      getAppVersion: () => '0.0.0-test',
      isOnline: () => true,
      fetchImpl: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ latitude: 1, longitude: 2, current: { temperature_2m: 3 } }),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            },
          ),
        ),
    });
  });

  it('calls assertIpcSender on each channel', async () => {
    const map = handlers();
    for (const channel of [
      'weather:pointForecast',
      'weather:grid',
      'weather:radarFrames',
      'weather:clearMemoryCache',
    ]) {
      await map.get(channel)!({}, { lat: 1, lon: 2 });
      expect(assertIpcSender).toHaveBeenCalledWith(expect.anything(), channel);
    }
  });

  it('returns invalid_request for bad payloads', async () => {
    const map = handlers();
    const res = await map.get('weather:pointForecast')!({}, { lat: 'x' });
    expect(res).toEqual({
      ok: false,
      error: { code: 'invalid_request', message: 'invalid_request' },
    });
  });

  it('short-circuits when offline', async () => {
    resetWeatherServiceForTests();
    vi.mocked(ipcMain.handle).mockClear();
    registerWeatherIpcHandlers({
      getAppVersion: () => '0.0.0-test',
      isOnline: () => false,
    });
    const map = handlers();
    const res = await map.get('weather:pointForecast')!({}, { lat: 10, lon: 20 });
    expect(res).toEqual({ ok: false, error: { code: 'offline', message: 'offline' } });
  });
});
