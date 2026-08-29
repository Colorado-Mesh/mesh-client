import type { MeshDevice } from '@meshtastic/core';

import { errLikeToLogString } from '../errLikeToLogString';
import type { ConnectionType } from '../types';
import { attachMeshtasticTransportLossWatch } from './meshtasticTransportLossDetection';

/** Liveness heartbeat cadence for persistent links (serial/BLE/TCP). */
const MESHTASTIC_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Current SDK queue depth, or `null` when the device does not expose one.
 *
 * `MeshDevice.queue` is declared non-optional, but partially-mocked devices in tests omit it, and
 * this only feeds a diagnostic log line — losing one datum beats throwing from the heartbeat path.
 */
function readMeshtasticQueueDepth(device: MeshDevice): number | null {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  const items = device.queue?.getState?.();
  return Array.isArray(items) ? items.length : null;
}

function formatQueueDepth(depth: number | null): string {
  return depth === null ? '?' : String(depth);
}

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
    //
    // A rejection here is deliberately *not* escalated to `onTransportLost()`, because
    // "Packet does not exist" does not by itself mean the link is gone. `sendRaw` awaits
    // `processQueue` and only then calls `queue.wait(id)`, so it rejects whenever the queued item
    // left the queue during that await. Two very different conditions do that: a write that
    // outlives the SDK's 60s queue timeout *and then completes or errors*, and `queue.clear()`
    // running during a normal `disconnect()`. A write that stalls permanently produces no
    // rejection at all — it never settles. `elapsed` separates them: at or above 60s means the
    // slow-write path, well under means teardown. `queueDepth` shows whether a backlog
    // (processQueue sleeps 200ms per unsent item) accounts for the delay on its own.
    //
    // Note also that heartbeats are never acknowledged by the device, so even a healthy heartbeat
    // only settles when that same 60s timeout fires. `elapsed` near 60s is normal, not a warning.
    let consecutiveFailures = 0;
    let tornDown = false;
    const heartbeatTimer = setInterval(() => {
      const startedAt = Date.now();
      const depthBefore = readMeshtasticQueueDepth(device);
      void device.heartbeat().then(
        () => {
          if (consecutiveFailures > 0) {
            console.debug(
              `[meshtasticTransportSideEffects] ${type}: heartbeat recovered after ` +
                `${String(consecutiveFailures)} consecutive failures`,
            );
          }
          consecutiveFailures = 0;
        },
        (e: unknown) => {
          consecutiveFailures += 1;
          const elapsedMs = Date.now() - startedAt;
          const depthAfter = readMeshtasticQueueDepth(device);
          console.debug(
            `[meshtasticTransportSideEffects] ${type}: heartbeat send failed ` +
              errLikeToLogString(e) +
              ` (elapsed=${String(elapsedMs)}ms` +
              ` queueDepth=${formatQueueDepth(depthBefore)}->${formatQueueDepth(depthAfter)}` +
              ` consecutive=${String(consecutiveFailures)}` +
              `${tornDown ? ' teardown' : ''})`,
          );
        },
      );
    }, MESHTASTIC_HEARTBEAT_INTERVAL_MS);
    push(() => {
      tornDown = true;
      clearInterval(heartbeatTimer);
    });
  }
}
