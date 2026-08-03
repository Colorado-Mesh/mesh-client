/** BLE MAC / peripheral id of the live MeshCore RF link (null when not BLE-connected). */
let connectedMeshcoreBleMac: string | null = null;

/** Called from MeshCore runtime when a BLE session connects or disconnects. */
export function setConnectedMeshcoreBleMac(mac: string | null): void {
  const trimmed = mac?.trim() ?? '';
  connectedMeshcoreBleMac = trimmed.length > 0 ? trimmed : null;
}

export function getConnectedMeshcoreBleMac(): string | null {
  return connectedMeshcoreBleMac;
}

/**
 * Prefer an explicit Noble peripheral id, then a live Web Bluetooth device id,
 * then a remembered last-BLE id (Linux chooser may omit blePeripheralId on connect).
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
