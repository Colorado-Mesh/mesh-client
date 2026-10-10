import {
  BASEMAP_ATTRIBUTIONS,
  MESH_TILES_URL_TEMPLATES,
  type OfflineMapBasemapId,
  USGS_TOPO_MAX_NATIVE_ZOOM,
} from '@/shared/offlineMaps/basemapRegistry';

import { isDevElectronApiStub } from './devElectronApiStub';

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

/**
 * Highest zoom for every map, set on the map itself. It equals Leaflet's TileLayer default (18),
 * which the map used to inherit from its tile layer; with no tile layer the map would report
 * Infinity and marker clustering throws "Map has no maxZoom specified".
 */
export const MAP_MAX_ZOOM = 18;

/**
 * Whether `mesh-tiles:` tiles can load. The main process serves that scheme, so on the plain-browser
 * dev bridge every tile would fail; maps then draw without a basemap instead of broken images.
 */
export function meshTilesAvailable(): boolean {
  return !isDevElectronApiStub();
}

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
    ? { online: '#4ade80', stale: '#a78bfa', offline: '#65738c' }
    : { online: '#15803d', stale: '#5b21b6', offline: '#424242' };
}
