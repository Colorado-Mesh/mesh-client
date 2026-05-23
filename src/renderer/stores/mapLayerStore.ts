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
}

function loadPersisted(): { basemapId: MapBasemapId; showNodes: boolean; showWaypoints: boolean } {
  const settings = parseStoredJson<MapLayerPersisted>(
    getAppSettingsRaw(),
    'mapLayerStore loadPersisted',
  );
  return {
    basemapId:
      settings?.mapBasemapId != null && isValidMapBasemapId(settings.mapBasemapId)
        ? settings.mapBasemapId
        : DEFAULT_MAP_BASEMAP_ID,
    showNodes: settings?.mapShowNodes !== false,
    showWaypoints: settings?.mapShowWaypoints !== false,
  };
}

interface MapLayerState {
  basemapId: MapBasemapId;
  showNodes: boolean;
  showWaypoints: boolean;
  layersPanelOpen: boolean;
  setBasemapId: (id: MapBasemapId) => void;
  setShowNodes: (enabled: boolean) => void;
  setShowWaypoints: (enabled: boolean) => void;
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
