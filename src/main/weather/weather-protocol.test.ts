import { describe, expect, it } from 'vitest';

import { radarBucketMs } from './iemRadar';
import {
  createWeatherProtocolHandler,
  createWeatherProtocolState,
  parseMeshWeatherUrl,
} from './weather-protocol';

describe('weather-protocol', () => {
  it('parses valid URLs and rejects bad ones', () => {
    expect(
      parseMeshWeatherUrl('mesh-weather://radar/rainviewer/1700000000/7/20/45.png'),
    ).toMatchObject({ provider: 'rainviewer', z: 7, x: 20, y: 45 });
    expect(
      parseMeshWeatherUrl('mesh-weather://radar/iem/5/10/1/2.png?t=1700000000000'),
    ).toMatchObject({ provider: 'iem', frameId: '5' });
    expect(parseMeshWeatherUrl('mesh-weather://radar/iem/7/10/1/2.png?t=1')).toBeNull();
    expect(parseMeshWeatherUrl('https://evil/x')).toBeNull();
    expect(parseMeshWeatherUrl('mesh-weather://radar/rainviewer/1/99/0/0.png')).toBeNull();
  });

  it('returns no-store and 503 when offline', async () => {
    const state = createWeatherProtocolState();
    const handler = createWeatherProtocolHandler(
      {
        getAppVersion: () => '0.0.0-test',
        isOnline: () => false,
      },
      state,
    );
    const res = await handler(new Request('mesh-weather://radar/rainviewer/1/0/0/0.png'));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects bad bucket for IEM', async () => {
    const state = createWeatherProtocolState();
    const now = Date.parse('2026-11-08T12:00:00Z');
    const handler = createWeatherProtocolHandler(
      {
        getAppVersion: () => '0.0.0-test',
        isOnline: () => true,
        now: () => now,
        fetchImpl: () => Promise.reject(new Error('should not fetch')),
      },
      state,
    );
    const res = await handler(new Request('mesh-weather://radar/iem/0/5/1/1.png?t=1'));
    expect(res.status).toBe(404);
  });

  it('shares one upstream fetch across concurrent callers with distinct Response bodies', async () => {
    const state = createWeatherProtocolState();
    let fetches = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const now = Date.parse('2026-11-08T12:00:00Z');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const handler = createWeatherProtocolHandler(
      {
        getAppVersion: () => '0.0.0-test',
        isOnline: () => true,
        now: () => now,
        fetchImpl: async () => {
          fetches += 1;
          await gate;
          return new Response(png, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          });
        },
      },
      state,
    );
    const url = `mesh-weather://radar/iem/0/5/1/1.png?t=${radarBucketMs(now)}`;
    const p1 = handler(new Request(url));
    const p2 = handler(new Request(url));
    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetches).toBe(1);
    expect(r1).not.toBe(r2);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(Buffer.from(await r1.arrayBuffer())).toEqual(png);
    expect(Buffer.from(await r2.arrayBuffer())).toEqual(png);
  });
});
