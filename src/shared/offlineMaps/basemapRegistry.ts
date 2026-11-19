import { type CustomMapSourceId, isCustomMapSourceId } from './customMapSources';

export type OfflineMapBasemapId =
  'osm' | 'dark' | 'usgs-topo' | 'opentopo' | 'hot' | 'cyclosm' | 'oepnv';

/** Any id the `mesh-tiles:` protocol and tile cache accept: built-in basemaps or custom sources. */
export type MapSourceId = OfflineMapBasemapId | CustomMapSourceId;

export function isMapSourceId(value: unknown): value is MapSourceId {
  return isOfflineMapBasemapId(value) || isCustomMapSourceId(value);
}

export const OFFLINE_MAP_BASEMAP_IDS: readonly OfflineMapBasemapId[] = [
  'osm',
  'dark',
  'usgs-topo',
  'opentopo',
  'hot',
  'cyclosm',
  'oepnv',
] as const;

export function isOfflineMapBasemapId(value: unknown): value is OfflineMapBasemapId {
  return (
    value === 'osm' ||
    value === 'dark' ||
    value === 'usgs-topo' ||
    value === 'opentopo' ||
    value === 'hot' ||
    value === 'cyclosm' ||
    value === 'oepnv'
  );
}

/**
 * OSM permits normal viewport caching, but prohibits region downloads and prefetching. Custom XYZ
 * sources are view-cache only (their providers' terms are unknown); use MBTiles for offline packages.
 * Community OSM styles (OpenTopoMap, HOT, CyclOSM, ÖPNVKarte) likewise discourage mass download.
 */
export function supportsOfflineMapDownload(basemapId: MapSourceId): boolean {
  return basemapId === 'usgs-topo';
}

/** Isolates OSM tiles from previously cached CARTO tiles, including API-key error images. */
export const DARK_BASEMAP_CACHE_REVISION = 'osm-v1';

/**
 * Leaflet / static preview URL templates served by the main-process `mesh-tiles:` handler.
 * Always `{z}/{x}/{y}` on the `mesh-tiles:` side; remote axis order is resolved in
 * {@link buildRemoteTileUrl}.
 */
export const MESH_TILES_URL_TEMPLATES: Record<OfflineMapBasemapId, string> = {
  osm: 'mesh-tiles://osm/{z}/{x}/{y}.png',
  dark: `mesh-tiles://dark/{z}/{x}/{y}.png?source=${DARK_BASEMAP_CACHE_REVISION}`,
  'usgs-topo': 'mesh-tiles://usgs-topo/{z}/{x}/{y}.png',
  opentopo: 'mesh-tiles://opentopo/{z}/{x}/{y}.png',
  hot: 'mesh-tiles://hot/{z}/{x}/{y}.png',
  cyclosm: 'mesh-tiles://cyclosm/{z}/{x}/{y}.png',
  oepnv: 'mesh-tiles://oepnv/{z}/{x}/{y}.png',
};

const OSM_ATTRIB =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** HTML attribution strings for Leaflet `TileLayer`. */
export const BASEMAP_ATTRIBUTIONS: Record<OfflineMapBasemapId, string> = {
  osm: OSM_ATTRIB,
  dark: OSM_ATTRIB,
  'usgs-topo':
    'Tiles courtesy of the <a href="https://www.usgs.gov/">U.S. Geological Survey</a> (The National Map)',
  opentopo:
    `Map data: ${OSM_ATTRIB}, <a href="http://viewfinderpanoramas.org">SRTM</a>` +
    ' | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>' +
    ' (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
  hot:
    OSM_ATTRIB +
    ' | Tiles style by <a href="https://www.hotosm.org/">Humanitarian OpenStreetMap Team</a>' +
    ' hosted by <a href="https://openstreetmap.fr/">OSM France</a>',
  cyclosm: OSM_ATTRIB + ' | Style: <a href="https://www.cyclosm.org/">CyclOSM</a>',
  oepnv: OSM_ATTRIB + ' | &copy; <a href="https://memomaps.de/">ÖPNVKarte / MeMO Maps</a>',
};

/** USGS National Map cached tiles stop at this zoom; Leaflet should overzoom beyond it. */
export const USGS_TOPO_MAX_NATIVE_ZOOM = 16;

/** OpenTopoMap raster tiles stop around this zoom; Leaflet should overzoom beyond it. */
export const OPENTOPO_MAX_NATIVE_ZOOM = 17;

const USGS_TOPO_TILE_BASE =
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile';

const TILE_SUBDOMAINS = ['a', 'b', 'c'] as const;

/** Rotate a/b/c subdomains for providers that publish `{s}.…` templates. */
export function tileSubdomain(x: number, y: number): (typeof TILE_SUBDOMAINS)[number] {
  return TILE_SUBDOMAINS[Math.abs(x + y) % TILE_SUBDOMAINS.length] ?? 'a';
}

/** Identifying User-Agent for tile policy compliance. */
export function meshTilesUserAgent(appVersion: string): string {
  return `mesh-client/${appVersion} (+https://github.com/Colorado-Mesh/mesh-client)`;
}

/** Referer expected by OSM tile servers for packaged Electron loads. */
export const OSM_TILE_HTTP_REFERRER = 'https://meshtastic-client.app/';

/**
 * Resolve an allowlisted remote tile URL. Never accepts a caller-supplied host.
 * Both OSM variants use the same standard raster tiles; dark styling is local to the renderer.
 */
export function buildRemoteTileUrl(
  basemapId: OfflineMapBasemapId,
  z: number,
  x: number,
  y: number,
): string {
  if (basemapId === 'usgs-topo') {
    // ArcGIS MapServer tile order is z/row(y)/col(x); no retina variant.
    return `${USGS_TOPO_TILE_BASE}/${z}/${y}/${x}`;
  }
  if (basemapId === 'opentopo') {
    return `https://${tileSubdomain(x, y)}.tile.opentopomap.org/${z}/${x}/${y}.png`;
  }
  if (basemapId === 'hot') {
    return `https://${tileSubdomain(x, y)}.tile.openstreetmap.fr/hot/${z}/${x}/${y}.png`;
  }
  if (basemapId === 'cyclosm') {
    return `https://${tileSubdomain(x, y)}.tile-cyclosm.openstreetmap.fr/cyclosm/${z}/${x}/${y}.png`;
  }
  if (basemapId === 'oepnv') {
    return `https://tile.memomaps.de/tilegen/${z}/${x}/${y}.png`;
  }
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

export function buildMeshTilesUrl(
  basemapId: OfflineMapBasemapId,
  z: number,
  x: number,
  y: number,
): string {
  if (basemapId === 'dark') {
    return `mesh-tiles://dark/${z}/${x}/${y}.png?source=${DARK_BASEMAP_CACHE_REVISION}`;
  }
  // `.png` is the cache/protocol file suffix only; USGS serves JPEG and Chromium sniffs image bytes.
  return `mesh-tiles://${basemapId}/${z}/${x}/${y}.png`;
}
