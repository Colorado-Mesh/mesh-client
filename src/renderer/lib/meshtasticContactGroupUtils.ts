import { validateCoords } from './coordUtils';
import type { NodeRecord } from '../stores/nodeStore';

/** Built-in Meshtastic node-list group: nodes with a valid reported GPS position (excludes self). */
export const MESHTASTIC_CONTACT_GROUP_BUILTIN_GPS = -10;

/** Built-in Meshtastic node-list group: heard on RF this session and also updated via MQTT (excludes self). */
export const MESHTASTIC_CONTACT_GROUP_BUILTIN_RF_MQTT = -11;

/** Built-in Meshtastic node-list group: Router or Router Late (role 2 or 11). */
export const MESHTASTIC_CONTACT_GROUP_BUILTIN_ROUTER = -12;

export const MESHTASTIC_BUILTIN_CONTACT_GROUP_FILTERS = [
  { group_id: MESHTASTIC_CONTACT_GROUP_BUILTIN_GPS, label: 'GPS' },
  { group_id: MESHTASTIC_CONTACT_GROUP_BUILTIN_RF_MQTT, label: 'RF+MQTT' },
  { group_id: MESHTASTIC_CONTACT_GROUP_BUILTIN_ROUTER, label: 'Router' },
] as const;

/**
 * Meshtastic smart filter: valid lat/lon (not 0,0 placeholder), same rules as validateCoords.
 * Self node is excluded so the list matches “other nodes with GPS.”
 */
export function meshtasticContactGroupMatchesBuiltinGps(
  node: Pick<NodeRecord, 'nodeId' | 'latitude' | 'longitude'>,
  myNodeNum: number,
): boolean {
  if (myNodeNum > 0 && node.nodeId === myNodeNum) return false;
  const lat = node.latitude;
  const lon = node.longitude;
  if (lat == null || lon == null) return false;
  return validateCoords(lat, lon).valid;
}

/**
 * Meshtastic smart filter: at least one MQTT-derived update this session and also heard on RF
 * (not MQTT-only). Self excluded.
 */
export function meshtasticContactGroupMatchesBuiltinRfMqtt(
  node: Pick<NodeRecord, 'nodeId' | 'heardViaMqtt' | 'heardViaMqttOnly'>,
  myNodeNum: number,
): boolean {
  if (myNodeNum > 0 && node.nodeId === myNodeNum) return false;
  return node.heardViaMqtt === true && node.heardViaMqttOnly === false;
}

/** Meshtastic has no MeshCore contact-type roles; any node except self may join user groups. */
export function isMeshtasticContactEligibleForUserGroup(
  node: Pick<NodeRecord, 'nodeId'>,
  selfNodeId: number | null,
): boolean {
  if (selfNodeId == null || selfNodeId <= 0) return false;
  return node.nodeId !== selfNodeId;
}

/**
 * Meshtastic smart filter: Router (role 2) or Router Late (role 11).
 * Self excluded.
 */
export function meshtasticContactGroupMatchesBuiltinRouter(
  node: Pick<NodeRecord, 'nodeId' | 'role'>,
  myNodeNum: number,
): boolean {
  if (myNodeNum > 0 && node.nodeId === myNodeNum) return false;
  return node.role === 2 || node.role === 11;
}
