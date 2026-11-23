import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { removeRendererStorageItem, setRendererStorageItem } from '@/renderer/lib/rendererStorage';
import { parseConnectHostPort } from '@/shared/connectHost';
import { MESHCOM_EXTUDP_PORT, MESHCOM_KISS_TCP_PORT } from '@/shared/meshcomConstants';

import {
  clearLastConnection,
  type LastConnection,
  loadLastConnection,
  saveLastConnection,
} from './lastConnectionStorage';
import { parseStoredJson } from './parseStoredJson';
import type { ConnectionType, MeshProtocol } from './types';

/** LoRa protocols that show Device → Connection radio history (not Reticulum Interfaces). */
export type ConnectionHistoryProtocol = 'meshtastic' | 'meshcore' | 'meshcom';

export const CONNECTION_HISTORY_MAX = 20;

/** Meshtastic native TCP streaming port. */
const MESHTASTIC_NATIVE_TCP_PORT = 4403;
/** MeshCore companion TCP default (UI stores as `http`). */
const MESHCORE_COMPANION_TCP_PORT = 5000;
/** Meshtastic HTTP default when the address omits a port. */
const MESHTASTIC_HTTP_DEFAULT_PORT = 80;

export interface SavedConnection extends LastConnection {
  id: string;
  lastUsedAt: number;
}

type HistoryReadResult =
  { status: 'missing' } | { status: 'ok'; entries: SavedConnection[] } | { status: 'error' };

export function connectionHistoryStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:connectionHistory:${protocol}`;
}

export function isConnectionHistoryProtocol(
  protocol: MeshProtocol,
): protocol is ConnectionHistoryProtocol {
  return protocol === 'meshtastic' || protocol === 'meshcore' || protocol === 'meshcom';
}

/** Default port matching connection dispatch when the stored address omits one. */
export function defaultPortForConnectionHistory(
  type: ConnectionType,
  protocol?: MeshProtocol,
): number {
  if (type === 'tcp') return MESHTASTIC_NATIVE_TCP_PORT;
  if (type === 'udp') return MESHCOM_EXTUDP_PORT;
  if (type === 'http') {
    if (protocol === 'meshcore') return MESHCORE_COMPANION_TCP_PORT;
    if (protocol === 'meshcom') return MESHCOM_KISS_TCP_PORT;
    return MESHTASTIC_HTTP_DEFAULT_PORT;
  }
  return 0;
}

/** Stable dedup key; null when the record lacks enough identity to store. */
export function connectionHistoryIdentityKey(
  conn: LastConnection,
  protocol?: MeshProtocol,
): string | null {
  if (conn.type === 'ble') {
    const id = (conn.bleDeviceId ?? conn.bleMac ?? '').trim().toLowerCase();
    return id ? `ble:${id}` : null;
  }
  if (conn.type === 'serial') {
    const id = (conn.serialPortId ?? '').trim().toLowerCase();
    return id ? `serial:${id}` : null;
  }
  // Remaining: http | tcp | udp
  const addr = (conn.httpAddress ?? '').trim();
  if (!addr) return null;
  const { host, port } = parseConnectHostPort(
    addr,
    defaultPortForConnectionHistory(conn.type, protocol),
  );
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) return null;
  return `${conn.type}:${normalizedHost}:${port}`;
}

function isConnectionType(v: unknown): v is ConnectionType {
  return v === 'ble' || v === 'serial' || v === 'http' || v === 'tcp' || v === 'udp';
}

/** True when a legacy lastConnection has typed fields safe for identity-key derivation. */
export function isValidLastConnectionForHistory(last: LastConnection): boolean {
  if (!isConnectionType(last.type)) return false;
  if (last.httpAddress !== undefined && typeof last.httpAddress !== 'string') return false;
  if (last.bleDeviceId !== undefined && typeof last.bleDeviceId !== 'string') return false;
  if (last.bleDeviceName !== undefined && typeof last.bleDeviceName !== 'string') return false;
  if (last.bleMac !== undefined && typeof last.bleMac !== 'string') return false;
  if (last.bleRssi !== undefined && typeof last.bleRssi !== 'number') return false;
  if (last.serialPortId !== undefined && typeof last.serialPortId !== 'string') return false;
  return connectionHistoryIdentityKey(last) != null;
}

function isStoredSavedConnection(v: unknown): v is SavedConnection {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  if (typeof c.id !== 'string' || c.id.length === 0) return false;
  if (typeof c.lastUsedAt !== 'number' || !Number.isFinite(c.lastUsedAt)) return false;
  if (!isConnectionType(c.type)) return false;
  if (c.httpAddress !== undefined && typeof c.httpAddress !== 'string') return false;
  if (c.bleDeviceId !== undefined && typeof c.bleDeviceId !== 'string') return false;
  if (c.bleDeviceName !== undefined && typeof c.bleDeviceName !== 'string') return false;
  if (c.bleMac !== undefined && typeof c.bleMac !== 'string') return false;
  if (c.bleRssi !== undefined && typeof c.bleRssi !== 'number') return false;
  if (c.serialPortId !== undefined && typeof c.serialPortId !== 'string') return false;
  return connectionHistoryIdentityKey(c as unknown as LastConnection) != null;
}

function pickLastConnectionFields(conn: LastConnection): LastConnection {
  const next: LastConnection = { type: conn.type };
  if (conn.httpAddress !== undefined) next.httpAddress = conn.httpAddress;
  if (conn.bleDeviceId !== undefined) next.bleDeviceId = conn.bleDeviceId;
  if (conn.bleDeviceName !== undefined) next.bleDeviceName = conn.bleDeviceName;
  if (conn.bleMac !== undefined) next.bleMac = conn.bleMac;
  if (conn.bleRssi !== undefined) next.bleRssi = conn.bleRssi;
  if (conn.serialPortId !== undefined) next.serialPortId = conn.serialPortId;
  return next;
}

/** @returns false when the write threw. */
function persistHistory(protocol: ConnectionHistoryProtocol, history: SavedConnection[]): boolean {
  try {
    setRendererStorageItem(
      connectionHistoryStorageKey(protocol),
      JSON.stringify(history.slice(0, CONNECTION_HISTORY_MAX)),
    );
    return true;
  } catch (e: unknown) {
    console.warn(
      'mcL1496 [connectionHistoryStorage] persistHistory failed ' + errLikeToLogString(e),
    );
    return false;
  }
}

function readRawHistory(protocol: ConnectionHistoryProtocol): HistoryReadResult {
  try {
    const raw = localStorage.getItem(connectionHistoryStorageKey(protocol));
    if (raw == null) return { status: 'missing' };
    const parsed = parseStoredJson<unknown>(raw, 'connectionHistoryStorage load');
    if (!Array.isArray(parsed)) return { status: 'ok', entries: [] };
    return {
      status: 'ok',
      entries: parsed.filter(isStoredSavedConnection).slice(0, CONNECTION_HISTORY_MAX),
    };
  } catch (e: unknown) {
    console.warn('mcL1497 [connectionHistoryStorage] readHistory failed ' + errLikeToLogString(e));
    return { status: 'error' };
  }
}

function seedFromLastConnection(protocol: ConnectionHistoryProtocol): SavedConnection[] {
  const last = loadLastConnection(protocol);
  if (!last || !isValidLastConnectionForHistory(last)) return [];
  const seeded: SavedConnection = {
    ...pickLastConnectionFields(last),
    id: crypto.randomUUID(),
    lastUsedAt: Date.now(),
  };
  if (!persistHistory(protocol, [seeded])) return [];
  return [seeded];
}

/**
 * Load history for a LoRa protocol. Seeds from lastConnection only when the history
 * key has never been written (not when the user cleared the list to []).
 * On storage read failure, returns [] without seeding or overwriting.
 */
export function loadConnectionHistory(protocol: MeshProtocol): SavedConnection[] {
  if (!isConnectionHistoryProtocol(protocol)) return [];
  const existing = readRawHistory(protocol);
  if (existing.status === 'error') return [];
  if (existing.status === 'ok') return existing.entries;
  return seedFromLastConnection(protocol);
}

/**
 * Upsert by transport identity, move to front, trim to max, and sync lastConnection MRU.
 * No-ops when the record has no stable identity or history cannot be read.
 */
export function upsertConnectionHistory(
  protocol: MeshProtocol,
  connection: LastConnection,
  nowMs: number = Date.now(),
  id: string = crypto.randomUUID(),
): SavedConnection[] {
  if (!isConnectionHistoryProtocol(protocol)) return [];
  const identity = connectionHistoryIdentityKey(connection, protocol);
  if (!identity) return loadConnectionHistory(protocol);

  const read = readRawHistory(protocol);
  if (read.status === 'error') return [];
  const prev = read.status === 'missing' ? seedFromLastConnection(protocol) : read.entries;

  const fields = pickLastConnectionFields(connection);
  const existing = prev.find((entry) => connectionHistoryIdentityKey(entry, protocol) === identity);
  const nextEntry: SavedConnection = {
    ...fields,
    id: existing?.id ?? id,
    lastUsedAt: nowMs,
  };
  const rest = prev.filter((entry) => connectionHistoryIdentityKey(entry, protocol) !== identity);
  const next = [nextEntry, ...rest].slice(0, CONNECTION_HISTORY_MAX);
  if (!persistHistory(protocol, next)) return prev;
  saveLastConnection(protocol, fields);
  return next;
}

/**
 * Remove one history entry. If it was the MRU, promote the next entry or clear lastConnection.
 * @returns the next list, or `null` when persistence failed (caller should keep the row visible).
 */
export function deleteConnectionHistory(
  protocol: MeshProtocol,
  id: string,
): SavedConnection[] | null {
  if (!isConnectionHistoryProtocol(protocol)) return [];
  const prev = loadConnectionHistory(protocol);
  const removed = prev.find((entry) => entry.id === id);
  const next = prev.filter((entry) => entry.id !== id);
  if (!persistHistory(protocol, next)) return null;

  if (!removed) return next;

  const mru = loadLastConnection(protocol);
  const removedKey = connectionHistoryIdentityKey(removed, protocol);
  const mruKey = mru ? connectionHistoryIdentityKey(mru, protocol) : null;
  if (removedKey && mruKey && removedKey === mruKey) {
    const promoted = next.at(0);
    if (!promoted) {
      clearLastConnection(protocol);
    } else {
      saveLastConnection(protocol, pickLastConnectionFields(promoted));
    }
  }
  return next;
}

/** Clear the entire history list and the lastConnection MRU for the protocol. */
export function clearConnectionHistory(protocol: MeshProtocol): void {
  if (!isConnectionHistoryProtocol(protocol)) return;
  try {
    removeRendererStorageItem(connectionHistoryStorageKey(protocol));
  } catch (e: unknown) {
    console.debug('[connectionHistoryStorage] clearConnectionHistory ' + errLikeToLogString(e));
  }
  clearLastConnection(protocol);
}

/** Primary label for a saved/last connection row (BLE name, host:port, or serial path). */
export function savedConnectionPrimaryLabel(conn: LastConnection): string | null {
  if (conn.type === 'ble') {
    const name = conn.bleDeviceName?.trim();
    return name || null;
  }
  if (conn.type === 'serial') {
    const port = conn.serialPortId?.trim();
    return port || null;
  }
  const addr = conn.httpAddress?.trim();
  return addr || null;
}
