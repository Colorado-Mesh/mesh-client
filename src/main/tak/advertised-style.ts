import type { MeshProtocol } from '../../shared/meshProtocol';
import type { TakTrackerRole, TakUnitStyle } from '../../shared/tak-types';
import { isTakTrackerRole } from '../../shared/tak-types';

/** Friendly ground unit on the default cyan team: a person carrying a radio. */
export const TAK_PERSON_STYLE: TakUnitStyle = {
  cotType: 'a-f-G-U-C',
  group: 'Cyan',
  role: 'Team Member',
};

/** Friendly ground installation: repeaters, routers, room servers, interfaces. */
export const TAK_RELAY_STYLE: TakUnitStyle = { cotType: 'a-f-G-I' };

/** Friendly ground sensor equipment. */
export const TAK_SENSOR_STYLE: TakUnitStyle = { cotType: 'a-f-G-E-S' };

export const TAK_TRACKER_ROLE_STYLES: Record<TakTrackerRole, TakUnitStyle> = {
  k9: { cotType: 'a-f-G-U-C', group: 'Blue', role: 'K9' },
  veh: { cotType: 'a-f-G-E-V', group: 'Orange', role: 'Team Member' },
  per: { cotType: 'a-f-G-U-C', group: 'Cyan', role: 'Team Member' },
  fw: { cotType: 'a-f-G-U-C', group: 'Red', role: 'Team Member' },
  ems: { cotType: 'a-f-G-U-S-M', group: 'White', role: 'Medic' },
  cmd: { cotType: 'a-f-G-U-C', group: 'Purple', role: 'HQ' },
};

/** Meshtastic `Config.DeviceConfig.Role` values for fixed relays rather than people. */
const MESHTASTIC_RELAY_ROLES: ReadonlySet<number> = new Set([
  2, // ROUTER
  3, // ROUTER_CLIENT
  4, // REPEATER
  11, // ROUTER_LATE
]);
const MESHTASTIC_SENSOR_ROLE = 6;

export interface AdvertisedStyleInput {
  hw_model?: string;
  role?: number;
  tracker_role?: string;
  infrastructure?: boolean;
}

/** Style from what the node says about itself: tracker role tag, advert type, or device role. */
export function advertisedTakStyle(
  node: AdvertisedStyleInput,
  protocol: MeshProtocol,
): TakUnitStyle {
  if (node.tracker_role && isTakTrackerRole(node.tracker_role)) {
    return TAK_TRACKER_ROLE_STYLES[node.tracker_role];
  }
  if (node.infrastructure) return TAK_RELAY_STYLE;
  if (protocol === 'meshcore') {
    if (node.hw_model === 'Repeater' || node.hw_model === 'Room') return TAK_RELAY_STYLE;
    if (node.hw_model === 'Sensor') return TAK_SENSOR_STYLE;
  }
  if (protocol === 'meshtastic' && node.role != null) {
    if (MESHTASTIC_RELAY_ROLES.has(node.role)) return TAK_RELAY_STYLE;
    if (node.role === MESHTASTIC_SENSOR_ROLE) return TAK_SENSOR_STYLE;
  }
  return TAK_PERSON_STYLE;
}
