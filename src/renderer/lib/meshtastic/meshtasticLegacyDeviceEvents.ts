import type { MeshDevice } from '@meshtastic/core';

import { errLikeToLogString } from '../errLikeToLogString';
import type { ConnectionType } from '../types';
import { attachMeshtasticTransportLossWatch } from './meshtasticTransportLossDetection';

/**
 * Transport-level side effects not yet modeled as `DomainEvent`s (Noble disconnect,
 * serialized toDevice for serial/BLE, heartbeat). Pushed onto the hook unsubscribe
 * list by `useMeshtasticRuntime` wire subscriptions.
 */
export function pushMeshtasticTransportSideEffectUnsubs(
  device: MeshDevice,
  type: ConnectionType,
  push: (unsub: () => void) => void,
  onTransportLost: () => void,
): void {
  // Noble BLE disconnect is handled at runtime mount (useMeshtasticRuntime) with storage rehydrate.

  if (type === 'serial' || type === 'ble') {
    push(attachMeshtasticTransportLossWatch(device, type, onTransportLost));
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
