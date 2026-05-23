import { describe, expect, it } from 'vitest';

import {
  latestPositionHistoryPoint,
  nodeHasDisplayablePosition,
  resolveNodeMapPosition,
} from './coordUtils';

describe('nodeHasDisplayablePosition', () => {
  it('returns false for null or null island', () => {
    expect(nodeHasDisplayablePosition({ latitude: null, longitude: null })).toBe(false);
    expect(nodeHasDisplayablePosition({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it('returns true for valid coordinates', () => {
    expect(nodeHasDisplayablePosition({ latitude: 39.7, longitude: -104.9 })).toBe(true);
  });
});

describe('resolveNodeMapPosition', () => {
  it('prefers node DB coordinates over tracked history', () => {
    expect(
      resolveNodeMapPosition({ latitude: 40, longitude: -105 }, { lat: 41, lon: -106 }),
    ).toEqual({ lat: 40, lon: -105 });
  });

  it('falls back to latest tracked point', () => {
    expect(resolveNodeMapPosition({ latitude: 0, longitude: 0 }, { lat: 41, lon: -106 })).toEqual({
      lat: 41,
      lon: -106,
    });
  });
});

describe('latestPositionHistoryPoint', () => {
  it('returns newest point by timestamp', () => {
    expect(
      latestPositionHistoryPoint([
        { t: 100, lat: 1, lon: 2 },
        { t: 300, lat: 3, lon: 4 },
        { t: 200, lat: 5, lon: 6 },
      ]),
    ).toEqual({ lat: 3, lon: 4 });
  });
});
