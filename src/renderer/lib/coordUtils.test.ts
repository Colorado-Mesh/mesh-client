import { describe, expect, it } from 'vitest';

import {
  isDisplayableCoord,
  latestPositionHistoryPoint,
  latestTrackedPositionEqual,
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

  it('rejects null-island tracked fallback', () => {
    expect(
      resolveNodeMapPosition({ latitude: null, longitude: null }, { lat: 0, lon: 0 }),
    ).toBeNull();
  });
});

describe('isDisplayableCoord', () => {
  it('rejects null island and non-finite values', () => {
    expect(isDisplayableCoord(0, 0)).toBe(false);
    expect(isDisplayableCoord(Number.NaN, 1)).toBe(false);
    expect(isDisplayableCoord(39.7, -104.9)).toBe(true);
  });
});

describe('latestTrackedPositionEqual', () => {
  it('treats identical coordinates as equal despite different object refs', () => {
    expect(latestTrackedPositionEqual({ lat: 40, lon: -105 }, { lat: 40, lon: -105 })).toBe(true);
  });

  it('detects coordinate changes and null transitions', () => {
    expect(latestTrackedPositionEqual({ lat: 40, lon: -105 }, { lat: 41, lon: -105 })).toBe(false);
    expect(latestTrackedPositionEqual(null, null)).toBe(true);
    expect(latestTrackedPositionEqual(null, { lat: 1, lon: 2 })).toBe(false);
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

  it('returns null when newest point is null island', () => {
    expect(
      latestPositionHistoryPoint([
        { t: 100, lat: 40, lon: -105 },
        { t: 200, lat: 0, lon: 0 },
      ]),
    ).toBeNull();
  });
});
