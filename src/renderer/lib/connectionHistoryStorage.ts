import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { setRendererStorageItem } from '@/renderer/lib/rendererStorage';
import { parseConnectHostPort } from '@/shared/connectHost';
import {
  MESHCOM_EXTUDP_PORT,
  MESHCOM_KISS_TCP_PORT,
  MESHCOM_NETCONSOLE_PORT,
} from '@/shared/meshcomConstants';

import {
  clearLastConnection,
  isMeshcomMeshtasticOnlyTcpLastConnection,
  type LastConnection,
  loadLastConnection,
  saveLastConnection,
} from './lastConnectionStorage';
import { parseStoredJson } from './parseStoredJson';
import type { ConnectionType, MeshProtocol } from './types';

export interface UpsertConnectionHistoryOptions {
  /** Update this saved row in place (e.g. BLE MAC-only → discovered UUID). */
  replaceEntryId?: string;
}

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
function defaultPortForConnectionHistory(type: ConnectionType, protocol?: MeshProtocol): number {
  if (type === 'tcp') return MESHTASTIC_NATIVE_TCP_PORT;
  if (type === 'udp') return MESHCOM_EXTUDP_PORT;
  if (type === 'netconsole') return MESHCOM_NETCONSOLE_PORT;
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
    // Preserve path case (Linux/macOS paths are case-sensitive); still trim for dedup.
    const id = (conn.serialPortId ?? '').trim();
    return id ? `serial:${id}` : null;
  }
  // Remaining: http | tcp | udp | netconsole
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

/** Identity keys that should collapse into one history row (MeshCom KISS tcp↔http). */
function connectionHistoryAliasKeys(conn: LastConnection, protocol: MeshProtocol): Set<string> {
  const keys = new Set<string>();
  const primary = connectionHistoryIdentityKey(conn, protocol);
  if (primary) keys.add(primary);
  if (
    protocol === 'meshcom' &&
    (conn.type === 'http' || conn.type === 'tcp') &&
    !isMeshcomMeshtasticOnlyTcpLastConnection(conn)
  ) {
    const addr = (conn.httpAddress ?? '').trim();
    if (addr) {
      const { host, port } = parseConnectHostPort(addr, MESHCOM_KISS_TCP_PORT);
      const normalizedHost = host.trim().toLowerCase();
      if (normalizedHost) {
        keys.add(`http:${normalizedHost}:${port}`);
        keys.add(`tcp:${normalizedHost}:${port}`);
      }
    }
  }
  return keys;
}

function bleHistoryEntriesConflict(a: LastConnection, b: LastConnection): boolean {
  if (a.type !== 'ble' || b.type !== 'ble') return false;
  const aId = (a.bleDeviceId ?? '').trim().toLowerCase();
  const bId = (b.bleDeviceId ?? '').trim().toLowerCase();
  const aMac = (a.bleMac ?? '').trim().toLowerCase();
  const bMac = (b.bleMac ?? '').trim().toLowerCase();
  if (aId && bId && aId === bId) return true;
  if (aMac && bMac && aMac === bMac) return true;
  if (aId && bMac && aId === bMac) return true;
  if (bId && aMac && bId === aMac) return true;
  return false;
}

function isConnectionType(v: unknown): v is ConnectionType {
  return (
    v === 'ble' ||
    v === 'serial' ||
    v === 'http' ||
    v === 'tcp' ||
    v === 'udp' ||
    v === 'netconsole'
  );
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

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function isStoredSavedConnection(v: unknown): v is SavedConnection {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  if (typeof c.id !== 'string' || c.id.length === 0) return false;
  if (typeof c.lastUsedAt !== 'number' || !Number.isFinite(c.lastUsedAt)) return false;
  if (!isConnectionType(c.type)) return false;
  const optionalStrings = [
    'httpAddress',
    'bleDeviceId',
    'bleDeviceName',
    'bleMac',
    'serialPortId',
  ] as const;
  if (!optionalStrings.every((key) => isOptionalString(c[key]))) return false;
  if (!isOptionalNumber(c.bleRssi)) return false;
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
 * Load history for a LoRa protocol. Seeds from lastConnection when the history key
 * has never been written, or when the stored list is empty but an MRU still exists
 * (upgrade / filtered-invalid rows). Deleting the last saved device clears the MRU,
 * so a deliberate empty list stays empty.
 * On storage read failure, returns [] without seeding or overwriting.
 */
export function loadConnectionHistory(protocol: MeshProtocol): SavedConnection[] {
  if (!isConnectionHistoryProtocol(protocol)) return [];
  const existing = readRawHistory(protocol);
  if (existing.status === 'error') return [];
  if (existing.status === 'missing') return seedFromLastConnection(protocol);
  if (existing.entries.length > 0) return existing.entries;
  const last = loadLastConnection(protocol);
  if (last && isValidLastConnectionForHistory(last)) {
    return seedFromLastConnection(protocol);
  }
  return [];
}

/**
 * Upsert by transport identity, move to front, trim to max, and sync lastConnection MRU.
 * @returns the next list, or `null` when history cannot be read / MRU sync fails
 *   (caller should keep the prior visible list).
 */
export function upsertConnectionHistory(
  protocol: MeshProtocol,
  connection: LastConnection,
  nowMs: number = Date.now(),
  id: string = crypto.randomUUID(),
  options?: UpsertConnectionHistoryOptions,
): SavedConnection[] | null {
  if (!isConnectionHistoryProtocol(protocol)) return [];
  const identity = connectionHistoryIdentityKey(connection, protocol);
  if (!identity) return loadConnectionHistory(protocol);

  const read = readRawHistory(protocol);
  if (read.status === 'error') return null;
  const prev = read.status === 'missing' ? seedFromLastConnection(protocol) : read.entries;

  const fields = pickLastConnectionFields(connection);
  let replaceEntryId = options?.replaceEntryId;
  if (replaceEntryId) {
    const replaceTarget = prev.find((entry) => entry.id === replaceEntryId);
    const replaceKey = replaceTarget ? connectionHistoryIdentityKey(replaceTarget, protocol) : null;
    const crossTypeBleEnrich = replaceTarget?.type === 'ble' && connection.type === 'ble';
    if (replaceKey && replaceKey !== identity && !crossTypeBleEnrich) {
      replaceEntryId = undefined;
    }
  }
  const aliasKeys = connectionHistoryAliasKeys(connection, protocol);
  const existing =
    (replaceEntryId ? prev.find((entry) => entry.id === replaceEntryId) : undefined) ??
    prev.find((entry) => connectionHistoryIdentityKey(entry, protocol) === identity) ??
    prev.find((entry) => {
      const entryKey = connectionHistoryIdentityKey(entry, protocol);
      return entryKey != null && aliasKeys.has(entryKey);
    });
  const nextEntry: SavedConnection = {
    ...fields,
    id: existing?.id ?? id,
    lastUsedAt: nowMs,
  };
  const rest = prev.filter((entry) => {
    if (replaceEntryId && entry.id === replaceEntryId) return false;
    if (entry.id === nextEntry.id) return false;
    const entryKey = connectionHistoryIdentityKey(entry, protocol);
    if (entryKey && aliasKeys.has(entryKey)) return false;
    if (bleHistoryEntriesConflict(entry, connection)) return false;
    return true;
  });
  const next = [nextEntry, ...rest].slice(0, CONNECTION_HISTORY_MAX);
  if (!persistHistory(protocol, next)) return prev;
  if (!saveLastConnection(protocol, fields)) {
    // Roll back history so callers do not treat a partial write as success.
    persistHistory(protocol, prev);
    return null;
  }
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
  const read = readRawHistory(protocol);
  // Failed read must not wipe the list by persisting [].
  if (read.status === 'error') return null;
  const prev = read.status === 'ok' ? read.entries : [];
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
      if (!clearLastConnection(protocol)) {
        persistHistory(protocol, prev);
        return null;
      }
    } else if (!saveLastConnection(protocol, pickLastConnectionFields(promoted))) {
      persistHistory(protocol, prev);
      return null;
    }
  }
  return next;
}

/** Clear the entire history list and the lastConnection MRU for the protocol. */
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
