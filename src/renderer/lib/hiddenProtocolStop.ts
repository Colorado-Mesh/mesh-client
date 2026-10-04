import {
  isReticulumManualStackStopSuppress,
  setReticulumManualStackStopSuppress,
} from './reticulum/reticulumManualStackStopSuppress';
import { tryGetMeshcoreSession } from './sessions/meshcoreSession';
import { tryGetMeshtasticSession } from './sessions/meshtasticSession';
import type { MeshProtocol } from './types';

/**
 * Latch the user-stop flag wake reconnect already honors, including when the
 * radio is already disconnected. Returns true when this call is what latched it.
 */
export function latchHiddenProtocolStop(protocol: MeshProtocol): boolean {
  if (protocol === 'reticulum') {
    if (isReticulumManualStackStopSuppress()) return false;
    setReticulumManualStackStopSuppress(true);
    return true;
  }
  const session = protocol === 'meshtastic' ? tryGetMeshtasticSession() : tryGetMeshcoreSession();
  return session?.latchExplicitDisconnect?.() ?? false;
}

/** Undo a hide-induced latch so turning the protocol back on can connect again. */
export function releaseHiddenProtocolStop(protocol: MeshProtocol): void {
  if (protocol === 'reticulum') {
    setReticulumManualStackStopSuppress(false);
    return;
  }
  const session = protocol === 'meshtastic' ? tryGetMeshtasticSession() : tryGetMeshcoreSession();
  session?.clearExplicitDisconnectLatch?.();
}
