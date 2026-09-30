import { forward as mgrsForward } from 'mgrs';
import { describe, expect, it } from 'vitest';

import { parseLatLonPair } from './coordinateInput';

const DENVER = { lat: 39.7392, lon: -104.9903 };

function expectNear(
  actual: { lat: number; lon: number } | null,
  expected: { lat: number; lon: number },
  digits = 4,
) {
  expect(actual).not.toBeNull();
  expect(actual?.lat).toBeCloseTo(expected.lat, digits);
  expect(actual?.lon).toBeCloseTo(expected.lon, digits);
}

describe('parseLatLonPair', () => {
  it.each([
    '39.7392, -104.9903',
    '39.7392 -104.9903',
    '39.7392°, -104.9903°',
    ' 39.7392;-104.9903 ',
    '(39.7392, -104.9903)',
    '[39.7392,-104.9903]',
    '+39.7392, -104.9903',
    '39.73920000, -104.99030000',
  ])('parses decimal %s', (input) => {
    expect(parseLatLonPair(input)).toEqual(DENVER);
  });

  it.each([
    ['39.7392° N, 104.9903° W', DENVER],
    ['39.7392N 104.9903W', DENVER],
    ['N 39.7392, W 104.9903', DENVER],
    ['W104.9903 N39.7392', DENVER],
    ['33.8688° S, 151.2093° E', { lat: -33.8688, lon: 151.2093 }],
  ])('parses hemisphere letters %s', (input, expected) => {
    expectNear(parseLatLonPair(input), expected);
  });

  it.each([
    `39°44'21.1"N 104°59'25.1"W`,
    '39°44′21.1″N 104°59′25.1″W',
    '39 44 21.1 N, 104 59 25.1 W',
    `N 39° 44' 21.1" W 104° 59' 25.1"`,
    '39 44 21.1, -104 59 25.1',
  ])('parses degrees-minutes-seconds %s', (input) => {
    expectNear(parseLatLonPair(input), DENVER, 3);
  });

  it.each(['39 44.352 N 104 59.418 W', `N39° 44.352' W104° 59.418'`, '39 44.352, -104 59.418'])(
    'parses degrees-decimal-minutes %s',
    (input) => {
      expectNear(parseLatLonPair(input), DENVER, 3);
    },
  );

  it.each([
    'https://www.google.com/maps/@39.7392,-104.9903,15z',
    'https://www.google.com/maps/place/Denver/@39.7392,-104.9903,12z/data=!3m1',
    'https://www.google.com/maps?q=39.7392,-104.9903',
    'https://maps.google.com/?ll=39.7392,-104.9903&z=14',
    'https://maps.apple.com/?ll=39.7392,-104.9903&q=Dropped%20Pin',
    'https://www.openstreetmap.org/?mlat=39.7392&mlon=-104.9903#map=15/39.7392/-104.9903',
    'https://www.openstreetmap.org/#map=15/39.7392/-104.9903',
    'https://www.bing.com/maps?cp=39.7392~-104.9903&lvl=12',
    'geo:39.7392,-104.9903',
    'geo:39.7392,-104.9903;u=35',
  ])('parses map link %s', (input) => {
    expect(parseLatLonPair(input)).toEqual(DENVER);
  });

  it('parses MGRS with or without spaces', () => {
    const compact = mgrsForward([DENVER.lon, DENVER.lat]);
    const spaced = `${compact.slice(0, 3)} ${compact.slice(3, 5)} ${compact.slice(5, 10)} ${compact.slice(10)}`;
    expectNear(parseLatLonPair(compact), DENVER);
    expectNear(parseLatLonPair(spaced), DENVER);
    expectNear(parseLatLonPair(spaced.toLowerCase()), DENVER);
  });

  it.each([
    '',
    '39.7',
    'abc, def',
    '91, 0',
    '0, 181',
    '1, 2, 3',
    '39 61 0 N 104 0 0 W',
    '39.5 30 N 104 0 W',
    '-39.7 N 104.9 W',
    '39.7 N 40.1 S',
    '39.7 N 104.9',
    '39 44 21.1 -104 59',
    'https://example.com/about',
    'geo:',
    '13SZZ',
  ])('rejects %s', (input) => {
    expect(parseLatLonPair(input)).toBeNull();
  });
});
