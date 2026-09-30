import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GPS_SETTINGS_STORAGE_KEY, persistStoredStaticGps, readStoredStaticGps } from './gpsSource';
import {
  activateSavedLocation,
  deactivateSavedLocation,
  deleteSavedLocation,
  getActiveSavedLocation,
  parseLatLonPair,
  readSavedLocations,
  resetSavedLocationsCacheForTests,
  SAVED_LOCATIONS_STORAGE_KEY,
  saveNewLocation,
  updateSavedLocation,
} from './savedLocations';

function storedGpsSettings(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(GPS_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
    string,
    unknown
  >;
}

describe('savedLocations', () => {
  beforeEach(() => {
    localStorage.removeItem(GPS_SETTINGS_STORAGE_KEY);
    localStorage.removeItem(SAVED_LOCATIONS_STORAGE_KEY);
    resetSavedLocationsCacheForTests();
  });

  afterEach(() => {
    localStorage.removeItem(GPS_SETTINGS_STORAGE_KEY);
    localStorage.removeItem(SAVED_LOCATIONS_STORAGE_KEY);
    resetSavedLocationsCacheForTests();
  });

  it('starts empty and writes nothing when there is no static position', () => {
    expect(readSavedLocations()).toEqual({ locations: [], activeId: null });
    expect(localStorage.getItem(SAVED_LOCATIONS_STORAGE_KEY)).toBeNull();
  });

  it('saving a location activates it and mirrors coords into gpsSettings with polling off', () => {
    localStorage.setItem(GPS_SETTINGS_STORAGE_KEY, JSON.stringify({ refreshInterval: 900 }));
    const home = saveNewLocation({ name: '  Home ', lat: 39.7392, lon: -104.9903 });
    expect(home.name).toBe('Home');
    expect(getActiveSavedLocation()?.id).toBe(home.id);
    expect(readStoredStaticGps()).toEqual({ lat: 39.7392, lon: -104.9903 });
    expect(storedGpsSettings().refreshInterval).toBe(0);
  });

  it('switching between Home and EOC updates the static position', () => {
    const home = saveNewLocation({ name: 'Home', lat: 39.7392, lon: -104.9903 });
    const eoc = saveNewLocation({ name: 'EOC', lat: 40.015, lon: -105.2705 });
    expect(getActiveSavedLocation()?.id).toBe(eoc.id);
    activateSavedLocation(home.id);
    expect(getActiveSavedLocation()?.name).toBe('Home');
    expect(readStoredStaticGps()).toEqual({ lat: 39.7392, lon: -104.9903 });
  });

  it('migrates a pre-existing static position into an unnamed active location', () => {
    localStorage.setItem(
      GPS_SETTINGS_STORAGE_KEY,
      JSON.stringify({ staticLat: 39.1, staticLon: -104.2 }),
    );
    const state = readSavedLocations();
    expect(state.locations).toHaveLength(1);
    expect(state.locations[0]).toMatchObject({ name: '', lat: 39.1, lon: -104.2 });
    expect(state.activeId).toBe(state.locations[0]?.id);
    expect(localStorage.getItem(SAVED_LOCATIONS_STORAGE_KEY)).not.toBeNull();
  });

  it('follows static writes from other paths (Radio panel / MeshCore advert sync)', () => {
    const home = saveNewLocation({ name: 'Home', lat: 39.7392, lon: -104.9903 });
    persistStoredStaticGps(38.8339, -104.8214);
    const active = getActiveSavedLocation();
    expect(active?.id).not.toBe(home.id);
    expect(active).toMatchObject({ lat: 38.8339, lon: -104.8214 });
    persistStoredStaticGps(39.7392, -104.9903);
    expect(getActiveSavedLocation()?.id).toBe(home.id);
  });

  it('deleting the active location clears the static position', () => {
    const home = saveNewLocation({ name: 'Home', lat: 39.7392, lon: -104.9903 });
    deleteSavedLocation(home.id);
    expect(readSavedLocations()).toEqual({ locations: [], activeId: null });
    expect(readStoredStaticGps()).toBeNull();
  });

  it('deactivate keeps the list but clears the static position', () => {
    saveNewLocation({ name: 'Home', lat: 39.7392, lon: -104.9903 });
    deactivateSavedLocation();
    expect(readSavedLocations().locations).toHaveLength(1);
    expect(getActiveSavedLocation()).toBeNull();
    expect(readStoredStaticGps()).toBeNull();
  });

  it('updates name and fixed flag', () => {
    const home = saveNewLocation({ name: 'Home', lat: 39.7392, lon: -104.9903 });
    updateSavedLocation(home.id, { name: ' House ', fixed: true });
    expect(getActiveSavedLocation()).toMatchObject({ name: 'House', fixed: true });
    updateSavedLocation(home.id, { fixed: false });
    expect(getActiveSavedLocation()?.fixed).toBeUndefined();
  });
});

describe('parseLatLonPair', () => {
  it.each([
    ['39.7392, -104.9903', { lat: 39.7392, lon: -104.9903 }],
    ['39.7392 -104.9903', { lat: 39.7392, lon: -104.9903 }],
    ['39.7392°, -104.9903°', { lat: 39.7392, lon: -104.9903 }],
    [' 39.7392;-104.9903 ', { lat: 39.7392, lon: -104.9903 }],
  ])('parses %s', (input, expected) => {
    expect(parseLatLonPair(input)).toEqual(expected);
  });

  it.each(['', '39.7', 'abc, def', '91, 0', '0, 181', '1, 2, 3'])('rejects %s', (input) => {
    expect(parseLatLonPair(input)).toBeNull();
  });
});
