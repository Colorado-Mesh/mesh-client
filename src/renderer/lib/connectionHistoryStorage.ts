import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { removeRendererStorageItem, setRendererStorageItem } from '@/renderer/lib/rendererStorage';
import { parseConnectHostPort } from '@/shared/connectHost';

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

export interface SavedConnection extends LastConnection {
  id: string;
  lastUsedAt: number;
}

export function connectionHistoryStorageKey(protocol: MeshProtocol): string {
  return `mesh-client:connectionHistory:${protocol}`;
}

export function isConnectionHistoryProtocol(
  protocol: MeshProtocol,
): protocol is ConnectionHistoryProtocol {
  return protocol === 'meshtastic' || protocol === 'meshcore' || protocol === 'meshcom';
}

/** Stable dedup key; null when the record lacks enough identity to store. */
export function connectionHistoryIdentityKey(conn: LastConnection): string | null {
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
  const { host, port } = parseConnectHostPort(addr, 0);
  const normalizedHost = host.trim().toLowerCase();
  if (!normalizedHost) return null;
  return `${conn.type}:${normalizedHost}:${port}`;
}

function isConnectionType(v: unknown): v is ConnectionType {
  return v === 'ble' || v === 'serial' || v === 'http' || v === 'tcp' || v === 'udp';
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

function persistHistory(protocol: ConnectionHistoryProtocol, history: SavedConnection[]): void {
  try {
    setRendererStorageItem(
      connectionHistoryStorageKey(protocol),
      JSON.stringify(history.slice(0, CONNECTION_HISTORY_MAX)),
    );
  } catch (e: unknown) {
    console.warn(
      'mcL1496 [connectionHistoryStorage] persistHistory failed ' + errLikeToLogString(e),
    );
  }
}

function readRawHistory(protocol: ConnectionHistoryProtocol): SavedConnection[] | null {
  const raw = localStorage.getItem(connectionHistoryStorageKey(protocol));
  if (raw == null) return null;
  const parsed = parseStoredJson<unknown>(raw, 'connectionHistoryStorage load');
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isStoredSavedConnection).slice(0, CONNECTION_HISTORY_MAX);
}

function seedFromLastConnection(protocol: ConnectionHistoryProtocol): SavedConnection[] {
  const last = loadLastConnection(protocol);
  if (!last || connectionHistoryIdentityKey(last) == null) return [];
  const seeded: SavedConnection = {
    ...pickLastConnectionFields(last),
    id: crypto.randomUUID(),
    lastUsedAt: Date.now(),
  };
  persistHistory(protocol, [seeded]);
  return [seeded];
}

/**
 * Load history for a LoRa protocol. Seeds from lastConnection only when the history
 * key has never been written (not when the user cleared the list to []).
 */
export function loadConnectionHistory(protocol: MeshProtocol): SavedConnection[] {
  if (!isConnectionHistoryProtocol(protocol)) return [];
  const existing = readRawHistory(protocol);
  if (existing != null) return existing;
  return seedFromLastConnection(protocol);
}

/**
 * Upsert by transport identity, move to front, trim to max, and sync lastConnection MRU.
 * No-ops when the record has no stable identity.
 */
export function upsertConnectionHistory(
  protocol: MeshProtocol,
  connection: LastConnection,
  nowMs: number = Date.now(),
  id: string = crypto.randomUUID(),
): SavedConnection[] {
  if (!isConnectionHistoryProtocol(protocol)) return [];
  const identity = connectionHistoryIdentityKey(connection);
  if (!identity) return loadConnectionHistory(protocol);

  const fields = pickLastConnectionFields(connection);
  const prev = loadConnectionHistory(protocol);
  const existing = prev.find((entry) => connectionHistoryIdentityKey(entry) === identity);
  const nextEntry: SavedConnection = {
    ...fields,
    id: existing?.id ?? id,
    lastUsedAt: nowMs,
  };
  const rest = prev.filter((entry) => connectionHistoryIdentityKey(entry) !== identity);
  const next = [nextEntry, ...rest].slice(0, CONNECTION_HISTORY_MAX);
  persistHistory(protocol, next);
  saveLastConnection(protocol, fields);
  return next;
}

/**
 * Remove one history entry. If it was the MRU, promote the next entry or clear lastConnection.
 */
export function deleteConnectionHistory(protocol: MeshProtocol, id: string): SavedConnection[] {
  if (!isConnectionHistoryProtocol(protocol)) return [];
  const prev = loadConnectionHistory(protocol);
  const removed = prev.find((entry) => entry.id === id);
  const next = prev.filter((entry) => entry.id !== id);
  persistHistory(protocol, next);

  if (!removed) return next;

  const mru = loadLastConnection(protocol);
  const removedKey = connectionHistoryIdentityKey(removed);
  const mruKey = mru ? connectionHistoryIdentityKey(mru) : null;
  if (removedKey && mruKey && removedKey === mruKey) {
    if (next.length === 0) {
      clearLastConnection(protocol);
    } else {
      saveLastConnection(protocol, pickLastConnectionFields(next[0]));
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
