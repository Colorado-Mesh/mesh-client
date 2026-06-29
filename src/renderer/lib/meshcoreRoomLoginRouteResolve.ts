import {
  MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
  MESHCORE_TRACE_PRIME_WAIT_MS,
  waitForMeshcorePath129ForNode,
} from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import { withTimeout } from '@/shared/withTimeout';

import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import {
  type MeshcoreTracePathMuxConnection,
  runMeshcoreTracePathMultiplexed,
} from './meshcoreTracePathMultiplex';
import {
  meshcoreSliceContactOutPathForTrace,
  meshcoreTraceResultToOutPathBytes,
  pubkeyToNodeId,
} from './meshcoreUtils';
import {
  MESHCORE_ROOM_LOGIN_ROUTE_RESOLVE_MAX_MS,
  MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
} from './timeConstants';

export interface MeshcoreRoomLoginRouteResolveConn {
  getContacts(): Promise<MeshCoreContactRaw[]>;
  sendFloodAdvert(): Promise<void>;
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  once?(event: string | number, cb: (...args: unknown[]) => void): void;
  sendCommandSendTracePath?(tag: number, auth: number, path: Uint8Array): Promise<void>;
}

function pathFromContacts(contacts: MeshCoreContactRaw[], nodeId: number): Uint8Array | undefined {
  for (const contact of contacts) {
    if (pubkeyToNodeId(contact.publicKey) !== nodeId) continue;
    let slice = meshcoreSliceContactOutPathForTrace(contact.outPath, contact.outPathLen);
    if (slice.length <= 1 && contact.outPathLen === 0) {
      slice = meshcoreSliceContactOutPathForTrace(contact.outPath, undefined);
    }
    if (slice.length > 1) return slice;
    if (slice.length > 0) return slice;
    return undefined;
  }
  return undefined;
}

async function traceRouteForRoomLogin(
  conn: MeshcoreRoomLoginRouteResolveConn,
  pubKey: Uint8Array,
  seedPath: Uint8Array | undefined,
  traceTimeoutMs: number,
  runSerialized: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<Uint8Array | undefined> {
  if (!conn.sendCommandSendTracePath) return undefined;
  let seed = seedPath && seedPath.length > 0 ? seedPath : new Uint8Array([pubKey[0] & 0xff]);
  if (seed.length === 1 && seed[0] === 0 && pubKey[0] !== 0) {
    seed = new Uint8Array([pubKey[0] & 0xff]);
  }
  try {
    const traceCapMs = Math.min(
      MESHCORE_ROOM_LOGIN_ROUTE_RESOLVE_MAX_MS,
      MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
    );
    const result = await withTimeout(
      runMeshcoreTracePathMultiplexed(
        conn as unknown as MeshcoreTracePathMuxConnection,
        seed,
        Math.min(traceTimeoutMs, traceCapMs),
        runSerialized,
      ),
      traceCapMs,
      'meshcoreRoomLoginTrace',
    );
    const bytes = meshcoreTraceResultToOutPathBytes(
      result.pathLenByte,
      result.pathHashes,
      pubKey,
      result.flags,
    );
    return bytes.length > 1 ? bytes : undefined;
  } catch (e: unknown) {
    console.debug(
      '[meshcoreRoomLoginRouteResolve] trace for room login failed ' +
        (e instanceof Error ? e.message : String(e)),
    );
    return undefined;
  }
}

/**
 * Resolve outbound route bytes for multi-hop room login (contacts, flood prime, active trace).
 * Failure point: passive flood wait never yields bytes while UI shows hops from adverts.
 */
export async function resolveMeshcoreRoomLoginRouteBytes(
  conn: MeshcoreRoomLoginRouteResolveConn,
  nodeId: number,
  opts: {
    pubKey: Uint8Array;
    outPathFromMap?: Uint8Array;
    pathFromHistory?: Uint8Array;
    loginHopsAway: number;
    allowPrime?: boolean;
    /** When true, skip flood prime and active trace (background scheduler fast-fail). */
    skipTrace?: boolean;
    traceTimeoutMs?: number;
    runSerialized?: <T>(fn: () => Promise<T>) => Promise<T>;
  },
): Promise<Uint8Array | undefined> {
  if (opts.loginHopsAway <= 0) {
    return opts.outPathFromMap && opts.outPathFromMap.length > 0 ? opts.outPathFromMap : undefined;
  }

  let path = opts.outPathFromMap;
  if (path && path.length > 1) return path;

  if (opts.pathFromHistory && opts.pathFromHistory.length > 1) {
    return opts.pathFromHistory;
  }

  try {
    const contacts = await conn.getContacts();
    const fromRadio = pathFromContacts(contacts, nodeId);
    if (fromRadio && fromRadio.length > 1) return fromRadio;
    if (fromRadio && fromRadio.length > 0) path = fromRadio;
  } catch {
    // catch-no-log-ok getContacts optional during login path resolve
  }

  if (path && path.length > 1) return path;

  if (opts.skipTrace) {
    return path && path.length > 0 ? path : undefined;
  }

  if (opts.allowPrime !== false) {
    try {
      await withTimeout(
        conn.sendFloodAdvert(),
        MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
        'meshcoreRoomLoginRoutePrimeFloodAdvert',
      );
    } catch {
      // catch-no-log-ok flood advert is best-effort before path wait
    }

    await waitForMeshcorePath129ForNode(conn, nodeId, MESHCORE_TRACE_PRIME_WAIT_MS);

    try {
      const contactsPrime = await conn.getContacts();
      const primed = pathFromContacts(contactsPrime, nodeId);
      if (primed && primed.length > 1) return primed;
      if (primed && primed.length > 0) path = primed;
    } catch {
      // catch-no-log-ok post-prime getContacts optional
    }
  }

  if (path && path.length > 1) return path;

  if (opts.runSerialized && opts.traceTimeoutMs != null && opts.traceTimeoutMs > 0) {
    const traced = await traceRouteForRoomLogin(
      conn,
      opts.pubKey,
      path,
      opts.traceTimeoutMs,
      opts.runSerialized,
    );
    if (traced && traced.length > 1) return traced;
  }

  return path && path.length > 0 ? path : undefined;
}
