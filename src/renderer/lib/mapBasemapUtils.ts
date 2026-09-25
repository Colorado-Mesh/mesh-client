import {
  BASEMAP_ATTRIBUTIONS,
  MESH_TILES_URL_TEMPLATES,
  type OfflineMapBasemapId,
  USGS_TOPO_MAX_NATIVE_ZOOM,
} from '@/shared/offlineMaps/basemapRegistry';

export type MapBasemapId = OfflineMapBasemapId;

export interface MapBasemapConfig {
  id: MapBasemapId;
  url: string;
  attribution: string;
  isDark: boolean;
  /** Highest zoom the tile source serves; Leaflet overzooms above it. */
  maxNativeZoom?: number;
}

export const MAP_BASEMAPS: Record<MapBasemapId, MapBasemapConfig> = {
  dark: {
    id: 'dark',
    url: MESH_TILES_URL_TEMPLATES.dark,
    attribution: BASEMAP_ATTRIBUTIONS.dark,
    isDark: true,
  },
  osm: {
    id: 'osm',
    url: MESH_TILES_URL_TEMPLATES.osm,
    attribution: BASEMAP_ATTRIBUTIONS.osm,
    isDark: false,
  },
  'usgs-topo': {
    id: 'usgs-topo',
    url: MESH_TILES_URL_TEMPLATES['usgs-topo'],
    attribution: BASEMAP_ATTRIBUTIONS['usgs-topo'],
    isDark: false,
    maxNativeZoom: USGS_TOPO_MAX_NATIVE_ZOOM,
  },
};

export const DEFAULT_MAP_BASEMAP_ID: MapBasemapId = 'osm';

export function isValidMapBasemapId(value: unknown): value is MapBasemapId {
  return value === 'dark' || value === 'osm' || value === 'usgs-topo';
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
