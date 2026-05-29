import type { MeshDevice } from '@meshtastic/core';

import { errLikeToLogString } from '../errLikeToLogString';
import type { ConnectionType } from '../types';
import { attachMeshtasticTransportLossWatch } from './meshtasticTransportLossDetection';

/**
 * Transport-level side effects not yet modeled as `DomainEvent`s (Noble disconnect,
 * serial/BLE heartbeat). Pushed onto the hook unsubscribe list by `useMeshtasticRuntime` wire subscriptions.
 */
export function pushMeshtasticTransportSideEffectUnsubs(
  device: MeshDevice,
  type: ConnectionType,
  push: (unsub: () => void) => void,
  onTransportLost: () => void,
): void {
  if (type === 'ble') {
    push(
      window.electronAPI.onNobleBleDisconnected((sessionId) => {
        if (sessionId !== 'meshtastic') return;
        console.warn('[meshtasticLegacyDeviceEvents] Noble BLE disconnected');
        onTransportLost();
      }),
    );
  }

  if (type === 'serial') {
    push(attachMeshtasticTransportLossWatch(device, type, onTransportLost));
  }

  if (type === 'serial' || type === 'ble') {
    try {
      device.setHeartbeatInterval(60_000);
    } catch (e) {
      console.warn(
        `[meshtasticLegacyDeviceEvents] ${type}: setHeartbeatInterval failed ` +
          errLikeToLogString(e),
      );
    }
  }
}
