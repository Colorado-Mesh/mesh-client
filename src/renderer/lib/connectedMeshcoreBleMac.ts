import { meshcoreBleMacToMeshtasticNodeId } from './meshcoreBleMacMeshtasticNodeId';

/** BLE MAC of the MeshCore RF link used to suppress Meshtastic MAC-derived ghost nodes. */
let connectedMeshcoreBleMac: string | null = null;

/** Survives disconnect / cold start so Meshtastic NodeDB dumps cannot revive Blue before BLE attach. */
export const MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY = 'mesh-client:meshcoreBleMacForSuppression';

function loadPersistedMeshcoreBleMacForSuppression(): string | null {
  try {
    const raw = localStorage.getItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY);
    const trimmed = raw?.trim() ?? '';
    if (!trimmed) return null;
    if (meshcoreBleMacToMeshtasticNodeId(trimmed) == null) return null;
    return trimmed;
  } catch {
    // catch-no-log-ok localStorage unavailable in tests or private mode
    return null;
  }
}

function persistMeshcoreBleMacForSuppression(mac: string | null): void {
  try {
    if (mac) {
      localStorage.setItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY, mac);
    } else {
      localStorage.removeItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY);
    }
  } catch {
    // catch-no-log-ok localStorage unavailable in tests or private mode
  }
}

/**
 * Called from MeshCore runtime when a BLE session connects or the suppress identity changes.
 * Only stores ids that parse as a 12-hex BLE MAC (Noble peripheral id). Linux
 * Web Bluetooth device ids are opaque UUIDs — storing them would never match a
 * Meshtastic nodeNum, so we clear the in-memory value instead of pretending they are MACs
 * (persisted sticky MAC is kept unless {@link clearMeshcoreBleMacSuppression} is used).
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
  persistMeshcoreBleMacForSuppression(trimmed);
}

export function getConnectedMeshcoreBleMac(): string | null {
  return connectedMeshcoreBleMac;
}

/** Clear in-memory + persisted suppress identity (non-BLE transport or Forget). */
export function clearMeshcoreBleMacSuppression(): void {
  connectedMeshcoreBleMac = null;
  persistMeshcoreBleMacForSuppression(null);
}

/**
 * BLE opens/reconnects keep sticky suppress (pre-arm from storage + last peripheral).
 * Non-BLE transports clear suppress entirely.
 */
export function preserveOrClearMeshcoreBleSuppression(
  isBle: boolean,
  fallbackLastBlePeripheralId?: string | null,
): void {
  if (isBle) {
    prearmMeshcoreBleMacSuppressionFromStorage(fallbackLastBlePeripheralId ?? null);
  } else {
    clearMeshcoreBleMacSuppression();
  }
}

/** Resolve + store suppress MAC after a successful MeshCore BLE attach. */
export function commitConnectedMeshcoreBleSuppression(opts: {
  blePeripheralId?: string | null;
  webBluetoothDeviceId?: string | null;
  fallbackLastBlePeripheralId?: string | null;
}): void {
  setConnectedMeshcoreBleMac(resolveConnectedMeshcoreBleMacForSuppression(opts));
}

/**
 * Pre-arm suppress MAC from persistence and/or a last-BLE peripheral id so Meshtastic
 * configure NodeDB dumps cannot bump the MeshCore companion ghost before BLE attach.
 */
export function prearmMeshcoreBleMacSuppressionFromStorage(
  fallbackLastBlePeripheralId?: string | null,
): string | null {
  const mac = resolveConnectedMeshcoreBleMacForSuppression({
    blePeripheralId: loadPersistedMeshcoreBleMacForSuppression(),
    fallbackLastBlePeripheralId: fallbackLastBlePeripheralId ?? null,
  });
  if (mac) {
    setConnectedMeshcoreBleMac(mac);
    return mac;
  }
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
  try {
    localStorage.removeItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY);
  } catch {
    // catch-no-log-ok localStorage unavailable in tests or private mode
  }
}
