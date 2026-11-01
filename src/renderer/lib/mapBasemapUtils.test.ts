import { describe, expect, it } from 'vitest';

import type { CustomMapSourceInfo } from '@/shared/offlineMaps/customMapSources';

import {
  DEFAULT_MAP_BASEMAP_ID,
  getMapOverlayColors,
  isValidMapBasemapId,
  MAP_BASEMAPS,
  resolveMapBasemap,
} from './mapBasemapUtils';

describe('mapBasemapUtils', () => {
  it('uses darker greens on light basemap for contrast', () => {
    expect(getMapOverlayColors(false).online).toBe('#15803d');
    expect(getMapOverlayColors(true).online).toBe('#4ade80');
  });

  it('defines dark and osm basemaps', () => {
    expect(MAP_BASEMAPS.dark.isDark).toBe(true);
    expect(MAP_BASEMAPS.osm.isDark).toBe(false);
    expect(MAP_BASEMAPS.dark.tileClassName).toBe('mesh-basemap-dark');
    expect(MAP_BASEMAPS.osm.tileClassName).toBeUndefined();
    expect(MAP_BASEMAPS.dark.attribution).not.toContain('CARTO');
  });

  it('uses mesh-tiles URL templates for offline cache', () => {
    expect(MAP_BASEMAPS.osm.url).toBe('mesh-tiles://osm/{z}/{x}/{y}.png');
    expect(MAP_BASEMAPS.dark.url).toBe('mesh-tiles://dark/{z}/{x}/{y}.png?source=osm-v1');
    expect(MAP_BASEMAPS['usgs-topo'].url).toBe('mesh-tiles://usgs-topo/{z}/{x}/{y}.png');
  });

  it('defines light USGS topo basemap with attribution and native zoom cap', () => {
    const usgs = MAP_BASEMAPS['usgs-topo'];
    expect(usgs.isDark).toBe(false);
    expect(usgs.attribution).toContain('U.S. Geological Survey');
    expect(usgs.maxNativeZoom).toBe(16);
  });

  it('validates persisted basemap ids', () => {
    expect(isValidMapBasemapId('usgs-topo')).toBe(true);
    expect(isValidMapBasemapId('osm')).toBe(true);
    expect(isValidMapBasemapId('esri')).toBe(false);
    expect(isValidMapBasemapId(undefined)).toBe(false);
  });

  it('defaults to light osm basemap', async () => {
    const { DEFAULT_MAP_BASEMAP_ID } = await import('./mapBasemapUtils');
    expect(DEFAULT_MAP_BASEMAP_ID).toBe('osm');
  });
});

const custom: CustomMapSourceInfo = {
  id: 'xyz-0123456789ab',
  kind: 'xyz',
  name: 'Mine',
  attribution: '© <b>Me</b> & co',
  addedAt: 1,
  host: 'tiles.example.org',
  maxNativeZoom: 17,
};

describe('custom basemaps', () => {
  it('accepts built-in ids and generated custom ids only', () => {
    expect(isValidMapBasemapId('osm')).toBe(true);
    expect(isValidMapBasemapId('xyz-0123456789ab')).toBe(true);
    expect(isValidMapBasemapId('mbtiles-0123456789ab')).toBe(true);
    expect(isValidMapBasemapId('xyz-../etc')).toBe(false);
    expect(isValidMapBasemapId('esri')).toBe(false);
  });

  it('resolves a custom source to a mesh-tiles URL with escaped attribution', () => {
    const cfg = resolveMapBasemap(custom.id, [custom]);
    expect(cfg.url).toBe('mesh-tiles://xyz-0123456789ab/{z}/{x}/{y}.png');
    expect(cfg.attribution).toBe('© &lt;b&gt;Me&lt;/b&gt; &amp; co');
    expect(cfg.maxNativeZoom).toBe(17);
  });

  it('falls back to the default for removed sources and keeps built-ins stable', () => {
    expect(resolveMapBasemap(custom.id, [])).toBe(MAP_BASEMAPS[DEFAULT_MAP_BASEMAP_ID]);
    expect(resolveMapBasemap('usgs-topo', null)).toBe(MAP_BASEMAPS['usgs-topo']);
  });

  it('serves the custom URL (without attribution) while the list is still loading', () => {
    const cfg = resolveMapBasemap(custom.id, null);
    expect(cfg.url).toContain(custom.id);
    expect(cfg.attribution).toBe('');
  });
});
