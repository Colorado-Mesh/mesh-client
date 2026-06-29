import { meshcoreUnpackPathLenByte } from '@/shared/meshcorePathHash';
import { withTimeout } from '@/shared/withTimeout';

import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import {
  CONTACT_TYPE_LABELS,
  MESHCORE_COORD_SCALE,
  meshcoreContactTypeFromHwModel,
  meshcoreSliceContactOutPathForTrace,
  pubkeyToNodeId,
} from './meshcoreUtils';
import { MESHCORE_ROOM_LOGIN_PATH_SYNC_TIMEOUT_MS } from './timeConstants';
import type { MeshNode } from './types';

/** Companion connection surface needed to push a route before SendLogin. */
export interface MeshcoreRoomLoginPathSyncConn {
  getContacts(): Promise<MeshCoreContactRaw[]>;
  setContactPath(contact: MeshCoreContactRaw, path: number[]): Promise<void>;
  addOrUpdateContact?(
    publicKey: Uint8Array,
    type: number,
    flags: number,
    outPathLen: number,
    outPath: Uint8Array,
    advName: string,
    lastAdvert: number,
    advLat: number,
    advLon: number,
  ): Promise<void>;
}

function packContactOutPath(path: Uint8Array): Uint8Array {
  const buf = new Uint8Array(64);
  buf.set(path.subarray(0, 64));
  return buf;
}

async function pushRouteToRadioContact(
  conn: MeshcoreRoomLoginPathSyncConn,
  contact: MeshCoreContactRaw,
  pubKey: Uint8Array,
  path: Uint8Array,
  packedPathLen?: number,
): Promise<void> {
  // Runtime evidence: setContactPath can hang 25s+ on BLE; addOrUpdateContact is reliable.
  if (conn.addOrUpdateContact) {
    let outPathLen = packedPathLen;
    if (outPathLen == null && path.length > 0) {
      if (contact.outPathLen != null && contact.outPathLen > 0 && contact.outPathLen <= 0xbf) {
        const unpacked = meshcoreUnpackPathLenByte(contact.outPathLen);
        if (unpacked.hashSizeBytes > 1) {
          outPathLen = contact.outPathLen;
        }
      }
      outPathLen ??= Math.max(0, path.length - 1);
    }
    await conn.addOrUpdateContact(
      pubKey,
      contact.type,
      contact.flags ?? 0,
      outPathLen ?? 0,
      packContactOutPath(path),
      contact.advName ?? '',
      contact.lastAdvert ?? 0,
      contact.advLat ?? 0,
      contact.advLon ?? 0,
    );
    return;
  }
  await conn.setContactPath(contact, Array.from(path));
}

export interface MeshcoreRoomLoginPathSyncResult {
  synced: boolean;
  pathByteLen: number;
  reason: 'direct' | 'no_path' | 'synced' | 'sync_failed';
  error?: string;
}

function findRadioContact(
  contacts: MeshCoreContactRaw[],
  nodeId: number,
): MeshCoreContactRaw | undefined {
  return contacts.find((c) => pubkeyToNodeId(c.publicKey) === nodeId);
}

/** Same trimming rules as hop inference when firmware reports outPathLen 0 but buffer has route bytes. */
function pathBytesFromRadioContact(contact: MeshCoreContactRaw): Uint8Array {
  let path = meshcoreSliceContactOutPathForTrace(contact.outPath, contact.outPathLen);
  if (path.length <= 1 && contact.outPathLen === 0) {
    path = meshcoreSliceContactOutPathForTrace(contact.outPath, undefined);
  }
  return path;
}

function buildContactFromNode(
  pubKey: Uint8Array,
  node: Pick<MeshNode, 'long_name' | 'hw_model' | 'last_heard' | 'latitude' | 'longitude'>,
): MeshCoreContactRaw {
  const type = meshcoreContactTypeFromHwModel(node.hw_model ?? CONTACT_TYPE_LABELS[3]) ?? 3;
  const lat =
    node.latitude != null && Number.isFinite(node.latitude)
      ? Math.round(node.latitude * MESHCORE_COORD_SCALE)
      : 0;
  const lon =
    node.longitude != null && Number.isFinite(node.longitude)
      ? Math.round(node.longitude * MESHCORE_COORD_SCALE)
      : 0;
  return {
    publicKey: pubKey,
    type,
    flags: 0,
    advName: node.long_name ?? '',
    lastAdvert: node.last_heard ?? 0,
    advLat: lat,
    advLon: lon,
  };
}

/**
 * Push a known multi-hop route to the companion contact table before SendLogin.
 * Failure point: radio contact has outPathLen 0 while UI shows hops — login never reaches the room.
 * Fallback: skip sync for direct (0-hop) rooms.
 */
export async function syncMeshcoreRoomContactPathBeforeLogin(
  conn: MeshcoreRoomLoginPathSyncConn,
  nodeId: number,
  pubKey: Uint8Array,
  node:
    | Pick<
        MeshNode,
        'long_name' | 'hw_model' | 'hops_away' | 'latitude' | 'longitude' | 'last_heard'
      >
    | undefined,
  outPathFromMap: Uint8Array | undefined,
  loginHopsAway: number,
  runSerialized?: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<MeshcoreRoomLoginPathSyncResult> {
  const pushWithTimeout = async (
    contact: MeshCoreContactRaw,
    path: Uint8Array,
    label: string,
    packedPathLen?: number,
  ): Promise<void> => {
    const op = () => pushRouteToRadioContact(conn, contact, pubKey, path, packedPathLen);
    if (runSerialized) {
      await withTimeout(runSerialized(op), MESHCORE_ROOM_LOGIN_PATH_SYNC_TIMEOUT_MS, label);
    } else {
      await withTimeout(op(), MESHCORE_ROOM_LOGIN_PATH_SYNC_TIMEOUT_MS, label);
    }
  };
  if (!Number.isFinite(loginHopsAway) || loginHopsAway <= 0) {
    return { synced: false, pathByteLen: 0, reason: 'direct' };
  }

  let path = outPathFromMap && outPathFromMap.length > 0 ? outPathFromMap : new Uint8Array(0);

  if (path.length > 1 && node) {
    const contact = buildContactFromNode(pubKey, node);
    try {
      await pushWithTimeout(contact, path, 'meshcoreRoomLoginPathSyncFast');
      return { synced: true, pathByteLen: path.length, reason: 'synced' };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : String(e);
      console.warn(`[meshcoreRoomLoginPathSync] fast path sync failed ${error}`);
    }
  }

  let contact: MeshCoreContactRaw | undefined;
  try {
    const contacts = await withTimeout(
      conn.getContacts(),
      MESHCORE_ROOM_LOGIN_PATH_SYNC_TIMEOUT_MS,
      'meshcoreRoomLoginPathSyncGetContacts',
    );
    contact = findRadioContact(contacts, nodeId);
    if (path.length === 0 && contact) {
      path = pathBytesFromRadioContact(contact);
    }
  } catch {
    // catch-no-log-ok getContacts timeout/failure — fall back to map/history path below
  }

  if (path.length <= 1 && loginHopsAway > 0) {
    return { synced: false, pathByteLen: path.length, reason: 'no_path' };
  }
  if (path.length === 0) {
    return { synced: false, pathByteLen: 0, reason: 'no_path' };
  }

  if (!contact && node) {
    try {
      const contacts = await withTimeout(
        conn.getContacts(),
        MESHCORE_ROOM_LOGIN_PATH_SYNC_TIMEOUT_MS,
        'meshcoreRoomLoginPathSyncGetContacts2',
      );
      contact = findRadioContact(contacts, nodeId) ?? buildContactFromNode(pubKey, node);
    } catch {
      // catch-no-log-ok second getContacts failed — synthetic contact from node map is enough to push path
      contact = buildContactFromNode(pubKey, node);
    }
  }

  if (!contact) {
    return { synced: false, pathByteLen: path.length, reason: 'no_path' };
  }

  try {
    await pushWithTimeout(contact, path, 'meshcoreRoomLoginPathSyncPush');
    return { synced: true, pathByteLen: path.length, reason: 'synced' };
  } catch (e: unknown) {
    console.warn(
      `[meshcoreRoomLoginPathSync] path push failed ${e instanceof Error ? e.message : String(e)}`,
    );
    const error = e instanceof Error ? e.message : String(e);
    return { synced: false, pathByteLen: path.length, reason: 'sync_failed', error };
  }
}
