export type OfflineMapBasemapId = 'osm' | 'dark';

export const OFFLINE_MAP_BASEMAP_IDS: readonly OfflineMapBasemapId[] = ['osm', 'dark'] as const;

export function isOfflineMapBasemapId(value: unknown): value is OfflineMapBasemapId {
  return value === 'osm' || value === 'dark';
}

/** Leaflet / static preview URL templates served by the main-process `mesh-tiles:` handler. */
export const MESH_TILES_URL_TEMPLATES: Record<OfflineMapBasemapId, string> = {
  osm: 'mesh-tiles://osm/{z}/{x}/{y}.png',
  dark: 'mesh-tiles://dark/{z}/{x}/{y}{r}.png',
};

const OSM_SUBDOMAINS = ['a', 'b', 'c'] as const;
const CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'] as const;

/** Identifying User-Agent for OSM/CARTO tile policy compliance. */
export function meshTilesUserAgent(appVersion: string): string {
  return `mesh-client/${appVersion} (+https://github.com/Colorado-Mesh/mesh-client)`;
}

/** Referer expected by OSM tile servers for packaged Electron loads. */
export const OSM_TILE_HTTP_REFERRER = 'https://meshtastic-client.app/';

/**
 * Resolve an allowlisted remote tile URL. Never accepts a caller-supplied host.
 * `retina` maps to CARTO `{r}` (`@2x` or empty).
 */
export function buildRemoteTileUrl(
  basemapId: OfflineMapBasemapId,
  z: number,
  x: number,
  y: number,
  opts?: { retina?: boolean; subdomainIndex?: number },
): string {
  const retina = opts?.retina === true;
  const idx = opts?.subdomainIndex ?? 0;
  if (basemapId === 'osm') {
    const s = OSM_SUBDOMAINS[Math.abs(idx) % OSM_SUBDOMAINS.length];
    return `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
  }
  const s = CARTO_SUBDOMAINS[Math.abs(idx) % CARTO_SUBDOMAINS.length];
  const r = retina ? '@2x' : '';
  return `https://${s}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}${r}.png`;
}

export function buildMeshTilesUrl(
  basemapId: OfflineMapBasemapId,
  z: number,
  x: number,
  y: number,
  retina = false,
): string {
  if (basemapId === 'dark' && retina) {
    return `mesh-tiles://dark/${z}/${x}/${y}@2x.png`;
  }
  return `mesh-tiles://${basemapId}/${z}/${x}/${y}.png`;
}
