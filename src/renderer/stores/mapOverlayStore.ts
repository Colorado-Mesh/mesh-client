import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { removeRendererStorageItem, setRendererStorageItem } from '@/renderer/lib/rendererStorage';
import {
  clampOverlayOpacity,
  MAP_OVERLAY_MAX_LAYERS,
  type MapOverlayFeatureCollection,
  sanitizeOverlayName,
} from '@/shared/mapOverlays/types';

export interface MapOverlayLayer {
  id: string;
  name: string;
  visible: boolean;
  /** 0–1 fill/stroke opacity for Leaflet GeoJSON styling. */
  opacity: number;
  geojson: MapOverlayFeatureCollection;
}

interface MapOverlayState {
  layers: MapOverlayLayer[];
  lastImportError: string | null;
  addLayer: (layer: {
    name: string;
    geojson: MapOverlayFeatureCollection;
    id?: string;
    visible?: boolean;
    opacity?: number;
  }) => { ok: true; id: string } | { ok: false; code: 'limit' };
  setVisible: (id: string, visible: boolean) => void;
  setOpacity: (id: string, opacity: number) => void;
  removeLayer: (id: string) => void;
  setImportError: (message: string | null) => void;
  clearImportError: () => void;
}

function newLayerId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `overlay-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const useMapOverlayStore = create<MapOverlayState>()(
  persist(
    (set, get) => ({
      layers: [],
      lastImportError: null,
      addLayer: (layer) => {
        if (get().layers.length >= MAP_OVERLAY_MAX_LAYERS) return { ok: false, code: 'limit' };
        const id = layer.id ?? newLayerId();
        const next: MapOverlayLayer = {
          id,
          name: sanitizeOverlayName(layer.name),
          visible: layer.visible ?? true,
          opacity: clampOverlayOpacity(layer.opacity ?? 0.75),
          geojson: layer.geojson,
        };
        set((state) => ({ layers: [...state.layers, next], lastImportError: null }));
        return { ok: true, id };
      },
      setVisible: (id, visible) => {
        set((state) => ({
          layers: state.layers.map((layer) => (layer.id === id ? { ...layer, visible } : layer)),
        }));
      },
      setOpacity: (id, opacity) => {
        const next = clampOverlayOpacity(opacity);
        set((state) => ({
          layers: state.layers.map((layer) =>
            layer.id === id ? { ...layer, opacity: next } : layer,
          ),
        }));
      },
      removeLayer: (id) => {
        set((state) => ({ layers: state.layers.filter((layer) => layer.id !== id) }));
      },
      setImportError: (message) => {
        set({ lastImportError: message });
      },
      clearImportError: () => {
        set({ lastImportError: null });
      },
    }),
    {
      name: 'mesh-client:mapOverlays',
      partialize: (state) => ({ layers: state.layers }),
      storage: {
        getItem: (key) => {
          const raw = localStorage.getItem(key);
          if (!raw) return null;
          try {
            return JSON.parse(raw) as { state: { layers: MapOverlayLayer[] } };
          } catch {
            // catch-no-log-ok invalid persisted overlay JSON
            return null;
          }
        },
        setItem: (key, value) => {
          setRendererStorageItem(key, JSON.stringify(value));
        },
        removeItem: (key) => {
          removeRendererStorageItem(key);
        },
      },
    },
  ),
);
