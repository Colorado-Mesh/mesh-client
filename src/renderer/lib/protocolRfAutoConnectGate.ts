import type { MeshProtocol } from '@/renderer/lib/types';

/**
 * Cancels deferred ProtocolAutoConnectCoordinator BLE/serial auto-connect when the user
 * starts a manual Connect (or Cancel / Reconnect) on ConnectionPanel.
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
