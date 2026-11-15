import { describe, expect, it } from 'vitest';

import {
  boundingBoxDegToI,
  boundingBoxIToDeg,
  normalizeWaypointGeofenceForWire,
  readWaypointGeofenceFromDecoded,
} from './meshtasticWaypointGeofence';

describe('meshtasticWaypointGeofence', () => {
  it('round-trips bounding boxes through i-scaled integers', () => {
    const deg = { west: -105.1, south: 39.5, east: -104.9, north: 39.9 };
    const again = boundingBoxIToDeg(boundingBoxDegToI(deg));
    expect(again.west).toBeCloseTo(deg.west, 6);
    expect(again.south).toBeCloseTo(deg.south, 6);
    expect(again.east).toBeCloseTo(deg.east, 6);
    expect(again.north).toBeCloseTo(deg.north, 6);
  });

  it('normalizes wire fields and drops inverted boxes', () => {
    expect(
      normalizeWaypointGeofenceForWire({
        geofenceRadius: 250.9,
        boundingBox: { west: 1, south: 2, east: 0, north: 3 },
        notifyOnEnter: true,
      }),
    ).toEqual({
      geofenceRadius: 250,
      boundingBox: undefined,
      notifyOnEnter: true,
      notifyOnExit: false,
      notifyFavoritesOnly: false,
    });
  });

  it('reads decoded protobuf-shaped geofence fields', () => {
    const fields = readWaypointGeofenceFromDecoded({
      geofenceRadius: 100,
      boundingBox: {
        longitudeWestI: -1_051_000_000,
        latitudeSouthI: 395_000_000,
        longitudeEastI: -1_049_000_000,
        latitudeNorthI: 399_000_000,
      },
      notifyOnExit: true,
      notifyFavoritesOnly: true,
    });
    expect(fields.geofenceRadius).toBe(100);
    expect(fields.notifyOnExit).toBe(true);
    expect(fields.notifyFavoritesOnly).toBe(true);
    expect(fields.boundingBox?.west).toBeCloseTo(-105.1, 5);
  });
});
