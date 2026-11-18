import type { MeshDevice } from '@meshtastic/core';

import { safeDisconnect } from '../connection';
import { errLikeToLogString } from '../errLikeToLogString';
import { TransportSidecarGatt } from '../transportSidecarGatt';

/** Thrown by `attachRfSession` when a newer connect bumped reconnect generation mid-configure. */
export const MESHTASTIC_ATTACH_SUPERSEDED_MESSAGE = 'Attach superseded during configure';

/**
 * True when a Meshtastic connect/attach was abandoned because a newer session already owns the
 * link. Must not run full `handleRfConnectFailure` teardown — that would kill the live session.
 */
export function isMeshtasticAttachSupersededError(err: unknown): boolean {
  return errLikeToLogString(err).includes(MESHTASTIC_ATTACH_SUPERSEDED_MESSAGE);
}

export type SupersededStaleCleanupMode =
  'noop-current-owner' | 'soft-retire-shared-gatt' | 'safe-disconnect';

/**
 * How to retire a superseded attempt's opened device without harming a newer live session.
 * Shared Meshtastic BLE uses one GATT session id — `safeDisconnect` would call disconnectGatt
 * and drop the owner (including during the gap when prepare cleared deviceRef but open is
 * still in flight).
 */
export function supersededStaleDeviceCleanupMode(
  currentDevice: MeshDevice | null,
  staleDevice: MeshDevice,
): SupersededStaleCleanupMode {
  if (currentDevice === staleDevice) return 'noop-current-owner';
  if (staleDevice.transport instanceof TransportSidecarGatt) {
    return 'soft-retire-shared-gatt';
  }
  return 'safe-disconnect';
}

/** Retire SDK listeners without session-level GATT disconnect. */
async function softRetireMeshtasticDeviceWithoutGattDisconnect(device: MeshDevice): Promise<void> {
  try {
    device.complete();
  } catch (e) {
    console.debug('[meshtasticAttachSuperseded] soft-retire complete ' + errLikeToLogString(e));
  }
  const transport = device.transport;
  if (!(transport instanceof TransportSidecarGatt)) return;
  try {
    await transport.toDevice.close();
  } catch (e) {
    console.debug(
      '[meshtasticAttachSuperseded] soft-retire toDevice.close ' + errLikeToLogString(e),
    );
  }
}

/** Clean up a superseded attempt's device; never GATT-disconnect while a newer owner is live. */
export async function cleanupSupersededStaleOpenedDevice(
  currentDevice: MeshDevice | null,
  staleDevice: MeshDevice,
): Promise<void> {
  const mode = supersededStaleDeviceCleanupMode(currentDevice, staleDevice);
  if (mode === 'noop-current-owner') return;
  if (mode === 'soft-retire-shared-gatt') {
    await softRetireMeshtasticDeviceWithoutGattDisconnect(staleDevice);
    return;
  }
  await safeDisconnect(staleDevice);
}
