import type { MeshDevice } from '@meshtastic/core';

import { errLikeToLogString } from '../errLikeToLogString';
import type { ConnectionType } from '../types';
import { attachMeshtasticTransportLossWatch } from './meshtasticTransportLossDetection';

/** Liveness heartbeat cadence for persistent links (serial/BLE/TCP). */
const MESHTASTIC_HEARTBEAT_INTERVAL_MS = 60_000;

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

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (type === 'serial' || type === 'ble' || type === 'http' || type === 'tcp') {
    push(attachMeshtasticTransportLossWatch(device, type, onTransportLost));
  }

  if (type === 'serial' || type === 'ble' || type === 'tcp') {
    // Drive the liveness heartbeat ourselves instead of device.setHeartbeatInterval(): the SDK
    // fires `this.heartbeat()` from a bare setInterval and discards the promise, so a rejected
    // heartbeat send (e.g. a queue "Packet does not exist" teardown race) surfaces as an
    // unhandled rejection every interval. Awaiting + catching here keeps it out of the global
    // rejection path while preserving the keep-alive.
    const heartbeatTimer = setInterval(() => {
      void device.heartbeat().catch((e: unknown) => {
        console.debug(
          `[meshtasticTransportSideEffects] ${type}: heartbeat send failed ` +
            errLikeToLogString(e),
        );
      });
    }, MESHTASTIC_HEARTBEAT_INTERVAL_MS);
    push(() => {
      clearInterval(heartbeatTimer);
    });
  }
}
