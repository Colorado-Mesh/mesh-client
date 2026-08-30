import { isShareMyLocationEnabled } from '@/renderer/lib/appSettingsStorage';

/** Meshtastic Config.DeviceConfig.Role.CLIENT_MUTE */
export const MESHTASTIC_ROLE_CLIENT_MUTE = 1;

export type LocationTransmitProtocol = 'meshtastic' | 'meshcore' | 'reticulum';

export interface CanTransmitLocationOpts {
  protocol: LocationTransmitProtocol;
  meshtasticRole?: number | null;
}

/** Whether mesh-client may send or publish the user's location for the active protocol. */
export function canTransmitLocation(opts: CanTransmitLocationOpts): boolean {
  if (!isShareMyLocationEnabled()) return false;
  if (opts.protocol === 'meshtastic' && opts.meshtasticRole === MESHTASTIC_ROLE_CLIENT_MUTE) {
    return false;
  }
  return true;
}
