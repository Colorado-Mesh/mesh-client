import { create } from 'zustand';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';

import { getAppSettingsRaw, mergeAppSetting } from '../lib/appSettingsStorage';
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
  };
}

interface MapLayerState {
  basemapId: MapBasemapId;
  showNodes: boolean;
  showWaypoints: boolean;
  showMgrsGrid: boolean;
  showIncidents: boolean;
  layersPanelOpen: boolean;
  setBasemapId: (id: MapBasemapId) => void;
  setShowNodes: (enabled: boolean) => void;
  setShowWaypoints: (enabled: boolean) => void;
  setShowMgrsGrid: (enabled: boolean) => void;
  setShowIncidents: (enabled: boolean) => void;
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
