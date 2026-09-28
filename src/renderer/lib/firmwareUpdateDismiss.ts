import { errLikeToLogString } from './errLikeToLogString';
import type { MeshProtocol } from './types';

const KEY_PREFIX = 'mesh-client:firmwareUpdateDismissed:';

/** The firmware release the user asked not to be reminded about for this protocol, if any. */
export function readDismissedFirmwareVersion(protocol: MeshProtocol): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + protocol);
  } catch (e) {
    console.debug('[firmwareUpdateDismiss] read failed ' + errLikeToLogString(e));
    return null;
  }
}

/** Stop the update toast for this release; a newer release shows it again. */
export function dismissFirmwareVersion(protocol: MeshProtocol, version: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + protocol, version);
  } catch (e) {
    console.debug('[firmwareUpdateDismiss] write failed ' + errLikeToLogString(e));
  }
}
