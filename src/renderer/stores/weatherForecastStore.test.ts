import { beforeEach, describe, expect, it } from 'vitest';

import { MS_PER_HOUR } from '@/shared/timeConstants';

import {
  MAX_WEATHER_FORECASTS,
  selectActiveForecasts,
  useWeatherForecastStore,
  WEATHER_FORECAST_MAX_AGE_MS,
  type WeatherForecastEntry,
} from './weatherForecastStore';

const NOW = 1_800_000_000_000;

function entry(
  key: string,
  receivedAt: number,
  extra: Partial<WeatherForecastEntry> = {},
): WeatherForecastEntry {
  return {
    key,
    lat: 39.7,
    lon: -104.8,
    positionSource: 'gazetteer',
    profileId: 'nwsPipe',
    period: 'Tonight',
    summary: 'Clear',
    segments: ['Tonight: 59°F Clear'],
    hasAlerts: false,
    receivedAt,
    protocol: 'meshtastic',
    senderId: 1,
    messageId: `${key}-${receivedAt}`,
    ...extra,
  };
}

describe('weatherForecastStore', () => {
  beforeEach(() => {
    useWeatherForecastStore.getState().clearForecasts();
  });

  it('keeps the newest post for a place', () => {
    const { upsertForecast } = useWeatherForecastStore.getState();
    expect(upsertForecast(entry('a', NOW - 1000, { summary: 'new' }), NOW)).toBe(true);
    expect(upsertForecast(entry('a', NOW - 5000, { summary: 'old' }), NOW)).toBe(false);
    expect(useWeatherForecastStore.getState().entries.a.summary).toBe('new');
  });

  it('expires forecasts after 12 hours', () => {
    const { upsertForecast } = useWeatherForecastStore.getState();
    expect(upsertForecast(entry('fresh', NOW - 11 * MS_PER_HOUR), NOW)).toBe(true);
    expect(upsertForecast(entry('stale', NOW - 13 * MS_PER_HOUR), NOW)).toBe(false);
  });

  it('rejects and prunes expired forecasts', () => {
    const { upsertForecast } = useWeatherForecastStore.getState();
    expect(upsertForecast(entry('old', NOW - WEATHER_FORECAST_MAX_AGE_MS - 1), NOW)).toBe(false);
    upsertForecast(entry('a', NOW - 1000), NOW - 2000);
    upsertForecast(
      entry('b', NOW + WEATHER_FORECAST_MAX_AGE_MS),
      NOW + WEATHER_FORECAST_MAX_AGE_MS,
    );
    expect(Object.keys(useWeatherForecastStore.getState().entries)).toEqual(['b']);
  });

  it('caps the number of forecasts, dropping the oldest', () => {
    const { upsertForecast } = useWeatherForecastStore.getState();
    for (let i = 0; i <= MAX_WEATHER_FORECASTS; i++)
      upsertForecast(entry(`k${i}`, NOW - 100_000 + i), NOW);
    const { entries } = useWeatherForecastStore.getState();
    expect(Object.keys(entries)).toHaveLength(MAX_WEATHER_FORECASTS);
    expect(entries.k0).toBeUndefined();
  });

  it('appends continuation segments only to the matching head message', () => {
    const { upsertForecast, appendSegments } = useWeatherForecastStore.getState();
    const head = entry('a', NOW - 1000);
    upsertForecast(head, NOW);
    appendSegments('a', 'other', ['ignored']);
    appendSegments('a', head.messageId, ['Tonight: 55°F']);
    expect(useWeatherForecastStore.getState().entries.a.segments).toEqual([
      'Tonight: 59°F Clear',
      'Tonight: 55°F',
    ]);
  });

  it('completes a cut-off issued time only for the matching head message', () => {
    const { upsertForecast, completeIssued } = useWeatherForecastStore.getState();
    const head = entry('a', NOW - 1000, { issuedAt: '10/05', issuedTruncated: true });
    upsertForecast(head, NOW);
    completeIssued('a', 'other', '10/05 09:00 MDT');
    expect(useWeatherForecastStore.getState().entries.a.issuedAt).toBe('10/05');
    completeIssued('a', head.messageId, '10/05 14:52 MDT');
    expect(useWeatherForecastStore.getState().entries.a).toMatchObject({
      issuedAt: '10/05 14:52 MDT',
      issuedTruncated: false,
    });
  });

  it('selects live forecasts newest first', () => {
    const entries = {
      a: entry('a', NOW - 2000),
      b: entry('b', NOW - 1000),
      c: entry('c', NOW - WEATHER_FORECAST_MAX_AGE_MS - 1),
    };
    expect(selectActiveForecasts(entries, NOW).map((e) => e.key)).toEqual(['b', 'a']);
  });
});
