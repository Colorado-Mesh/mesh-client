import { meshcoreBleMacToMeshtasticNodeId } from './meshcoreBleMacMeshtasticNodeId';

/** BLE MAC of the live MeshCore RF link (null when not BLE-connected or id is not a MAC). */
let connectedMeshcoreBleMac: string | null = null;

/**
 * Called from MeshCore runtime when a BLE session connects or disconnects.
 * Only stores ids that parse as a 12-hex BLE MAC (Noble peripheral id). Linux
 * Web Bluetooth device ids are opaque UUIDs — storing them would never match a
 * Meshtastic nodeNum, so we clear instead of pretending they are MACs.
 */
export function setConnectedMeshcoreBleMac(mac: string | null): void {
  const trimmed = mac?.trim() ?? '';
  if (trimmed.length === 0) {
    connectedMeshcoreBleMac = null;
    return;
  }
  if (meshcoreBleMacToMeshtasticNodeId(trimmed) == null) {
    connectedMeshcoreBleMac = null;
    return;
  }
  connectedMeshcoreBleMac = trimmed;
}

export function getConnectedMeshcoreBleMac(): string | null {
  return connectedMeshcoreBleMac;
}

/**
 * Prefer an explicit Noble peripheral id, then a live Web Bluetooth device id,
 * then a remembered last-BLE id (Linux chooser may omit blePeripheralId on connect).
 * Used for reconnect identity — may return opaque Web BT UUIDs on Linux.
 */
export function resolveConnectedMeshcoreBleIdentity(opts: {
  blePeripheralId?: string | null;
  webBluetoothDeviceId?: string | null;
  fallbackLastBlePeripheralId?: string | null;
}): string | null {
  for (const candidate of [
    opts.blePeripheralId,
    opts.webBluetoothDeviceId,
    opts.fallbackLastBlePeripheralId,
  ]) {
    const trimmed = candidate?.trim() ?? '';
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * First candidate that parses as a BLE MAC for Meshtastic ghost suppression.
 * Skips opaque Linux Web Bluetooth device ids.
 */
export function resolveConnectedMeshcoreBleMacForSuppression(opts: {
  blePeripheralId?: string | null;
  webBluetoothDeviceId?: string | null;
  fallbackLastBlePeripheralId?: string | null;
}): string | null {
  for (const candidate of [
    opts.blePeripheralId,
    opts.webBluetoothDeviceId,
    opts.fallbackLastBlePeripheralId,
  ]) {
    const trimmed = candidate?.trim() ?? '';
    if (trimmed.length === 0) continue;
    if (meshcoreBleMacToMeshtasticNodeId(trimmed) != null) return trimmed;
  }
  return null;
}

/** Duck-typed read of MeshcoreWebBluetoothConnection.getWebBluetoothDeviceId(). */
export function readMeshcoreWebBluetoothDeviceId(conn: unknown): string | null {
  if (!conn || typeof conn !== 'object') return null;
  const getter = (conn as { getWebBluetoothDeviceId?: unknown }).getWebBluetoothDeviceId;
  if (typeof getter !== 'function') return null;
  try {
    const id = (getter as (this: unknown) => unknown).call(conn);
    return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
  } catch {
    // catch-no-log-ok optional Web Bluetooth accessor on non-Web-BT connections
    return null;
  }
}

/** Test helper — reset module state between cases. */
export function resetConnectedMeshcoreBleMacForTests(): void {
  connectedMeshcoreBleMac = null;
}
