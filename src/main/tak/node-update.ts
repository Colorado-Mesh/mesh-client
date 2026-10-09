import { isValidLatLon } from '../../shared/geoCoords';
import { isMeshProtocol, type MeshProtocol } from '../../shared/meshProtocol';
import { isTakTrackerRole } from '../../shared/tak-types';
import type { TakNodeUpdate } from '../tak-server-manager';

/** Callsign/remarks longer than this are truncated; ATAK labels are short anyway. */
const TAK_NODE_NAME_MAX_LEN = 256;
const MAX_UINT32 = 0xffffffff;
/** hw_model and tracker role tags are short identifiers. */
const TAK_NODE_TAG_MAX_LEN = 32;
/** Faster than any ground or air unit a mesh tracker rides on. */
const MAX_SPEED_MPS = 1000;
const MAX_STALE_SEC = 24 * 60 * 60;
/** The only explicit uid the renderer may set: a tracker fix's identity. */
export const TAK_TRACKER_UID_RE = /^meshtracker-[0-9a-f]{8}$/;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boundedInt(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

function shortTag(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= TAK_NODE_TAG_MAX_LEN
    ? value
    : undefined;
}

function nodeName(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, TAK_NODE_NAME_MAX_LEN) : undefined;
}

/**
 * Whitelist a renderer-supplied node update before it reaches the TAK node cache.
 * Only fields the CoT converter reads are copied, and optional fields are omitted rather than
 * set to undefined so a partial update does not erase cached values.
 * Returns null when the node id, protocol, or coordinates are unusable.
 */
export function parseTakNodeUpdate(raw: unknown): TakNodeUpdate | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Record<string, unknown>;

  const nodeId = Number(n.node_id);
  if (!Number.isInteger(nodeId) || nodeId <= 0 || nodeId > MAX_UINT32) return null;

  let protocol: MeshProtocol = 'meshtastic';
  if (n.protocol !== undefined) {
    if (typeof n.protocol !== 'string' || !isMeshProtocol(n.protocol)) return null;
    protocol = n.protocol;
  }

  const update: TakNodeUpdate = { node_id: nodeId, protocol };

  const lat = n.latitude;
  const lon = n.longitude;
  if (lat != null || lon != null) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isValidLatLon(lat, lon)) {
      return null;
    }
    update.latitude = lat;
    update.longitude = lon;
  }

  const altitude = finiteNumber(n.altitude);
  if (altitude !== undefined) update.altitude = altitude;
  const battery = finiteNumber(n.battery);
  if (battery !== undefined) update.battery = battery;
  const lastHeard = finiteNumber(n.last_heard);
  if (lastHeard !== undefined) update.last_heard = lastHeard;
  const shortName = nodeName(n.short_name);
  if (shortName !== undefined) update.short_name = shortName;
  const longName = nodeName(n.long_name);
  if (longName !== undefined) update.long_name = longName;
  const hwModel = shortTag(n.hw_model);
  if (hwModel !== undefined) update.hw_model = hwModel;
  const role = boundedInt(n.role, 0, 255);
  if (role !== undefined) update.role = role;
  const hops = boundedInt(n.hops_away, 0, 255);
  if (hops !== undefined) update.hops_away = hops;
  if (n.source === 'rf' || n.source === 'mqtt') update.source = n.source;
  if (n.infrastructure === true) update.infrastructure = true;

  if (n.uid !== undefined) {
    if (typeof n.uid !== 'string' || !TAK_TRACKER_UID_RE.test(n.uid)) return null;
    update.uid = n.uid;
  }
  const trackerRole = shortTag(n.tracker_role);
  if (trackerRole !== undefined && isTakTrackerRole(trackerRole)) update.tracker_role = trackerRole;
  const speed = finiteNumber(n.speed);
  if (speed !== undefined && speed >= 0 && speed <= MAX_SPEED_MPS) update.speed = speed;
  const course = finiteNumber(n.course);
  if (course !== undefined && course >= 0 && course < 360) update.course = course;
  const sequence = boundedInt(n.sequence, 0, MAX_UINT32);
  if (sequence !== undefined) update.sequence = sequence;
  const staleSec = boundedInt(n.stale_sec, 1, MAX_STALE_SEC);
  if (staleSec !== undefined) update.stale_sec = staleSec;

  return update;
}
