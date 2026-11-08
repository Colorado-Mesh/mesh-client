import { describe, expect, it } from 'vitest';

import { fetchGrid, fetchPointForecast } from './openMeteo';

const pointPayload = {
  latitude: 47.6,
  longitude: -122.3,
  elevation: 93,
  utc_offset_seconds: -28800,
  timezone: 'America/Los_Angeles',
  current: {
    time: 1_700_000_000,
    temperature_2m: 8.4,
    precipitation: 0.2,
    weather_code: 53,
    wind_speed_10m: 3.1,
    wind_direction_10m: 180,
    wind_gusts_10m: 5,
    relative_humidity_2m: 80,
    apparent_temperature: 7,
    cloud_cover: 90,
    pressure_msl: 1012,
    visibility: 10000,
    is_day: 1,
  },
  hourly: {
    time: [1_700_000_000, 1_700_003_600],
    temperature_2m: [8.1, 8.8],
    apparent_temperature: [7, 8],
    precipitation: [0, 0.1],
    precipitation_probability: [10, 20],
    weather_code: [3, 61],
    wind_speed_10m: [2, 3],
    wind_direction_10m: [90, 100],
    wind_gusts_10m: [4, 5],
  },
  daily: {
    time: ['2026-11-08'],
    temperature_2m_max: [11.2],
    temperature_2m_min: [5.1],
    precipitation_sum: [1.2],
    precipitation_probability_max: [40],
    wind_speed_10m_max: [6],
    wind_gusts_10m_max: [10],
    weather_code: [61],
    sunrise: ['2026-11-08T07:01'],
    sunset: ['2026-11-08T16:40'],
  },
};

describe('openMeteo', () => {
  it('parses a single-object point forecast', async () => {
    const forecast = await fetchPointForecast(47.6, -122.3, {
      getAppVersion: () => '0.0.0-test',
      fetchImpl: () =>
        Promise.resolve(
          new Response(JSON.stringify(pointPayload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    });
    expect(forecast).not.toBeNull();
    expect(forecast!.current?.temperatureC).toBe(8.4);
    expect(forecast!.hourly).toHaveLength(2);
    expect(forecast!.daily[0]?.dateIso).toBe('2026-11-08');
    expect(forecast!.hourly[0]?.timeMs).toBe(1_700_000_000_000);
  });

  it('parses a multi-location grid array', async () => {
    const grid = await fetchGrid(
      [
        { lat: 47.6, lon: -122.3 },
        { lat: 47.7, lon: -122.3 },
      ],
      {
        getAppVersion: () => '0.0.0-test',
        fetchImpl: () =>
          Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  location_id: 0,
                  latitude: 47.6,
                  longitude: -122.3,
                  current: { temperature_2m: 8, wind_speed_10m: 2, wind_direction_10m: 90 },
                },
                {
                  location_id: 1,
                  latitude: 47.7,
                  longitude: -122.3,
                  current: { temperature_2m: 9, wind_speed_10m: 3, wind_direction_10m: 100 },
                },
              ]),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          ),
      },
    );
    expect(grid).not.toBeNull();
    expect(grid!.points).toHaveLength(2);
    expect(grid!.partial).toBe(false);
    expect(grid!.points[0]?.temperatureC).toBe(8);
  });

  it('marks partial when fewer points returned', async () => {
    const grid = await fetchGrid(
      [
        { lat: 1, lon: 2 },
        { lat: 3, lon: 4 },
      ],
      {
        getAppVersion: () => '0.0.0-test',
        fetchImpl: () =>
          Promise.resolve(
            new Response(
              JSON.stringify([
                {
                  location_id: 0,
                  latitude: 1,
                  longitude: 2,
                  current: { temperature_2m: 1 },
                },
              ]),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          ),
      },
    );
    expect(grid!.partial).toBe(true);
    expect(grid!.points).toHaveLength(1);
  });
});
