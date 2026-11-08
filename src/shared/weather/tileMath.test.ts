import { describe, expect, it } from 'vitest';

import { tileToBounds, WEB_MERCATOR_WORLD_M, webMercatorTileBounds } from './tileMath';

describe('tileMath', () => {
  it('returns world extent for z0', () => {
    const b = webMercatorTileBounds(0, 0, 0);
    expect(b.minX).toBeCloseTo(-WEB_MERCATOR_WORLD_M / 2, 3);
    expect(b.maxX).toBeCloseTo(WEB_MERCATOR_WORLD_M / 2, 3);
    expect(b.maxY).toBeCloseTo(WEB_MERCATOR_WORLD_M / 2, 3);
    expect(b.minY).toBeCloseTo(-WEB_MERCATOR_WORLD_M / 2, 3);
  });

  it('tileToBounds is within expected ranges', () => {
    const b = tileToBounds(1, 0, 0);
    expect(b.west).toBeLessThan(b.east);
    expect(b.south).toBeLessThan(b.north);
    expect(b.west).toBeCloseTo(-180, 0);
    expect(b.north).toBeGreaterThan(0);
  });
});
