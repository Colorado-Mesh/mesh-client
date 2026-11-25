/**
 * Meshtastic 2.8 Waypoint geofence helpers (radius / bounding box / notify flags).
 * Coordinates on the wire use degrees × 1e7 (same as Position / Waypoint lat/lon).
 */

export interface WaypointBoundingBoxDeg {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface WaypointBoundingBoxI {
  longitudeWestI: number;
  latitudeSouthI: number;
  longitudeEastI: number;
  latitudeNorthI: number;
}

export interface WaypointGeofenceFields {
  geofenceRadius?: number;
  boundingBox?: WaypointBoundingBoxDeg;
  notifyOnEnter?: boolean;
  notifyOnExit?: boolean;
  notifyFavoritesOnly?: boolean;
}

const DEG_SCALE = 1e7;

function degToCoordI(deg: number): number {
  return Math.round(deg * DEG_SCALE);
}

function coordIToDeg(value: number): number {
  return value / DEG_SCALE;
}

export function boundingBoxDegToI(box: WaypointBoundingBoxDeg): WaypointBoundingBoxI {
  return {
    longitudeWestI: degToCoordI(box.west),
    latitudeSouthI: degToCoordI(box.south),
    longitudeEastI: degToCoordI(box.east),
    latitudeNorthI: degToCoordI(box.north),
  };
}

export function boundingBoxIToDeg(box: WaypointBoundingBoxI): WaypointBoundingBoxDeg {
  return {
    west: coordIToDeg(box.longitudeWestI),
    south: coordIToDeg(box.latitudeSouthI),
    east: coordIToDeg(box.longitudeEastI),
    north: coordIToDeg(box.latitudeNorthI),
  };
}

/** Normalize optional geofence fields for protobuf / MQTT encode. */
export function normalizeWaypointGeofenceForWire(fields: WaypointGeofenceFields): {
  geofenceRadius: number;
  boundingBox?: WaypointBoundingBoxI;
  notifyOnEnter: boolean;
  notifyOnExit: boolean;
  notifyFavoritesOnly: boolean;
} {
  const radius =
    typeof fields.geofenceRadius === 'number' && Number.isFinite(fields.geofenceRadius)
      ? Math.max(0, Math.trunc(fields.geofenceRadius))
      : 0;
  const box = fields.boundingBox;
  const boundingBox =
    box &&
    Number.isFinite(box.west) &&
    Number.isFinite(box.south) &&
    Number.isFinite(box.east) &&
    Number.isFinite(box.north) &&
    box.west < box.east &&
    box.south < box.north
      ? boundingBoxDegToI(box)
      : undefined;
  return {
    geofenceRadius: radius,
    boundingBox,
    notifyOnEnter: fields.notifyOnEnter === true,
    notifyOnExit: fields.notifyOnExit === true,
    notifyFavoritesOnly: fields.notifyFavoritesOnly === true,
  };
}

/** Read geofence fields from a decoded Waypoint-like object. */
export function readWaypointGeofenceFromDecoded(data: {
  geofenceRadius?: number;
  boundingBox?: Partial<WaypointBoundingBoxI> | null;
  notifyOnEnter?: boolean;
  notifyOnExit?: boolean;
  notifyFavoritesOnly?: boolean;
}): WaypointGeofenceFields {
  const radius =
    typeof data.geofenceRadius === 'number' && Number.isFinite(data.geofenceRadius)
      ? Math.max(0, Math.trunc(data.geofenceRadius))
      : undefined;
  const raw = data.boundingBox;
  let boundingBox: WaypointBoundingBoxDeg | undefined;
  if (
    raw &&
    typeof raw.longitudeWestI === 'number' &&
    typeof raw.latitudeSouthI === 'number' &&
    typeof raw.longitudeEastI === 'number' &&
    typeof raw.latitudeNorthI === 'number' &&
    Number.isFinite(raw.longitudeWestI) &&
    Number.isFinite(raw.latitudeSouthI) &&
    Number.isFinite(raw.longitudeEastI) &&
    Number.isFinite(raw.latitudeNorthI)
  ) {
    boundingBox = boundingBoxIToDeg({
      longitudeWestI: raw.longitudeWestI,
      latitudeSouthI: raw.latitudeSouthI,
      longitudeEastI: raw.longitudeEastI,
      latitudeNorthI: raw.latitudeNorthI,
    });
  }
  return {
    geofenceRadius: radius && radius > 0 ? radius : undefined,
    boundingBox,
    notifyOnEnter: data.notifyOnEnter === true ? true : undefined,
    notifyOnExit: data.notifyOnExit === true ? true : undefined,
    notifyFavoritesOnly: data.notifyFavoritesOnly === true ? true : undefined,
  };
}
