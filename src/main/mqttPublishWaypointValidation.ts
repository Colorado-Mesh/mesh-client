/**
 * MQTT `publishWaypoint` arg validation — sibling chunk (out of measured main index.js).
 */

export function validateMqttPublishWaypointArgs(args: unknown): void {
  if (!args || typeof args !== 'object') {
    throw new Error('mqtt:publishWaypoint: args must be an object');
  }
  const a = args as Record<string, unknown>;
  if (typeof a.publishJsonMirror !== 'boolean') {
    throw new Error('mqtt:publishWaypoint: publishJsonMirror must be a boolean');
  }
  const from = Number(a.from);
  if (!Number.isFinite(from) || from <= 0) {
    throw new Error('mqtt:publishWaypoint: from must be a positive node id');
  }
  const to = Number(a.to);
  if (!Number.isFinite(to) || to < 0) {
    throw new Error('mqtt:publishWaypoint: to must be a non-negative integer');
  }
  const channel = Number(a.channel);
  if (!Number.isFinite(channel) || channel < 0) {
    throw new Error('mqtt:publishWaypoint: channel must be a non-negative integer');
  }
  if (typeof a.channelName !== 'string' || !a.channelName.trim()) {
    throw new Error('mqtt:publishWaypoint: channelName must be a non-empty string');
  }
  const wp = a.waypoint;
  if (!wp || typeof wp !== 'object') {
    throw new Error('mqtt:publishWaypoint: waypoint must be an object');
  }
  const w = wp as Record<string, unknown>;
  const id = Number(w.id);
  if (!Number.isFinite(id)) throw new Error('mqtt:publishWaypoint: waypoint.id invalid');
  const latitudeI = Number(w.latitudeI);
  const longitudeI = Number(w.longitudeI);
  if (!Number.isFinite(latitudeI) || !Number.isFinite(longitudeI)) {
    throw new Error('mqtt:publishWaypoint: waypoint latitudeI/longitudeI invalid');
  }
  if (typeof w.name !== 'string')
    throw new Error('mqtt:publishWaypoint: waypoint.name must be a string');
  if (w.name.length > 256) throw new Error('mqtt:publishWaypoint: waypoint.name too long');
  if (w.description != null && typeof w.description !== 'string') {
    throw new Error('mqtt:publishWaypoint: waypoint.description invalid');
  }
  if (typeof w.description === 'string' && w.description.length > 1024) {
    throw new Error('mqtt:publishWaypoint: waypoint.description too long');
  }
  if (w.icon != null) {
    const icon = Number(w.icon);
    if (!Number.isFinite(icon) || icon < 0)
      throw new Error('mqtt:publishWaypoint: waypoint.icon invalid');
  }
  if (w.lockedTo != null) {
    const lt = Number(w.lockedTo);
    if (!Number.isFinite(lt) || lt < 0)
      throw new Error('mqtt:publishWaypoint: waypoint.lockedTo invalid');
  }
  if (w.expire != null) {
    const ex = Number(w.expire);
    if (!Number.isFinite(ex) || ex < 0)
      throw new Error('mqtt:publishWaypoint: waypoint.expire invalid');
  }
  if (w.geofenceRadius != null) {
    const radius = Number(w.geofenceRadius);
    if (!Number.isFinite(radius) || radius < 0)
      throw new Error('mqtt:publishWaypoint: waypoint.geofenceRadius invalid');
  }
  if (w.boundingBox != null) {
    if (typeof w.boundingBox !== 'object')
      throw new Error('mqtt:publishWaypoint: waypoint.boundingBox invalid');
    const box = w.boundingBox as Record<string, unknown>;
    for (const key of ['longitudeWestI', 'latitudeSouthI', 'longitudeEastI', 'latitudeNorthI']) {
      if (!Number.isFinite(Number(box[key])))
        throw new Error(`mqtt:publishWaypoint: waypoint.boundingBox.${key} invalid`);
    }
  }
  for (const key of ['notifyOnEnter', 'notifyOnExit', 'notifyFavoritesOnly'] as const) {
    if (w[key] != null && typeof w[key] !== 'boolean')
      throw new Error(`mqtt:publishWaypoint: waypoint.${key} must be a boolean`);
  }
}
