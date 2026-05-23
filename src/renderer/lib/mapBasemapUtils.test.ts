import { describe, expect, it } from 'vitest';

import { getMapOverlayColors, MAP_BASEMAPS } from './mapBasemapUtils';

describe('mapBasemapUtils', () => {
  it('uses darker greens on light basemap for contrast', () => {
    expect(getMapOverlayColors(false).online).toBe('#15803d');
    expect(getMapOverlayColors(true).online).toBe('#86efac');
  });

  it('defines dark and osm basemaps', () => {
    expect(MAP_BASEMAPS.dark.isDark).toBe(true);
    expect(MAP_BASEMAPS.osm.isDark).toBe(false);
  });

  it('defaults to light osm basemap', async () => {
    const { DEFAULT_MAP_BASEMAP_ID } = await import('./mapBasemapUtils');
    expect(DEFAULT_MAP_BASEMAP_ID).toBe('osm');
  });
});
