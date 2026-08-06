import type { MeshProtocol } from '@/renderer/lib/types';

/**
 * Cancels deferred ProtocolAutoConnectCoordinator BLE/serial auto-connect when the user
 * starts a manual Connect (or Cancel) on ConnectionPanel. Panel-local autoConnectCancelRef
 * is a no-op while suppressMountAutoConnect is set — this gate is the coordinator path.
 */
const cancelledByProtocol = new Map<MeshProtocol, boolean>();

export function cancelProtocolRfAutoConnect(protocol: MeshProtocol): void {
  cancelledByProtocol.set(protocol, true);
}

export function resetProtocolRfAutoConnectCancel(protocol: MeshProtocol): void {
  cancelledByProtocol.set(protocol, false);
}

export function isProtocolRfAutoConnectCancelled(protocol: MeshProtocol): boolean {
  return cancelledByProtocol.get(protocol) === true;
}
