import { describe, expect, it } from 'vitest';

import { hgtTileDir, hgtTileName, hgtTilesForBounds } from './hgt';

describe('hgtTileName', () => {
  it('names northern and western cells', () => {
    expect(hgtTileName(39.7, -105.0)).toBe('N39W105');
    expect(hgtTileName(0.1, 0.1)).toBe('N00E000');
  });

  it('names southern and eastern cells', () => {
    expect(hgtTileName(-12.3, 45.2)).toBe('S13E045');
  });
});

describe('hgtTileDir', () => {
  it('uses the latitude prefix', () => {
    expect(hgtTileDir('N39W105')).toBe('N39');
  });
});

describe('hgtTilesForBounds', () => {
  it('covers each degree cell in the box', () => {
    const names = hgtTilesForBounds({
      south: 39.1,
      west: -106.2,
      north: 40.2,
      east: -104.8,
    });
    expect(names).toContain('N39W106');
    expect(names).toContain('N40W105');
    expect(names.length).toBeGreaterThanOrEqual(4);
  });
});
