import { withTimeout } from '@/shared/withTimeout';

import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import { meshcoreSnapshotContactPathFromContacts } from './meshcoreRadioContactPath';
import {
  type MeshcoreTracePathConnection,
  runMeshcoreTracePathMultiplexed,
} from './meshcoreTracePathMultiplex';
import { primeMeshcoreTraceRoute } from './meshcoreTraceRoutePrime';
import { meshcoreTraceResultToOutPathBytes } from './meshcoreUtils';
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
        conn as unknown as MeshcoreTracePathConnection,
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
    const fromRadio = meshcoreSnapshotContactPathFromContacts(nodeId, contacts).path;
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
    const outPathMapRef = new Map<number, Uint8Array>();
    if (path) outPathMapRef.set(nodeId, path);
    const primed = await primeMeshcoreTraceRoute({
      conn,
      nodeId,
      pubKey: opts.pubKey,
      hopsAway: opts.loginHopsAway,
      outPathMapRef,
      existingPath: path,
    });
    if (primed.path && primed.path.length > 1) return primed.path;
    if (primed.path && primed.path.length > 0) path = primed.path;
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
