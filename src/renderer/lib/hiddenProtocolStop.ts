import {
  isReticulumManualStackStopSuppress,
  setReticulumManualStackStopSuppress,
} from './reticulum/reticulumManualStackStopSuppress';
import { tryGetMeshcomSession } from './sessions/meshcomSession';
import { tryGetMeshcoreSession } from './sessions/meshcoreSession';
import { tryGetMeshtasticSession } from './sessions/meshtasticSession';
import type { MeshProtocol } from './types';

function rfSessionFor(protocol: Exclude<MeshProtocol, 'reticulum'>) {
  if (protocol === 'meshtastic') return tryGetMeshtasticSession();
  if (protocol === 'meshcore') return tryGetMeshcoreSession();
  return tryGetMeshcomSession();
}

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
  return rfSessionFor(protocol)?.latchExplicitDisconnect?.() ?? false;
}

/** Undo a hide-induced latch so turning the protocol back on can connect again. */
export function releaseHiddenProtocolStop(protocol: MeshProtocol): void {
  if (protocol === 'reticulum') {
    setReticulumManualStackStopSuppress(false);
    return;
  }
  rfSessionFor(protocol)?.clearExplicitDisconnectLatch?.();
}
