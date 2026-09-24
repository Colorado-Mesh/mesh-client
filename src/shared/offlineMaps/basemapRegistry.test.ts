// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildMeshTilesUrl,
  buildRemoteTileUrl,
  isOfflineMapBasemapId,
  MESH_TILES_URL_TEMPLATES,
  meshTilesUserAgent,
} from './basemapRegistry';

describe('basemapRegistry', () => {
  it('accepts only osm and dark', () => {
    expect(isOfflineMapBasemapId('osm')).toBe(true);
    expect(isOfflineMapBasemapId('dark')).toBe(true);
    expect(isOfflineMapBasemapId('esri')).toBe(false);
  });

  it('builds allowlisted remote URLs without caller host', () => {
    expect(buildRemoteTileUrl('osm', 14, 1, 2)).toMatch(
      /^https:\/\/[abc]\.tile\.openstreetmap\.org\/14\/1\/2\.png$/,
    );
    expect(buildRemoteTileUrl('dark', 14, 1, 2, { retina: true })).toMatch(
      /^https:\/\/[abcd]\.basemaps\.cartocdn\.com\/dark_all\/14\/1\/2@2x\.png$/,
    );
  });

  it('exposes mesh-tiles leaflet templates and concrete URLs', () => {
    expect(MESH_TILES_URL_TEMPLATES.osm).toBe('mesh-tiles://osm/{z}/{x}/{y}.png');
    expect(MESH_TILES_URL_TEMPLATES.dark).toBe('mesh-tiles://dark/{z}/{x}/{y}{r}.png');
    expect(buildMeshTilesUrl('osm', 14, 1, 2)).toBe('mesh-tiles://osm/14/1/2.png');
    expect(buildMeshTilesUrl('dark', 14, 1, 2, true)).toBe('mesh-tiles://dark/14/1/2@2x.png');
  });

  it('builds an identifying user agent', () => {
    expect(meshTilesUserAgent('5.38.0')).toContain('mesh-client/5.38.0');
    expect(meshTilesUserAgent('5.38.0')).toContain('Colorado-Mesh/mesh-client');
  });
});
