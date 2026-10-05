import { describe, expect, it } from 'vitest';

import { parseAppleMapsLlCoords, parseGoogleMapsQueryCoords } from './chatLocationUtils';
import { formatDroneDistance, parseDroneReport } from './droneReportParse';

const REAL =
  'Drone: 60:60:1f:f6:d8:bc RSSI:-85 https://maps.google.com/?q=40.453457,-105.084724\r\n' +
  'Pilot: https://maps.google.com/?q=40.453606,-105.086326\r\n';

describe('map link coordinate helpers', () => {
  it('reads Google Maps ?q=lat,lon', () => {
    expect(parseGoogleMapsQueryCoords('https://maps.google.com/?q=40.454712,-105.083061')).toEqual({
      lat: 40.454712,
      lon: -105.083061,
    });
    expect(parseGoogleMapsQueryCoords('https://www.google.com/maps?q=1.5,2.5')).toEqual({
      lat: 1.5,
      lon: 2.5,
    });
  });

  it('rejects non-Google hosts, place names, and out-of-range coords', () => {
    expect(parseGoogleMapsQueryCoords('https://evil.example/?q=1,2')).toBeNull();
    expect(parseGoogleMapsQueryCoords('https://maps.google.com/?q=Denver')).toBeNull();
    expect(parseGoogleMapsQueryCoords('https://maps.google.com/?q=91,0')).toBeNull();
    expect(parseGoogleMapsQueryCoords('not a url')).toBeNull();
  });

  it('reads Apple Maps ?ll=lat,lon', () => {
    expect(parseAppleMapsLlCoords('http://maps.apple.com/?ll=40.1,-105.2&q=Pilot')).toEqual({
      lat: 40.1,
      lon: -105.2,
    });
    expect(parseAppleMapsLlCoords('https://maps.google.com/?ll=40.1,-105.2')).toBeNull();
  });
});

describe('parseDroneReport', () => {
  it('parses a real Mesh-Mapper drone + pilot message', () => {
    expect(parseDroneReport(REAL)).toEqual({
      mac: '60:60:1F:F6:D8:BC',
      rssi: -85,
      drone: { lat: 40.453457, lon: -105.084724 },
      pilot: { lat: 40.453606, lon: -105.086326 },
    });
  });

  it('accepts the firmware variants', () => {
    expect(parseDroneReport('Drone: aa:bb:cc:dd:ee:ff RSSI:-70')).toEqual({
      mac: 'AA:BB:CC:DD:EE:FF',
      rssi: -70,
    });
    expect(
      parseDroneReport('Drone: aa:bb:cc:dd:ee:ff RSSI:-70 https://maps.google.com/?q=1,2'),
    ).toMatchObject({ drone: { lat: 1, lon: 2 } });
    expect(parseDroneReport('Pilot: http://maps.apple.com/?ll=40.1,-105.2&q=Pilot')).toEqual({
      pilot: { lat: 40.1, lon: -105.2 },
    });
  });

  it('rejects near misses', () => {
    expect(parseDroneReport('Drone spotted over the park!')).toBeNull();
    expect(parseDroneReport('Drone: aa:bb:cc:dd:ee RSSI:-70')).toBeNull();
    expect(parseDroneReport('Drone: aa:bb:cc:dd:ee:ff RSSI:-70 https://example.com/x')).toBeNull();
    expect(parseDroneReport(`${REAL}\nanything else`)).toBeNull();
    expect(parseDroneReport('Pilot: Bob')).toBeNull();
    expect(parseDroneReport('')).toBeNull();
  });
});

describe('formatDroneDistance', () => {
  it('uses feet/miles or meters/km by unit', () => {
    expect(formatDroneDistance(0.137, 'miles', 'en-US')).toBe('449 ft');
    expect(formatDroneDistance(3.2, 'miles', 'en-US')).toBe('2 mi');
    expect(formatDroneDistance(0.137, 'km', 'en-US')).toBe('137 m');
    expect(formatDroneDistance(3.25, 'km', 'en-US')).toBe('3.3 km');
  });
});
