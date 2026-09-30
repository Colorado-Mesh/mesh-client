import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useDiagnosticsStore } from '../stores/diagnosticsStore';
import { GPS_SETTINGS_STORAGE_KEY } from './gpsSource';
import { publishOurPositionReference } from './ourPositionReference';
import {
  activateSavedLocation,
  resetSavedLocationsCacheForTests,
  SAVED_LOCATIONS_STORAGE_KEY,
  saveNewLocation,
} from './savedLocations';

function clearStorage(): void {
  localStorage.removeItem(GPS_SETTINGS_STORAGE_KEY);
  localStorage.removeItem(SAVED_LOCATIONS_STORAGE_KEY);
  resetSavedLocationsCacheForTests();
}

describe('publishOurPositionReference', () => {
  beforeEach(clearStorage);
  afterEach(() => {
    clearStorage();
    useDiagnosticsStore.getState().setOurPositionReference(null);
  });

  it('republishes the newly active saved location coordinates, not the last static fix', () => {
    const home = saveNewLocation({ name: 'Home', lat: 39.7, lon: -104.9 }, { activate: true });
    const eoc = saveNewLocation({ name: 'EOC', lat: 38.8, lon: -104.8, fixed: true });
    publishOurPositionReference({ lat: home.lat, lon: home.lon, source: 'static' });

    activateSavedLocation(eoc.id);

    expect(useDiagnosticsStore.getState().ourPositionReference).toEqual({
      lat: 38.8,
      lon: -104.8,
      source: 'static',
      trust: 'trusted',
    });
  });

  it('keeps device coordinates when a saved location is also active', () => {
    saveNewLocation({ name: 'Home', lat: 39.7, lon: -104.9, fixed: true }, { activate: true });
    publishOurPositionReference({ lat: 40.0, lon: -105.2, source: 'device' });

    expect(useDiagnosticsStore.getState().ourPositionReference).toMatchObject({
      lat: 40.0,
      lon: -105.2,
      source: 'device',
    });
  });
});
