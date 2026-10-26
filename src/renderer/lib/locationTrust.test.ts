import { describe, expect, it } from 'vitest';

import type { GpsSource } from './gpsSource';
import {
  getLocationTrust,
  homeCoordsForDistanceFilter,
  homeNodeForDistanceChecks,
  type LocationTrust,
} from './locationTrust';
import type { MeshNode } from './types';

const home = { id: 'home' };
const fixedHome = { id: 'home', fixed: true };

describe('getLocationTrust', () => {
  it('is unknown without a position', () => {
    expect(getLocationTrust(null, home, 'home')).toBe('unknown');
  });

  it.each<[GpsSource, LocationTrust]>([
    ['device', 'trusted'],
    ['ip', 'approximate'],
    ['browser', 'approximate'],
  ])('%s -> %s regardless of saved-location state', (source, expected) => {
    expect(getLocationTrust({ source }, null, null)).toBe(expected);
    expect(getLocationTrust({ source }, fixedHome, 'home')).toBe(expected);
  });

  it('static needs confirmation until confirmed this session', () => {
    expect(getLocationTrust({ source: 'static' }, home, null)).toBe('needsConfirm');
    expect(getLocationTrust({ source: 'static' }, home, 'eoc')).toBe('needsConfirm');
    expect(getLocationTrust({ source: 'static' }, home, 'home')).toBe('trusted');
  });

  it('static at a fixed location is trusted without confirmation', () => {
    expect(getLocationTrust({ source: 'static' }, fixedHome, null)).toBe('trusted');
  });

  it('static without an active saved location needs confirmation', () => {
    expect(getLocationTrust({ source: 'static' }, null, null)).toBe('needsConfirm');
  });
});

describe('homeNodeForDistanceChecks', () => {
  const selfNode: MeshNode = {
    node_id: 1,
    long_name: 'Self',
    short_name: 'S',
    hw_model: 'TBEAM',
    snr: 0,
    battery: 100,
    last_heard: 0,
    latitude: 10,
    longitude: 20,
  };

  it('uses trusted reference coords over the self node row', () => {
    const out = homeNodeForDistanceChecks(selfNode, {
      lat: 39.7,
      lon: -104.9,
      source: 'static',
      trust: 'trusted',
    });
    expect(out).toMatchObject({ latitude: 39.7, longitude: -104.9 });
  });

  it.each<LocationTrust>(['needsConfirm', 'approximate', 'unknown'])(
    'clears coords when trust is %s',
    (trust) => {
      const out = homeNodeForDistanceChecks(selfNode, {
        lat: 39.7,
        lon: -104.9,
        source: 'ip',
        trust,
      });
      expect(out).toMatchObject({ latitude: null, longitude: null });
    },
  );

  it('clears stale self-node coords when no reference was published', () => {
    expect(homeNodeForDistanceChecks(selfNode, null)).toMatchObject({
      latitude: null,
      longitude: null,
    });
    expect(homeNodeForDistanceChecks(null, null)).toBeNull();
  });
});

describe('homeCoordsForDistanceFilter', () => {
  const selfNode: MeshNode = {
    node_id: 1,
    long_name: 'Self',
    short_name: 'S',
    hw_model: 'TBEAM',
    snr: 0,
    battery: 100,
    last_heard: 0,
    latitude: 10,
    longitude: 20,
  };

  it('prefers trusted reference over stale self-row coords', () => {
    expect(
      homeCoordsForDistanceFilter(selfNode, {
        lat: 41.59,
        lon: -73.02,
        source: 'static',
        trust: 'trusted',
      }),
    ).toEqual({ lat: 41.59, lon: -73.02 });
  });

  it('uses static reference even when trust is needsConfirm', () => {
    expect(
      homeCoordsForDistanceFilter(selfNode, {
        lat: 41.59,
        lon: -73.02,
        source: 'static',
        trust: 'needsConfirm',
      }),
    ).toEqual({ lat: 41.59, lon: -73.02 });
  });

  it('uses static ourPosition when reference is absent', () => {
    expect(
      homeCoordsForDistanceFilter(selfNode, null, {
        lat: 41.59,
        lon: -73.02,
        source: 'static',
      }),
    ).toEqual({ lat: 41.59, lon: -73.02 });
  });

  it('uses device ourPosition when reference is absent (share-off radio GPS)', () => {
    expect(
      homeCoordsForDistanceFilter(selfNode, null, {
        lat: 41.1,
        lon: -73.1,
        source: 'device',
      }),
    ).toEqual({ lat: 41.1, lon: -73.1 });
  });

  it('falls back to self-row when no static/trusted reference', () => {
    expect(
      homeCoordsForDistanceFilter(selfNode, {
        lat: 1,
        lon: 2,
        source: 'ip',
        trust: 'approximate',
      }),
    ).toEqual({ lat: 10, lon: 20 });
  });

  it('returns null without usable home coords', () => {
    expect(homeCoordsForDistanceFilter({ latitude: null, longitude: null }, null)).toBeNull();
  });
});
