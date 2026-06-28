import { parseStoredJson } from './parseStoredJson';
import { LAST_SERIAL_PORT_KEY } from './serialPortSignature';
import type { ConnectionType, MeshProtocol } from './types';

export interface LastConnection {
  type: ConnectionType;
  httpAddress?: string;
  bleDeviceId?: string;
  bleDeviceName?: string;
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

export function loadLastBleDeviceId(protocol: MeshProtocol): string | null {
  try {
    return localStorage.getItem(lastBleDeviceKey(protocol));
  } catch {
    // catch-no-log-ok localStorage unavailable in tests or private mode
    return null;
  }
}

export function resolveLastBlePeripheralId(protocol: MeshProtocol): string | undefined {
  const last = loadLastConnection(protocol);
  return last?.bleDeviceId ?? loadLastBleDeviceId(protocol) ?? undefined;
}

/** Meshtastic HTTP or MeshCore TCP host (stored as `http` connection type). */
export function resolveLastHttpAddress(protocol: MeshProtocol): string | undefined {
  const last = loadLastConnection(protocol);
  const addr = last?.httpAddress?.trim();
  return addr || undefined;
}

export function resolveLastSerialPortId(protocol: MeshProtocol): string | null {
  const last = loadLastConnection(protocol);
  if (last?.serialPortId) return last.serialPortId;
  try {
    return localStorage.getItem(LAST_SERIAL_PORT_KEY);
  } catch {
    // catch-no-log-ok localStorage unavailable in tests or private mode
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
  return null;
}

export function rehydrateMeshtasticConnectionParamsFromStorage(): MeshtasticRfConnectionParams | null {
  const last = loadLastConnection('meshtastic');
  if (!last) return null;
  return buildMeshtasticConnectionParamsFromLastConnection(last);
}
