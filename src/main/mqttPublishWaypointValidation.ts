/**
 * MQTT `publishWaypoint` arg validation — sibling chunk (out of measured main index.js).
 */

const DEG_SCALE = 1e7;

function isLatitudeI(value: number): boolean {
  return Number.isFinite(value) && value >= -90 * DEG_SCALE && value <= 90 * DEG_SCALE;
}

function isLongitudeI(value: number): boolean {
  return Number.isFinite(value) && value >= -180 * DEG_SCALE && value <= 180 * DEG_SCALE;
}

function assertNonNegativeNumber(
  source: Record<string, unknown>,
  key: string,
  message: string,
): void {
  const value = Number(source[key]);
  if (!Number.isFinite(value) || value < 0) throw new Error(message);
}

function assertPublishWaypointArgsObject(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object') {
    throw new Error('mqtt:publishWaypoint: args must be an object');
  }
  return args as Record<string, unknown>;
}

function assertPublishWaypointBaseFields(a: Record<string, unknown>): void {
  if (typeof a.publishJsonMirror !== 'boolean') {
    throw new Error('mqtt:publishWaypoint: publishJsonMirror must be a boolean');
  }
  const from = Number(a.from);
  if (!Number.isFinite(from) || from <= 0) {
    throw new Error('mqtt:publishWaypoint: from must be a positive node id');
  }
  assertNonNegativeNumber(a, 'to', 'mqtt:publishWaypoint: to must be a non-negative integer');
  assertNonNegativeNumber(
    a,
    'channel',
    'mqtt:publishWaypoint: channel must be a non-negative integer',
  );
  if (typeof a.channelName !== 'string' || !a.channelName.trim()) {
    throw new Error('mqtt:publishWaypoint: channelName must be a non-empty string');
  }
}

function assertWaypointIdentity(w: Record<string, unknown>): void {
  const id = Number(w.id);
  if (!Number.isFinite(id)) throw new Error('mqtt:publishWaypoint: waypoint.id invalid');
}

function assertWaypointCoordinates(w: Record<string, unknown>): void {
  const latitudeI = Number(w.latitudeI);
  const longitudeI = Number(w.longitudeI);
  if (!Number.isFinite(latitudeI) || !Number.isFinite(longitudeI)) {
    throw new Error('mqtt:publishWaypoint: waypoint latitudeI/longitudeI invalid');
  }
  if (!isLatitudeI(latitudeI)) {
    throw new Error('mqtt:publishWaypoint: waypoint latitudeI out of range');
  }
  if (!isLongitudeI(longitudeI)) {
    throw new Error('mqtt:publishWaypoint: waypoint longitudeI out of range');
  }
}

function assertWaypointTextFields(w: Record<string, unknown>): void {
  if (typeof w.name !== 'string')
    throw new Error('mqtt:publishWaypoint: waypoint.name must be a string');
  if (w.name.length > 256) throw new Error('mqtt:publishWaypoint: waypoint.name too long');
  if (w.description != null && typeof w.description !== 'string') {
    throw new Error('mqtt:publishWaypoint: waypoint.description invalid');
  }
  if (typeof w.description === 'string' && w.description.length > 1024) {
    throw new Error('mqtt:publishWaypoint: waypoint.description too long');
  }
}

function assertWaypointOptionalNumbers(w: Record<string, unknown>): void {
  // Literal messages (not a key loop): scripts/esbuild-main-build.test.mjs asserts them verbatim.
  if (w.icon != null) {
    assertNonNegativeNumber(w, 'icon', 'mqtt:publishWaypoint: waypoint.icon invalid');
  }
  if (w.lockedTo != null) {
    assertNonNegativeNumber(w, 'lockedTo', 'mqtt:publishWaypoint: waypoint.lockedTo invalid');
  }
  if (w.expire != null) {
    assertNonNegativeNumber(w, 'expire', 'mqtt:publishWaypoint: waypoint.expire invalid');
  }
  if (w.geofenceRadius != null) {
    assertNonNegativeNumber(
      w,
      'geofenceRadius',
      'mqtt:publishWaypoint: waypoint.geofenceRadius invalid',
    );
  }
}

function assertWaypointBoundingBox(boundingBox: unknown): void {
  if (boundingBox == null) return;
  if (typeof boundingBox !== 'object') {
    throw new Error('mqtt:publishWaypoint: waypoint.boundingBox invalid');
  }
  const box = boundingBox as Record<string, unknown>;
  // Wire coords are degrees × 1e7 (same scale as Position / Waypoint lat/lon).
  const west = Number(box.longitudeWestI);
  const south = Number(box.latitudeSouthI);
  const east = Number(box.longitudeEastI);
  const north = Number(box.latitudeNorthI);
  if (!isLongitudeI(west)) {
    throw new Error('mqtt:publishWaypoint: waypoint.boundingBox.longitudeWestI invalid');
  }
  if (!isLatitudeI(south)) {
    throw new Error('mqtt:publishWaypoint: waypoint.boundingBox.latitudeSouthI invalid');
  }
  if (!isLongitudeI(east)) {
    throw new Error('mqtt:publishWaypoint: waypoint.boundingBox.longitudeEastI invalid');
  }
  if (!isLatitudeI(north)) {
    throw new Error('mqtt:publishWaypoint: waypoint.boundingBox.latitudeNorthI invalid');
  }
  if (!(west < east && south < north)) {
    throw new Error('mqtt:publishWaypoint: waypoint.boundingBox ordering invalid');
  }
}

function assertWaypointBooleanFlags(w: Record<string, unknown>): void {
  for (const key of ['notifyOnEnter', 'notifyOnExit', 'notifyFavoritesOnly'] as const) {
    if (w[key] != null && typeof w[key] !== 'boolean')
      throw new Error(`mqtt:publishWaypoint: waypoint.${key} must be a boolean`);
  }
}

export function validateMqttPublishWaypointArgs(args: unknown): void {
  const a = assertPublishWaypointArgsObject(args);
  assertPublishWaypointBaseFields(a);
  const wp = a.waypoint;
  if (!wp || typeof wp !== 'object') {
    throw new Error('mqtt:publishWaypoint: waypoint must be an object');
  }
  const w = wp as Record<string, unknown>;
  assertWaypointIdentity(w);
  assertWaypointCoordinates(w);
  assertWaypointTextFields(w);
  assertWaypointOptionalNumbers(w);
  assertWaypointBoundingBox(w.boundingBox);
  assertWaypointBooleanFlags(w);
}
