import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { getAppSettingsRaw, mergeAppSetting } from '../lib/appSettingsStorage';
import { isMapSensorMetric, type MapSensorMetric } from '../lib/environmentSensorDisplay';
import {
  DEFAULT_MAP_BASEMAP_ID,
  isValidMapBasemapId,
  type MapBasemapId,
} from '../lib/mapBasemapUtils';
import { parseStoredJson } from '../lib/parseStoredJson';

interface MapLayerPersisted {
  mapBasemapId?: unknown;
  mapShowNodes?: unknown;
  mapShowWaypoints?: unknown;
  mapShowMgrsGrid?: unknown;
  mapShowIncidents?: unknown;
  mapShowSensors?: unknown;
  mapSensorMetric?: unknown;
  mapShowTakContacts?: unknown;
  mapShowWeatherForecasts?: unknown;
  mapShowRadar?: unknown;
  mapShowWeatherTemperature?: unknown;
  mapShowWeatherWind?: unknown;
}

export function readPersistedBoolean(value: unknown, defaultValue: boolean): boolean {
  return typeof value === 'boolean' ? value : defaultValue;
}

function loadPersisted(): {
  basemapId: MapBasemapId;
  showNodes: boolean;
  showWaypoints: boolean;
  showMgrsGrid: boolean;
  showIncidents: boolean;
  showSensors: boolean;
  sensorMetric: MapSensorMetric;
  showTakContacts: boolean;
  showWeatherForecasts: boolean;
  showRadar: boolean;
  showWeatherTemperature: boolean;
  showWeatherWind: boolean;
} {
  const settings = parseStoredJson<MapLayerPersisted>(
    getAppSettingsRaw(),
    'mapLayerStore loadPersisted',
  );
  return {
    basemapId:
      settings?.mapBasemapId != null && isValidMapBasemapId(settings.mapBasemapId)
        ? settings.mapBasemapId
        : DEFAULT_MAP_BASEMAP_ID,
    showNodes: readPersistedBoolean(settings?.mapShowNodes, true),
    showWaypoints: readPersistedBoolean(settings?.mapShowWaypoints, true),
    showMgrsGrid: readPersistedBoolean(settings?.mapShowMgrsGrid, false),
    showIncidents: readPersistedBoolean(settings?.mapShowIncidents, true),
    showSensors: readPersistedBoolean(settings?.mapShowSensors, false),
    sensorMetric: isMapSensorMetric(settings?.mapSensorMetric)
      ? settings.mapSensorMetric
      : 'temperature',
    showTakContacts: readPersistedBoolean(settings?.mapShowTakContacts, true),
    showWeatherForecasts: readPersistedBoolean(settings?.mapShowWeatherForecasts, true),
    showRadar: readPersistedBoolean(settings?.mapShowRadar, false),
    showWeatherTemperature: readPersistedBoolean(settings?.mapShowWeatherTemperature, false),
    showWeatherWind: readPersistedBoolean(settings?.mapShowWeatherWind, false),
  };
}

interface MapLayerState {
  basemapId: MapBasemapId;
  showNodes: boolean;
  showWaypoints: boolean;
  showMgrsGrid: boolean;
  showIncidents: boolean;
  showSensors: boolean;
  sensorMetric: MapSensorMetric;
  showTakContacts: boolean;
  showWeatherForecasts: boolean;
  showRadar: boolean;
  showWeatherTemperature: boolean;
  showWeatherWind: boolean;
  layersPanelOpen: boolean;
  setBasemapId: (id: MapBasemapId) => void;
  setShowNodes: (enabled: boolean) => void;
  setShowWaypoints: (enabled: boolean) => void;
  setShowMgrsGrid: (enabled: boolean) => void;
  setShowIncidents: (enabled: boolean) => void;
  setShowSensors: (enabled: boolean) => void;
  setSensorMetric: (metric: MapSensorMetric) => void;
  setShowTakContacts: (enabled: boolean) => void;
  setShowWeatherForecasts: (enabled: boolean) => void;
  setShowRadar: (enabled: boolean) => void;
  setShowWeatherTemperature: (enabled: boolean) => void;
  setShowWeatherWind: (enabled: boolean) => void;
  setLayersPanelOpen: (open: boolean) => void;
  hydrateFromDatabase: () => Promise<void>;
}

const initial = loadPersisted();

function persistBasemapToDatabase(basemapId: MapBasemapId): void {
  void window.electronAPI.appSettings.set('mapBasemapId', basemapId).catch((e: unknown) => {
    console.warn('[mapLayerStore] appSettings.set mapBasemapId failed ' + errLikeToLogString(e));
  });
}

export const useMapLayerStore = create<MapLayerState>((set, get) => ({
  basemapId: initial.basemapId,
  showNodes: initial.showNodes,
  showWaypoints: initial.showWaypoints,
  showMgrsGrid: initial.showMgrsGrid,
  showIncidents: initial.showIncidents,
  showSensors: initial.showSensors,
  sensorMetric: initial.sensorMetric,
  showTakContacts: initial.showTakContacts,
  showWeatherForecasts: initial.showWeatherForecasts,
  showRadar: initial.showRadar,
  showWeatherTemperature: initial.showWeatherTemperature,
  showWeatherWind: initial.showWeatherWind,
  layersPanelOpen: false,
  setBasemapId: (basemapId) => {
    mergeAppSetting('mapBasemapId', basemapId, 'mapLayerStore setBasemapId');
    persistBasemapToDatabase(basemapId);
    set({ basemapId });
  },
  setShowNodes: (showNodes) => {
    mergeAppSetting('mapShowNodes', showNodes, 'mapLayerStore setShowNodes');
    set({ showNodes });
  },
  setShowWaypoints: (showWaypoints) => {
    mergeAppSetting('mapShowWaypoints', showWaypoints, 'mapLayerStore setShowWaypoints');
    set({ showWaypoints });
  },
  setShowMgrsGrid: (showMgrsGrid) => {
    mergeAppSetting('mapShowMgrsGrid', showMgrsGrid, 'mapLayerStore setShowMgrsGrid');
    set({ showMgrsGrid });
  },
  setShowIncidents: (showIncidents) => {
    mergeAppSetting('mapShowIncidents', showIncidents, 'mapLayerStore setShowIncidents');
    set({ showIncidents });
  },
  setShowSensors: (showSensors) => {
    mergeAppSetting('mapShowSensors', showSensors, 'mapLayerStore setShowSensors');
    set({ showSensors });
  },
  setSensorMetric: (sensorMetric) => {
    mergeAppSetting('mapSensorMetric', sensorMetric, 'mapLayerStore setSensorMetric');
    set({ sensorMetric });
  },
  setShowTakContacts: (showTakContacts) => {
    mergeAppSetting('mapShowTakContacts', showTakContacts, 'mapLayerStore setShowTakContacts');
    set({ showTakContacts });
  },
  setShowWeatherForecasts: (showWeatherForecasts) => {
    mergeAppSetting(
      'mapShowWeatherForecasts',
      showWeatherForecasts,
      'mapLayerStore setShowWeatherForecasts',
    );
    set({ showWeatherForecasts });
  },
  setShowRadar: (showRadar) => {
    mergeAppSetting('mapShowRadar', showRadar, 'mapLayerStore setShowRadar');
    set({ showRadar });
  },
  setShowWeatherTemperature: (showWeatherTemperature) => {
    mergeAppSetting(
      'mapShowWeatherTemperature',
      showWeatherTemperature,
      'mapLayerStore setShowWeatherTemperature',
    );
    set({ showWeatherTemperature });
  },
  setShowWeatherWind: (showWeatherWind) => {
    mergeAppSetting('mapShowWeatherWind', showWeatherWind, 'mapLayerStore setShowWeatherWind');
    set({ showWeatherWind });
  },
  setLayersPanelOpen: (layersPanelOpen) => {
    set({ layersPanelOpen });
  },
  hydrateFromDatabase: async () => {
    try {
      const db = await window.electronAPI.appSettings.getAll();
      const fromDb = db.mapBasemapId;
      if (fromDb != null && isValidMapBasemapId(fromDb)) {
        if (get().basemapId !== fromDb) {
          mergeAppSetting('mapBasemapId', fromDb, 'mapLayerStore hydrateFromDatabase');
          set({ basemapId: fromDb });
        }
        return;
      }
      persistBasemapToDatabase(get().basemapId);
    } catch (e) {
      console.warn('[mapLayerStore] hydrateFromDatabase failed ' + errLikeToLogString(e));
    }
  },
}));
