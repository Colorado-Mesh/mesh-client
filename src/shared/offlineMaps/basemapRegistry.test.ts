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
} from './basemapRegistry';

describe('basemapRegistry', () => {
  it('accepts only allowlisted basemap ids', () => {
    expect(isOfflineMapBasemapId('osm')).toBe(true);
    expect(isOfflineMapBasemapId('dark')).toBe(true);
    expect(isOfflineMapBasemapId('usgs-topo')).toBe(true);
    expect(isOfflineMapBasemapId('esri')).toBe(false);
    expect(isOfflineMapBasemapId('usgs')).toBe(false);
    expect(isOfflineMapBasemapId('USGS-TOPO')).toBe(false);
    expect(isOfflineMapBasemapId('')).toBe(false);
    expect(isOfflineMapBasemapId(null)).toBe(false);
    expect(isOfflineMapBasemapId(42)).toBe(false);
  });

  it('lists every allowlisted id with a template and attribution', () => {
    expect([...OFFLINE_MAP_BASEMAP_IDS].sort()).toEqual(['dark', 'osm', 'usgs-topo']);
    for (const id of OFFLINE_MAP_BASEMAP_IDS) {
      expect(isOfflineMapBasemapId(id)).toBe(true);
      expect(MESH_TILES_URL_TEMPLATES[id]).toMatch(/^mesh-tiles:\/\//);
      expect(BASEMAP_ATTRIBUTIONS[id].length).toBeGreaterThan(0);
    }
  });

  it('builds allowlisted remote URLs without caller host', () => {
    expect(buildRemoteTileUrl('osm', 14, 1, 2)).toMatch(
      /^https:\/\/[abc]\.tile\.openstreetmap\.org\/14\/1\/2\.png$/,
    );
    expect(buildRemoteTileUrl('dark', 14, 1, 2, { retina: true })).toMatch(
      /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/dark_all\/14\/1\/2@2x\.png$/,
    );
  });

  it('builds USGS topo URLs in ArcGIS z/y/x order and ignores retina', () => {
    expect(buildRemoteTileUrl('usgs-topo', 14, 1, 2)).toBe(
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/14/2/1',
    );
    expect(buildRemoteTileUrl('usgs-topo', 14, 1, 2, { retina: true, subdomainIndex: 3 })).toBe(
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/14/2/1',
    );
  });

  it('exposes mesh-tiles leaflet templates and concrete URLs', () => {
    expect(MESH_TILES_URL_TEMPLATES.osm).toBe('mesh-tiles://osm/{z}/{x}/{y}.png');
    expect(MESH_TILES_URL_TEMPLATES.dark).toBe('mesh-tiles://dark/{z}/{x}/{y}{r}.png');
    expect(MESH_TILES_URL_TEMPLATES['usgs-topo']).toBe('mesh-tiles://usgs-topo/{z}/{x}/{y}.png');
    expect(buildMeshTilesUrl('osm', 14, 1, 2)).toBe('mesh-tiles://osm/14/1/2.png');
    expect(buildMeshTilesUrl('dark', 14, 1, 2, true)).toBe('mesh-tiles://dark/14/1/2@2x.png');
    expect(buildMeshTilesUrl('usgs-topo', 14, 1, 2, true)).toBe(
      'mesh-tiles://usgs-topo/14/1/2.png',
    );
  });

  it('attributes USGS for the topo basemap', () => {
    expect(BASEMAP_ATTRIBUTIONS['usgs-topo']).toContain('U.S. Geological Survey');
  });

  it('builds an identifying user agent', () => {
    expect(meshTilesUserAgent('5.38.0')).toContain('mesh-client/5.38.0');
    expect(meshTilesUserAgent('5.38.0')).toContain('Colorado-Mesh/mesh-client');
  });
});
