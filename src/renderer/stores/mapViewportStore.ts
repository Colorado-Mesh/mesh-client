import { create } from 'zustand';

import { getAppSettingsRaw, mergeAppSetting } from '../lib/appSettingsStorage';
import { parseStoredJson } from '../lib/parseStoredJson';

export interface MapViewport {
  center: [number, number];
  zoom: number;
}

interface MapViewportState {
  viewport: MapViewport | null;
  setViewport: (viewport: MapViewport) => void;
}

function isValidViewport(value: unknown): value is MapViewport {
  if (typeof value !== 'object' || value === null) return false;
  const maybe = value as { center?: unknown; zoom?: unknown };
  if (!Array.isArray(maybe.center) || maybe.center.length !== 2) return false;
  if (typeof maybe.zoom !== 'number' || !Number.isFinite(maybe.zoom)) return false;
  const [lat, lon] = maybe.center;
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    typeof lon === 'number' &&
    Number.isFinite(lon)
  );
}

function loadViewport(): MapViewport | null {
  const settings = parseStoredJson<{ mapViewport?: unknown }>(
    getAppSettingsRaw(),
    'mapViewportStore loadViewport',
  );
  if (!settings || !isValidViewport(settings.mapViewport)) return null;
  return settings.mapViewport;
}

export const useMapViewportStore = create<MapViewportState>((set) => ({
  viewport: loadViewport(),
  setViewport: (viewport) => {
    mergeAppSetting('mapViewport', viewport, 'mapViewportStore setViewport');
    set({ viewport });
  },
}));
