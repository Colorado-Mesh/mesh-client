import { isValidLatLon } from '../../shared/geoCoords';
import { isMeshProtocol, type MeshProtocol } from '../../shared/meshProtocol';
import type { TakNodeUpdate } from '../tak-server-manager';

/** Callsign/remarks longer than this are truncated; ATAK labels are short anyway. */
const TAK_NODE_NAME_MAX_LEN = 256;
const MAX_UINT32 = 0xffffffff;

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

  return update;
}
