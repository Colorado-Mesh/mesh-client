import { removeRendererStorageItem, setRendererStorageItem } from '@/renderer/lib/rendererStorage';
import { parseConnectHostPort } from '@/shared/connectHost';
import { isTwelveHexBleMac, normalizeBleMac } from '@/shared/normalizeBleMac';

import { parseStoredJson } from './parseStoredJson';
import { peekLastSerialClaimPort } from './serialPortClaim';
import { LAST_SERIAL_PORT_KEY } from './serialPortSignature';
import type { ConnectionType, MeshProtocol } from './types';

/** Meshtastic native TCP streaming port — never a MeshCom KISS endpoint. */
const MESHTASTIC_NATIVE_TCP_PORT = 4403;

export const BLE_SELECTION_CLEARED_EVENT = 'mesh-client:ble-selection-cleared';

export interface LastConnection {
  type: ConnectionType;
  httpAddress?: string;
  bleDeviceId?: string;
  bleDeviceName?: string;
  /** Formatted BLE MAC when known (macOS UUID deviceId + CoreBluetoothCache address). */
  bleMac?: string;
  /**
   * Last known host↔radio BLE RSSI (dBm) from scan or GATT link meter.
   * CoreBluetooth often has no live RSSI after connect — used to seed the Connection panel meter.
   */
  bleRssi?: number;
  serialPortId?: string;
}

function lastConnectionKey(protocol: MeshProtocol): string {
  return `mesh-client:lastConnection:${protocol}`;
}

function lastBleDeviceKey(protocol: MeshProtocol): string {
  return `mesh-client:lastBleDevice:${protocol}`;
}

export function loadLastConnection(protocol: MeshProtocol): LastConnection | null {
  return parseStoredJson<LastConnection>(
    localStorage.getItem(lastConnectionKey(protocol)),
    'lastConnectionStorage loadLastConnection',
  );
}

/** @returns false when the write threw. */
export function saveLastConnection(protocol: MeshProtocol, connection: LastConnection): boolean {
  try {
    setRendererStorageItem(lastConnectionKey(protocol), JSON.stringify(connection));
    return true;
  } catch (error) {
    console.warn('mcL0857 [lastConnectionStorage] saveLastConnection failed', error);
    return false;
  }
}

/** @returns false when the removal threw. */
export function clearLastConnection(protocol: MeshProtocol): boolean {
  try {
    removeRendererStorageItem(lastConnectionKey(protocol));
    return true;
  } catch (e: unknown) {
    console.debug('[renderer/lib/lastConnectionStorage] catch:', e);
    return false;
  }
}

export function loadLastBleDeviceId(protocol: MeshProtocol): string | null {
  try {
    return localStorage.getItem(lastBleDeviceKey(protocol));
  } catch (e: unknown) {
    console.debug('[renderer/lib/lastConnectionStorage] catch:', e);

    return null;
  }
}

export function clearLastBleDeviceId(protocol: MeshProtocol): void {
  try {
    removeRendererStorageItem(lastBleDeviceKey(protocol));
  } catch (e: unknown) {
    console.debug('[renderer/lib/lastConnectionStorage] catch:', e);
  }
}

export function clearStoredBleSelection(protocol: MeshProtocol): void {
  clearLastConnection(protocol);
  clearLastBleDeviceId(protocol);
}

/** Optional BLE endpoint identity so listeners can remove one history row without using MRU. */
export interface BleSelectionClearedDetail {
  protocol: MeshProtocol;
  bleDeviceId?: string;
  bleMac?: string;
}

export function notifyBleSelectionCleared(
  protocol: MeshProtocol,
  endpoint?: Pick<BleSelectionClearedDetail, 'bleDeviceId' | 'bleMac'>,
): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(
    new CustomEvent<BleSelectionClearedDetail>(BLE_SELECTION_CLEARED_EVENT, {
      detail: { protocol, ...endpoint },
    }),
  );
}

export function resolveLastBlePeripheralId(protocol: MeshProtocol): string | undefined {
  const last = loadLastConnection(protocol);
  const deviceId = last?.bleDeviceId ?? loadLastBleDeviceId(protocol) ?? undefined;
  const mac = last?.bleMac?.trim();
  // Prefer opaque CoreBluetooth/Noble UUID (32+ hex) — btleplug macOS keys off peripheral id.
  if (deviceId) {
    const hexLen = deviceId.replace(/[^0-9a-fA-F]/g, '').length;
    if (hexLen >= 32) return deviceId;
  }
  if (mac && isTwelveHexBleMac(mac)) return normalizeBleMac(mac);
  return deviceId ?? mac ?? undefined;
}

/** Meshtastic HTTP/TCP, MeshCore TCP, or MeshCom KISS/TCP / EXTUDP host. */
export function resolveLastHttpAddress(protocol: MeshProtocol): string | undefined {
  const last = loadLastConnection(protocol);
  if (last?.type !== 'http' && last?.type !== 'tcp' && last?.type !== 'udp') return undefined;
  if (typeof last.httpAddress !== 'string') return undefined;
  const addr = last.httpAddress.trim();
  return addr || undefined;
}

/**
 * MeshCom KISS is stored as `http` (`meshcomConnectionType`). A `tcp` lastConnection on
 * MeshCom is either Meshtastic native-TCP bleed (drop) or a mistyped KISS record (reconnect as http).
 */
export function isMeshcomMeshtasticOnlyTcpLastConnection(
  last: Pick<LastConnection, 'type' | 'httpAddress'>,
): boolean {
  if (last.type !== 'tcp') return false;
  const addr = last.httpAddress?.trim();
  if (!addr) return true;
  const { host, port } = parseConnectHostPort(addr, 0);
  const normalizedHost = host.toLowerCase();
  if (normalizedHost === 'meshtastic.local' || normalizedHost.endsWith('.meshtastic.local')) {
    return true;
  }
  // Explicit :4403 is Meshtastic native TCP; bare hosts keep parse default 0 and stay usable.
  return addr.includes(':') && port === MESHTASTIC_NATIVE_TCP_PORT;
}

/** KISS host for MeshCom reconnect/auto-connect, or null when the record should be dropped. */
export function resolveMeshcomKissReconnectAddress(
  last: Pick<LastConnection, 'type' | 'httpAddress'>,
): string | null {
  if (last.type === 'http' || last.type === 'tcp') {
    if (isMeshcomMeshtasticOnlyTcpLastConnection(last)) return null;
    const addr = last.httpAddress?.trim();
    return addr || null;
  }
  return null;
}

export function resolveLastSerialPortId(protocol: MeshProtocol): string | null {
  try {
    const last = loadLastConnection(protocol);
    if (last?.serialPortId) return last.serialPortId;
    if (protocol === 'meshcom') {
      const claimed = peekLastSerialClaimPort('meshcom');
      const rawId =
        claimed && 'portId' in claimed && typeof claimed.portId === 'string'
          ? claimed.portId
          : null;
      const portId = rawId?.trim();
      return portId || null;
    }
    return localStorage.getItem(LAST_SERIAL_PORT_KEY);
  } catch (e: unknown) {
    console.debug('[renderer/lib/lastConnectionStorage] catch:', e);
    return null;
  }
}

/** MeshCore RF reconnect params derived from persisted last connection. */
export interface MeshcoreRfConnectionParams {
  rfType: 'ble' | 'serial' | 'tcp';
  httpAddress?: string;
  blePeripheralId?: string;
  serialPortId?: string | null;
  serialPort?: null;
}

/** Meshtastic RF reconnect params derived from persisted last connection. */
export interface MeshtasticRfConnectionParams {
  type: ConnectionType;
  httpAddress?: string;
  blePeripheralId?: string;
  lastSerialPortId?: string | null;
  serialPort?: null;
}

export function buildMeshcoreConnectionParamsFromLastConnection(
  last: LastConnection,
): MeshcoreRfConnectionParams | null {
  if (last.type === 'ble') {
    const blePeripheralId = last.bleDeviceId ?? loadLastBleDeviceId('meshcore');
    if (!blePeripheralId) return null;
    return { rfType: 'ble', blePeripheralId, serialPort: null };
  }
  if (last.type === 'serial') {
    return {
      rfType: 'serial',
      serialPortId: last.serialPortId ?? resolveLastSerialPortId('meshcore'),
      serialPort: null,
    };
  }
  if (last.type === 'http') {
    const httpAddress = last.httpAddress?.trim();
    if (!httpAddress) return null;
    return { rfType: 'tcp', httpAddress, serialPort: null };
  }
  // `last.type === 'tcp'` can only be persisted by the Meshtastic tab; MeshCore has no
  // such connection type (it reuses `'http'` for its own TCP mode), so fall through to null.
  return null;
}

export function rehydrateMeshcoreConnectionParamsFromStorage(): MeshcoreRfConnectionParams | null {
  const last = loadLastConnection('meshcore');
  if (!last) return null;
  return buildMeshcoreConnectionParamsFromLastConnection(last);
}

export function buildMeshtasticConnectionParamsFromLastConnection(
  last: LastConnection,
): MeshtasticRfConnectionParams | null {
  if (last.type === 'ble') {
    const blePeripheralId = last.bleDeviceId ?? loadLastBleDeviceId('meshtastic');
    if (!blePeripheralId) return null;
    return { type: 'ble', blePeripheralId, serialPort: null };
  }
  if (last.type === 'serial') {
    return {
      type: 'serial',
      lastSerialPortId: last.serialPortId ?? resolveLastSerialPortId('meshtastic'),
      serialPort: null,
    };
  }
  if (last.type === 'http') {
    const httpAddress = last.httpAddress?.trim();
    if (!httpAddress) return null;
    return { type: 'http', httpAddress, serialPort: null };
  }

  if (last.type === 'tcp') {
    const httpAddress = last.httpAddress?.trim();
    if (!httpAddress) return null;
    return { type: 'tcp', httpAddress, serialPort: null };
  }
  return null;
}

export function rehydrateMeshtasticConnectionParamsFromStorage(): MeshtasticRfConnectionParams | null {
  const last = loadLastConnection('meshtastic');
  if (!last) return null;
  return buildMeshtasticConnectionParamsFromLastConnection(last);
}
