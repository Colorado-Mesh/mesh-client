import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from '../lib/appSettingsStorage';
import { readPersistedBoolean, useMapLayerStore } from './mapLayerStore';

describe('mapLayerStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValue({});
    useMapLayerStore.setState({
      basemapId: 'osm',
      showNodes: true,
      showWaypoints: true,
      layersPanelOpen: false,
    });
  });

  it('updates basemap and layer visibility', () => {
    useMapLayerStore.getState().setBasemapId('dark');
    useMapLayerStore.getState().setShowNodes(false);
    expect(useMapLayerStore.getState().basemapId).toBe('dark');
    expect(useMapLayerStore.getState().showNodes).toBe(false);
  });

  it('persists basemap to localStorage and SQLite on change', () => {
    useMapLayerStore.getState().setBasemapId('dark');
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed.mapBasemapId).toBe('dark');
    expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith('mapBasemapId', 'dark');
  });

  it('hydrates basemap from SQLite when present', async () => {
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValueOnce({
      mapBasemapId: 'dark',
    });
    await useMapLayerStore.getState().hydrateFromDatabase();
    expect(useMapLayerStore.getState().basemapId).toBe('dark');
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed.mapBasemapId).toBe('dark');
  });

  it('persists the sensor layer toggle and metric', () => {
    useMapLayerStore.getState().setShowSensors(true);
    useMapLayerStore.getState().setSensorMetric('barometricPressure');
    expect(useMapLayerStore.getState().showSensors).toBe(true);
    expect(useMapLayerStore.getState().sensorMetric).toBe('barometricPressure');
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed.mapShowSensors).toBe(true);
    expect(parsed.mapSensorMetric).toBe('barometricPressure');
  });

  it('shows weather forecasts by default and persists the toggle', () => {
    expect(useMapLayerStore.getState().showWeatherForecasts).toBe(true);
    useMapLayerStore.getState().setShowWeatherForecasts(false);
    expect(useMapLayerStore.getState().showWeatherForecasts).toBe(false);
    const parsed = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    expect(parsed.mapShowWeatherForecasts).toBe(false);
  });

  it('readPersistedBoolean ignores non-boolean strings', () => {
    expect(readPersistedBoolean('false', true)).toBe(true);
    expect(readPersistedBoolean(false, true)).toBe(false);
    expect(readPersistedBoolean(true, false)).toBe(true);
  });

  it('seeds SQLite from current basemap when DB has no value', async () => {
    useMapLayerStore.setState({ basemapId: 'dark' });
    await useMapLayerStore.getState().hydrateFromDatabase();
    expect(window.electronAPI.appSettings.set).toHaveBeenCalledWith('mapBasemapId', 'dark');
  });
});
