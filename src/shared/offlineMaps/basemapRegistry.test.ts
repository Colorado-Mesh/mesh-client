// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  BASEMAP_ATTRIBUTIONS,
  buildMeshTilesUrl,
  buildRemoteTileUrl,
  isOfflineMapBasemapId,
  MESH_TILES_URL_TEMPLATES,
  meshTilesUserAgent,
  OFFLINE_MAP_BASEMAP_IDS,
  OPENTOPO_MAX_NATIVE_ZOOM,
  supportsOfflineMapDownload,
  tileSubdomain,
} from './basemapRegistry';

describe('basemapRegistry', () => {
  it('accepts only allowlisted basemap ids', () => {
    expect(isOfflineMapBasemapId('osm')).toBe(true);
    expect(isOfflineMapBasemapId('dark')).toBe(true);
    expect(isOfflineMapBasemapId('usgs-topo')).toBe(true);
    expect(isOfflineMapBasemapId('opentopo')).toBe(true);
    expect(isOfflineMapBasemapId('hot')).toBe(true);
    expect(isOfflineMapBasemapId('cyclosm')).toBe(true);
    expect(isOfflineMapBasemapId('oepnv')).toBe(true);
    expect(isOfflineMapBasemapId('esri')).toBe(false);
    expect(isOfflineMapBasemapId('usgs')).toBe(false);
    expect(isOfflineMapBasemapId('USGS-TOPO')).toBe(false);
    expect(isOfflineMapBasemapId('')).toBe(false);
    expect(isOfflineMapBasemapId(null)).toBe(false);
    expect(isOfflineMapBasemapId(42)).toBe(false);
  });

  it('lists every allowlisted id with a template and attribution', () => {
    expect([...OFFLINE_MAP_BASEMAP_IDS].sort()).toEqual([
      'cyclosm',
      'dark',
      'hot',
      'oepnv',
      'opentopo',
      'osm',
      'usgs-topo',
    ]);
    for (const id of OFFLINE_MAP_BASEMAP_IDS) {
      expect(isOfflineMapBasemapId(id)).toBe(true);
      expect(MESH_TILES_URL_TEMPLATES[id]).toMatch(/^mesh-tiles:\/\//);
      expect(BASEMAP_ATTRIBUTIONS[id].length).toBeGreaterThan(0);
    }
  });

  it('uses the canonical key-free OSM source for both styles without retina or subdomains', () => {
    for (const id of ['osm', 'dark'] as const) {
      expect(buildRemoteTileUrl(id, 14, 1, 2)).toBe('https://tile.openstreetmap.org/14/1/2.png');
    }
  });

  it('limits prefetching to providers that permit region downloads', () => {
    expect(supportsOfflineMapDownload('osm')).toBe(false);
    expect(supportsOfflineMapDownload('dark')).toBe(false);
    expect(supportsOfflineMapDownload('opentopo')).toBe(false);
    expect(supportsOfflineMapDownload('hot')).toBe(false);
    expect(supportsOfflineMapDownload('cyclosm')).toBe(false);
    expect(supportsOfflineMapDownload('oepnv')).toBe(false);
    expect(supportsOfflineMapDownload('usgs-topo')).toBe(true);
  });

  it('builds USGS topo URLs in ArcGIS z/y/x order', () => {
    expect(buildRemoteTileUrl('usgs-topo', 14, 1, 2)).toBe(
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/14/2/1',
    );
  });

  it('rotates a/b/c subdomains from tile coordinates', () => {
    expect(tileSubdomain(0, 0)).toBe('a');
    expect(tileSubdomain(1, 0)).toBe('b');
    expect(tileSubdomain(2, 0)).toBe('c');
    expect(tileSubdomain(1, 2)).toBe('a');
  });

  it('builds OpenTopoMap URLs with subdomain rotation and attribution', () => {
    expect(buildRemoteTileUrl('opentopo', 14, 1, 2)).toBe(
      'https://a.tile.opentopomap.org/14/1/2.png',
    );
    expect(buildRemoteTileUrl('opentopo', 14, 1, 0)).toBe(
      'https://b.tile.opentopomap.org/14/1/0.png',
    );
    expect(BASEMAP_ATTRIBUTIONS.opentopo).toContain('OpenTopoMap');
    expect(BASEMAP_ATTRIBUTIONS.opentopo).toContain('CC-BY-SA');
    expect(OPENTOPO_MAX_NATIVE_ZOOM).toBe(17);
  });

  it('builds HOT and CyclOSM URLs on OSM France hosts', () => {
    expect(buildRemoteTileUrl('hot', 14, 1, 2)).toBe(
      'https://a.tile.openstreetmap.fr/hot/14/1/2.png',
    );
    expect(buildRemoteTileUrl('cyclosm', 14, 1, 2)).toBe(
      'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/14/1/2.png',
    );
    expect(BASEMAP_ATTRIBUTIONS.hot).toContain('Humanitarian OpenStreetMap Team');
    expect(BASEMAP_ATTRIBUTIONS.cyclosm).toContain('CyclOSM');
  });

  it('builds ÖPNVKarte URLs on the MeMO Maps host without subdomains', () => {
    expect(buildRemoteTileUrl('oepnv', 14, 1, 2)).toBe(
      'https://tile.memomaps.de/tilegen/14/1/2.png',
    );
    expect(BASEMAP_ATTRIBUTIONS.oepnv).toContain('ÖPNVKarte');
  });

  it('exposes mesh-tiles leaflet templates and concrete URLs', () => {
    expect(MESH_TILES_URL_TEMPLATES.osm).toBe('mesh-tiles://osm/{z}/{x}/{y}.png');
    expect(MESH_TILES_URL_TEMPLATES.dark).toBe('mesh-tiles://dark/{z}/{x}/{y}.png?source=osm-v1');
    expect(MESH_TILES_URL_TEMPLATES['usgs-topo']).toBe('mesh-tiles://usgs-topo/{z}/{x}/{y}.png');
    expect(MESH_TILES_URL_TEMPLATES.opentopo).toBe('mesh-tiles://opentopo/{z}/{x}/{y}.png');
    expect(MESH_TILES_URL_TEMPLATES.hot).toBe('mesh-tiles://hot/{z}/{x}/{y}.png');
    expect(MESH_TILES_URL_TEMPLATES.cyclosm).toBe('mesh-tiles://cyclosm/{z}/{x}/{y}.png');
    expect(MESH_TILES_URL_TEMPLATES.oepnv).toBe('mesh-tiles://oepnv/{z}/{x}/{y}.png');
    expect(buildMeshTilesUrl('osm', 14, 1, 2)).toBe('mesh-tiles://osm/14/1/2.png');
    expect(buildMeshTilesUrl('dark', 14, 1, 2)).toBe('mesh-tiles://dark/14/1/2.png?source=osm-v1');
    expect(buildMeshTilesUrl('usgs-topo', 14, 1, 2)).toBe('mesh-tiles://usgs-topo/14/1/2.png');
    expect(buildMeshTilesUrl('opentopo', 14, 1, 2)).toBe('mesh-tiles://opentopo/14/1/2.png');
    expect(buildMeshTilesUrl('hot', 14, 1, 2)).toBe('mesh-tiles://hot/14/1/2.png');
    expect(buildMeshTilesUrl('cyclosm', 14, 1, 2)).toBe('mesh-tiles://cyclosm/14/1/2.png');
    expect(buildMeshTilesUrl('oepnv', 14, 1, 2)).toBe('mesh-tiles://oepnv/14/1/2.png');
  });

  it('attributes USGS for the topo basemap', () => {
    expect(BASEMAP_ATTRIBUTIONS['usgs-topo']).toContain('U.S. Geological Survey');
  });

  it('builds an identifying user agent', () => {
    expect(meshTilesUserAgent('5.38.0')).toContain('mesh-client/5.38.0');
    expect(meshTilesUserAgent('5.38.0')).toContain('Colorado-Mesh/mesh-client');
  });
});
