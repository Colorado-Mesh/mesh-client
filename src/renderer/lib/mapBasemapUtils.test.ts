import { describe, expect, it } from 'vitest';

import { getMapOverlayColors, isValidMapBasemapId, MAP_BASEMAPS } from './mapBasemapUtils';

describe('mapBasemapUtils', () => {
  it('uses darker greens on light basemap for contrast', () => {
    expect(getMapOverlayColors(false).online).toBe('#15803d');
    expect(getMapOverlayColors(true).online).toBe('#86efac');
  });

  it('defines dark and osm basemaps', () => {
    expect(MAP_BASEMAPS.dark.isDark).toBe(true);
    expect(MAP_BASEMAPS.osm.isDark).toBe(false);
  });

  it('uses mesh-tiles URL templates for offline cache', () => {
    expect(MAP_BASEMAPS.osm.url).toBe('mesh-tiles://osm/{z}/{x}/{y}.png');
    expect(MAP_BASEMAPS.dark.url).toBe('mesh-tiles://dark/{z}/{x}/{y}{r}.png');
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
