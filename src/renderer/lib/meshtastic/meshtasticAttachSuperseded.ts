import type { MeshDevice } from '@meshtastic/core';

import { getSerialPortFromMeshTransport, safeDisconnect } from '../connection';
import { errLikeToLogString } from '../errLikeToLogString';
import { TransportHttpIpc } from '../transportHttpIpc';
import { TransportSidecarGatt } from '../transportSidecarGatt';
import { TransportTcpIpc } from '../transportTcpIpc';

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
  'noop-current-owner' | 'soft-retire-shared-transport' | 'safe-disconnect';

interface RetireInboundTransport {
  retireInbound: () => void;
}

function hasRetireInbound(transport: unknown): transport is RetireInboundTransport {
  return (
    typeof transport === 'object' &&
    transport != null &&
    typeof (transport as RetireInboundTransport).retireInbound === 'function'
  );
}

/**
 * True when safeDisconnect on the stale device would tear down a transport the live owner
 * still needs. BLE/TCP/HTTP use one main-process session (IPC has no per-device owner);
 * serial is shared only when both MeshDevices wrap the same SerialPort instance.
 */
function staleDeviceSharesLiveTransport(
  currentDevice: MeshDevice | null,
  staleDevice: MeshDevice,
): boolean {
  const transport = staleDevice.transport;
  if (
    transport instanceof TransportSidecarGatt ||
    transport instanceof TransportTcpIpc ||
    transport instanceof TransportHttpIpc
  ) {
    return true;
  }
  if (!currentDevice) return false;
  const stalePort = getSerialPortFromMeshTransport(staleDevice.transport);
  const livePort = getSerialPortFromMeshTransport(currentDevice.transport);
  return stalePort != null && livePort != null && stalePort === livePort;
}

/**
 * How to retire a superseded attempt's opened device without harming a newer live session.
 */
export function supersededStaleDeviceCleanupMode(
  currentDevice: MeshDevice | null,
  staleDevice: MeshDevice,
): SupersededStaleCleanupMode {
  if (currentDevice === staleDevice) return 'noop-current-owner';
  if (staleDeviceSharesLiveTransport(currentDevice, staleDevice)) {
    return 'soft-retire-shared-transport';
  }
  return 'safe-disconnect';
}

/** Map a configure rejection to superseded vs propagate for the current attach generation. */
export function attachConfigureFailureAction(
  currentGeneration: number,
  attemptGeneration: number,
): 'superseded' | 'propagate' {
  return currentGeneration !== attemptGeneration ? 'superseded' : 'propagate';
}

/**
 * Live owner passed to {@link cleanupSupersededStaleOpenedDevice}.
 * When the attempt is not superseded and deviceRef still points at it, retain noop-current-owner.
 * Superseded attempts always pass `attemptSuperseded: true` so equal refs still soft-retire.
 */
export function resolveSupersededAttemptLiveOwner(
  deviceRef: MeshDevice | null,
  attemptDevice: MeshDevice,
  attemptSuperseded: boolean,
): MeshDevice | null {
  if (!attemptSuperseded && deviceRef === attemptDevice) return deviceRef;
  if (deviceRef != null && deviceRef !== attemptDevice) return deviceRef;
  return null;
}

/**
 * Retire local SDK / inbound listeners without session-level disconnect
 * (GATT / TCP / HTTP IPC, or a SerialPort still owned by the live device).
 */
async function softRetireMeshtasticDeviceWithoutSessionDisconnect(
  device: MeshDevice,
): Promise<void> {
  try {
    device.complete();
  } catch (e) {
    console.debug('[meshtasticAttachSuperseded] soft-retire complete ' + errLikeToLogString(e));
  }

  const transport = device.transport;
  if (hasRetireInbound(transport)) {
    try {
      transport.retireInbound();
    } catch (e) {
      console.debug(
        '[meshtasticAttachSuperseded] soft-retire retireInbound ' + errLikeToLogString(e),
      );
    }
    return;
  }

  // Shared serial (or unknown): cancel inbound decode only — never close the live port.
  const fromDevice = transport.fromDevice as ReadableStream | undefined;
  if (fromDevice && typeof fromDevice.cancel === 'function') {
    try {
      await fromDevice.cancel();
    } catch (e) {
      console.debug(
        '[meshtasticAttachSuperseded] soft-retire fromDevice.cancel ' + errLikeToLogString(e),
      );
    }
  }
}

/** Clean up a superseded attempt's device; never session-disconnect while a newer owner is live. */
export async function cleanupSupersededStaleOpenedDevice(
  currentDevice: MeshDevice | null,
  staleDevice: MeshDevice,
): Promise<void> {
  const mode = supersededStaleDeviceCleanupMode(currentDevice, staleDevice);
  if (mode === 'noop-current-owner') return;
  if (mode === 'soft-retire-shared-transport') {
    await softRetireMeshtasticDeviceWithoutSessionDisconnect(staleDevice);
    return;
  }
  await safeDisconnect(staleDevice);
}
