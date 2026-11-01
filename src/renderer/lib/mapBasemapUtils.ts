import {
  BASEMAP_ATTRIBUTIONS,
  MESH_TILES_URL_TEMPLATES,
  type OfflineMapBasemapId,
  USGS_TOPO_MAX_NATIVE_ZOOM,
} from '@/shared/offlineMaps/basemapRegistry';
import {
  customAttributionToHtml,
  type CustomMapSourceId,
  type CustomMapSourceInfo,
  isCustomMapSourceId,
} from '@/shared/offlineMaps/customMapSources';

import { isDevElectronApiStub } from './devElectronApiStub';

export type MapBasemapId = OfflineMapBasemapId | CustomMapSourceId;

export interface MapBasemapConfig {
  id: MapBasemapId;
  url: string;
  attribution: string;
  isDark: boolean;
  /** Applied to tile images only, preserving normal marker, packet, and control colors. */
  tileClassName?: string;
  /** Highest zoom the tile source serves; Leaflet overzooms above it. */
  maxNativeZoom?: number;
}

export const MAP_BASEMAPS: Record<OfflineMapBasemapId, MapBasemapConfig> = {
  dark: {
    id: 'dark',
    url: MESH_TILES_URL_TEMPLATES.dark,
    attribution: BASEMAP_ATTRIBUTIONS.dark,
    isDark: true,
    tileClassName: 'mesh-basemap-dark',
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

export const DEFAULT_MAP_BASEMAP_ID: OfflineMapBasemapId = 'osm';

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
  return value === 'dark' || value === 'osm' || value === 'usgs-topo' || isCustomMapSourceId(value);
}

/** Leaflet config for a user-confirmed custom source (attribution escaped: plain text → HTML). */
export function buildCustomBasemapConfig(info: CustomMapSourceInfo): MapBasemapConfig {
  return {
    id: info.id,
    url: `mesh-tiles://${info.id}/{z}/{x}/{y}.png`,
    attribution: customAttributionToHtml(info.attribution),
    isDark: false,
    ...(info.maxNativeZoom != null ? { maxNativeZoom: info.maxNativeZoom } : {}),
  };
}

/**
 * Resolve any basemap id. Unknown custom ids (removed source) fall back to the default; while the
 * custom list is still loading (`customSources === null`) the id is served without attribution text.
 */
export function resolveMapBasemap(
  id: MapBasemapId,
  customSources: readonly CustomMapSourceInfo[] | null,
): MapBasemapConfig {
  if (!isCustomMapSourceId(id)) return MAP_BASEMAPS[id];
  if (customSources === null) {
    return { id, url: `mesh-tiles://${id}/{z}/{x}/{y}.png`, attribution: '', isDark: false };
  }
  const info = customSources.find((s) => s.id === id);
  return info ? buildCustomBasemapConfig(info) : MAP_BASEMAPS[DEFAULT_MAP_BASEMAP_ID];
}

export interface MapOverlayColors {
  online: string;
  stale: string;
  offline: string;
}

export function getMapOverlayColors(isDarkBasemap: boolean): MapOverlayColors {
  return isDarkBasemap
    ? { online: '#4ade80', stale: '#a78bfa', offline: '#65738c' }
    : { online: '#15803d', stale: '#5b21b6', offline: '#364156' };
}
