// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  estimateTileCount,
  isRegionWithinCaps,
  latLonToTile,
  OFFLINE_MAP_MAX_TILES,
  tilesForBoundsAtZoom,
  WEB_MERCATOR_MAX_LAT,
} from './tileMath';

describe('tileMath', () => {
  it('clamps latitude for Web Mercator', () => {
    const t = latLonToTile(89, 0, 5);
    const edge = latLonToTile(WEB_MERCATOR_MAX_LAT, 0, 5);
    expect(t.y).toBe(edge.y);
  });

  it('estimates a known bbox at a single zoom', () => {
    const bounds = { north: 40.02, south: 40.0, east: -105.24, west: -105.28 };
    const count = estimateTileCount(bounds, 14, 14);
    expect(count).toBeGreaterThan(0);
    expect(count).toBe(tilesForBoundsAtZoom(bounds, 14).length);
  });

  it('returns empty for inverted bounds', () => {
    expect(estimateTileCount({ north: 10, south: 20, east: 10, west: 0 }, 10, 10)).toBe(0);
  });

  it('rejects oversize regions via caps', () => {
    expect(isRegionWithinCaps(0)).toBe(false);
    expect(isRegionWithinCaps(1)).toBe(true);
    expect(isRegionWithinCaps(OFFLINE_MAP_MAX_TILES + 1)).toBe(false);
  });
});
