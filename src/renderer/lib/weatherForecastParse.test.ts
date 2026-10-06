import { describe, expect, it } from 'vitest';

import {
  completeTruncatedIssued,
  forecastTempCelsius,
  isWeatherRequestCommand,
  normalizePlaceKey,
  parsePlaceLabel,
  parseWeatherForecastPost,
  stripBotPrefixes,
} from './weatherForecastParse';

describe('stripBotPrefixes', () => {
  it('strips multipart and mention prefixes in either order', () => {
    expect(stripBotPrefixes('[1/2] @[pokey MeshPocket] Brighton, CO')).toEqual({
      text: 'Brighton, CO',
      part: { index: 1, total: 2 },
    });
    expect(stripBotPrefixes('@[bob] [2/3] rest').part).toEqual({ index: 2, total: 3 });
    expect(stripBotPrefixes('plain').part).toBeUndefined();
  });
});

describe('parsePlaceLabel', () => {
  it('splits name, qualifiers and a US ZIP', () => {
    expect(parsePlaceLabel('Aurora, CO 80013')).toEqual({
      label: 'Aurora, CO 80013',
      name: 'Aurora',
      qualifiers: ['CO'],
      postcode: '80013',
    });
  });

  it('handles international forms', () => {
    expect(parsePlaceLabel('Paris, FR')).toMatchObject({ name: 'Paris', qualifiers: ['FR'] });
    expect(parsePlaceLabel('Vancouver, BC, Canada')).toMatchObject({
      name: 'Vancouver',
      qualifiers: ['BC', 'Canada'],
    });
    expect(parsePlaceLabel('London, SW1A 1AA')).toMatchObject({
      name: 'London',
      qualifiers: [],
      postcode: 'SW1A 1AA',
    });
  });

  it('rejects empty or numeric-only names', () => {
    expect(parsePlaceLabel('  ')).toBeNull();
    expect(parsePlaceLabel('80013')).toBeNull();
  });

  it('normalizes keys case- and space-insensitively', () => {
    expect(normalizePlaceKey({ name: 'Aurora ', qualifiers: [' co'] })).toBe(
      normalizePlaceKey({ name: 'aurora', qualifiers: ['CO'] }),
    );
  });
});

describe('parseWeatherForecastPost: nwsPipe (user examples)', () => {
  it('parses the Aurora post', () => {
    const p = parseWeatherForecastPost(
      'Aurora, CO 80013 | NWS forecast\nTonight: 59°F Mostly Clear | S 6 to 9 mph | precip 2%\nIssued 10/05 12:46 MDT',
    );
    expect(p).toMatchObject({
      profileId: 'nwsPipe',
      locationSource: 'placeName',
      place: { name: 'Aurora', qualifiers: ['CO'], postcode: '80013' },
      period: 'Tonight',
      tempValue: 59,
      tempUnit: 'F',
      issuedAt: '10/05 12:46 MDT',
    });
    expect(p?.segments).toEqual(['Tonight: 59°F Mostly Clear | S 6 to 9 mph | precip 2%']);
  });

  it('parses the multipart Brighton reply with a mention', () => {
    const p = parseWeatherForecastPost(
      '[1/2] @[pokey MeshPocket] Brighton, CO 80602 | NWS forecast\nThis Afternoon: 88°F Sunny | SSE 5 mph | precip 2%\nIssued 10/05.',
    );
    expect(p).toMatchObject({
      profileId: 'nwsPipe',
      place: { name: 'Brighton', qualifiers: ['CO'], postcode: '80602' },
      period: 'This Afternoon',
      tempValue: 88,
      tempUnit: 'F',
      issuedAt: '10/05',
      issuedTruncated: true,
    });
  });

  it('flags a bare Issued line cut off at the end of a [1/N] post', () => {
    const p = parseWeatherForecastPost(
      '[1/2] @[TL-Tag] Colorado Springs, CO 80905 | NWS forecast\nTonight: 55°F Mostly Clear | NW 0 to 5 mph | precip 0%\nIssued',
    );
    expect(p?.issuedAt).toBeUndefined();
    expect(p?.issuedTruncated).toBe(true);
    expect(p?.segments).toEqual(['Tonight: 55°F Mostly Clear | NW 0 to 5 mph | precip 0%']);
  });

  it('does not flag complete or single-part Issued lines', () => {
    const complete = parseWeatherForecastPost(
      '[1/2] Aurora, CO 80013 | NWS forecast\nTonight: 59°F Clear\nIssued 10/05 12:46 MDT',
    );
    expect(complete?.issuedTruncated).toBeUndefined();
    const single = parseWeatherForecastPost(
      'Aurora, CO 80013 | NWS forecast\nTonight: 59°F Clear\nIssued 10/05',
    );
    expect(single).toMatchObject({ issuedAt: '10/05' });
    expect(single?.issuedTruncated).toBeUndefined();
  });
});

describe('completeTruncatedIssued', () => {
  it('takes a continuation that repeats the date with a time', () => {
    expect(completeTruncatedIssued('10/05', '10/05 20:52 MDT')).toBe('10/05 20:52 MDT');
    expect(completeTruncatedIssued(undefined, '10/05 20:52 MDT')).toBe('10/05 20:52 MDT');
  });

  it('appends a time-only continuation to the partial date', () => {
    expect(completeTruncatedIssued('10/05', '20:52 MDT')).toBe('10/05 20:52 MDT');
  });

  it('rejects lines that are not the rest of the Issued value', () => {
    expect(completeTruncatedIssued('10/05', 'Tonight: 55°F Clear')).toBeNull();
    expect(completeTruncatedIssued('10/05', '10/06 08:00 MDT')).toBeNull();
    expect(completeTruncatedIssued(undefined, '20:52 MDT')).toBeNull();
  });
});

describe('parseWeatherForecastPost: meshcoreBot', () => {
  it('parses a US wx reply with emoji and multiple periods', () => {
    const p = parseWeatherForecastPost(
      'Seattle, WA: Tonight: 🌙Clear 52°F NW8 🌦️20% | Tomorrow: ☀️Sunny 75°/52° SW5',
    );
    expect(p).toMatchObject({
      profileId: 'meshcoreBot',
      locationSource: 'placeName',
      place: { name: 'Seattle', qualifiers: ['WA'] },
      period: 'Tonight',
      tempValue: 52,
      tempUnit: 'F',
      summary: 'Tonight: Clear 52°F NW8 20%',
    });
    expect(p?.segments).toHaveLength(2);
  });

  it('parses an international gwx reply in Celsius', () => {
    const p = parseWeatherForecastPost(
      'Berlin, DE: Today: ⛅Partly cloudy 18°C W12 | Tonight: 🌙Clear 9°C',
    );
    expect(p).toMatchObject({
      profileId: 'meshcoreBot',
      place: { name: 'Berlin', qualifiers: ['DE'] },
      tempValue: 18,
      tempUnit: 'C',
    });
  });

  it('parses a high/low first period', () => {
    const p = parseWeatherForecastPost('Paris, FR: Tomorrow: ☀️Sunny 24°/13°C');
    expect(p?.highLow).toEqual({ high: 24, low: 13 });
    expect(p?.tempUnit).toBe('C');
  });
});

describe('parseWeatherForecastPost: meshing-around', () => {
  it('parses an Open-Meteo reply (F)', () => {
    const p = parseWeatherForecastPost(
      'Today, Cond: Clear sky. High: 75F, with a low of 52F. No Precip. Wind: 10mph, gusts up to 15mph from:NW.\nTomorrow, Cond: Overcast. High: 70F, with a low of 50F. No Precip. No Wind',
    );
    expect(p).toMatchObject({
      profileId: 'meshingAroundMeteo',
      locationSource: 'requester',
      period: 'Today',
      tempValue: 75,
      tempUnit: 'F',
      highLow: { high: 75, low: 52 },
      summary: 'Today: Clear sky',
    });
    expect(p?.place).toBeUndefined();
    expect(p?.segments).toHaveLength(2);
  });

  it('parses an Open-Meteo reply (C)', () => {
    const p = parseWeatherForecastPost(
      'Today, Cond: Rain: Slight. High: 14C, with a low of 8C. Precip: 80% chance, in 4 hours. ',
    );
    expect(p).toMatchObject({ tempValue: 14, tempUnit: 'C', highLow: { high: 14, low: 8 } });
  });

  it('parses a NOAA reply with abbreviations and an alert count', () => {
    const p = parseWeatherForecastPost(
      '2 local alerts!\nTonight: Mostly clear, with a low ~ 52. SW wind 5 to 10 mph.\nMon: Sunny, with a high near 75.\nRed Flag Warning',
    );
    expect(p).toMatchObject({
      profileId: 'meshingAroundNoaa',
      locationSource: 'requester',
      period: 'Tonight',
      tempValue: 52,
      tempUnit: 'F',
      hasAlerts: true,
    });
    expect(p?.segments).toEqual([
      'Tonight: Mostly clear, with a low ~ 52. SW wind 5 to 10 mph.',
      'Mon: Sunny, with a high near 75.',
    ]);
  });

  it('treats NOAA replies with km/h as metric', () => {
    const p = parseWeatherForecastPost('This Aftn: Sunny, with a high near 24. W wind 10 km/h.');
    expect(p).toMatchObject({ profileId: 'meshingAroundNoaa', tempValue: 24, tempUnit: 'C' });
  });
});

describe('parseWeatherForecastPost: non-forecasts', () => {
  it.each([
    'Good morning everyone!',
    'Heading out now: see you at 5',
    '[2/2] Hazardous Weather Outlook in effect.',
    '',
  ])('returns null for %j', (text) => {
    expect(parseWeatherForecastPost(text)).toBeNull();
  });

  it('returns null for a truncated nwsPipe header with no place', () => {
    expect(parseWeatherForecastPost(' | NWS forecast')).toBeNull();
  });
});

describe('helpers', () => {
  it('converts forecast temperatures to Celsius', () => {
    expect(forecastTempCelsius({ tempValue: 212, tempUnit: 'F' })).toBe(100);
    expect(forecastTempCelsius({ tempValue: 20, tempUnit: 'C' })).toBe(20);
    expect(forecastTempCelsius({})).toBeNull();
  });

  it('detects meshing-around weather requests', () => {
    expect(isWeatherRequestCommand('wx')).toBe(true);
    expect(isWeatherRequestCommand('WXC please')).toBe(true);
    expect(isWeatherRequestCommand('@[bot] weather')).toBe(true);
    expect(isWeatherRequestCommand('wxa')).toBe(false);
    expect(isWeatherRequestCommand('the weather is nice')).toBe(false);
  });
});
