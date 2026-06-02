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
