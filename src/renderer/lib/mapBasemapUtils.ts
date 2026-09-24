import { MESH_TILES_URL_TEMPLATES } from '@/shared/offlineMaps/basemapRegistry';

export type MapBasemapId = 'dark' | 'osm';

export interface MapBasemapConfig {
  id: MapBasemapId;
  url: string;
  attribution: string;
  isDark: boolean;
}

export const MAP_BASEMAPS: Record<MapBasemapId, MapBasemapConfig> = {
  dark: {
    id: 'dark',
    url: MESH_TILES_URL_TEMPLATES.dark,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    isDark: true,
  },
  osm: {
    id: 'osm',
    url: MESH_TILES_URL_TEMPLATES.osm,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    isDark: false,
  },
};

export const DEFAULT_MAP_BASEMAP_ID: MapBasemapId = 'osm';

export function isValidMapBasemapId(value: unknown): value is MapBasemapId {
  return value === 'dark' || value === 'osm';
}

export interface MapOverlayColors {
  online: string;
  stale: string;
  offline: string;
}

export function getMapOverlayColors(isDarkBasemap: boolean): MapOverlayColors {
  return isDarkBasemap
    ? { online: '#86efac', stale: '#a78bfa', offline: '#64748b' }
    : { online: '#15803d', stale: '#5b21b6', offline: '#334155' };
}
