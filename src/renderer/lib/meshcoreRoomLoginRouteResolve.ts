import { meshcorePubkeyPathPrefix } from '@/shared/meshcorePathHash';
import { withTimeout } from '@/shared/withTimeout';

import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import { meshcoreSnapshotContactPathFromContacts } from './meshcoreRadioContactPath';
import { runMeshcoreRepeaterRpcOnce } from './meshcoreRepeaterRpcInFlight';
import { meshcoreHashSizeForTraceSeed } from './meshcoreRepeaterTracePath';
import {
  type MeshcoreTracePathConnection,
  startMeshcoreTracePathMultiplexed,
} from './meshcoreTracePathMultiplex';
import {
  meshcoreTracePrimeFloodWhenForRoomLogin,
  primeMeshcoreTraceRouteWithFallback,
} from './meshcoreTraceRoutePrime';
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
  nodeId: number,
  pubKey: Uint8Array,
  seedPath: Uint8Array | undefined,
  radioContactPathLen: number | null,
  traceTimeoutMs: number,
  runSerialized: <T>(fn: () => Promise<T>) => Promise<T>,
): Promise<Uint8Array | undefined> {
  if (!conn.sendCommandSendTracePath) return undefined;
  const hashSize = meshcoreHashSizeForTraceSeed(radioContactPathLen, null);
  let seed =
    seedPath && seedPath.length > 0 ? seedPath : meshcorePubkeyPathPrefix(pubKey, hashSize);
  if (seed.length === hashSize && seed.every((b) => b === 0) && pubKey[0] !== 0) {
    seed = meshcorePubkeyPathPrefix(pubKey, hashSize);
  }
  try {
    const traceCapMs = Math.min(
      MESHCORE_ROOM_LOGIN_ROUTE_RESOLVE_MAX_MS,
      MESHCORE_TRACE_PING_TOTAL_TIMEOUT_MS,
    );
    const result = await runMeshcoreRepeaterRpcOnce('trace', nodeId, async () => {
      const handle = startMeshcoreTracePathMultiplexed(
        conn as unknown as MeshcoreTracePathConnection,
        seed,
        Math.min(traceTimeoutMs, traceCapMs),
        runSerialized,
      );
      try {
        return await withTimeout(handle.promise, traceCapMs, 'meshcoreRoomLoginTrace');
      } catch (e: unknown) {
        handle.cancel(e instanceof Error ? e.message : 'meshcoreRoomLoginTrace cancelled');
        throw e;
      }
    });
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

  let radioContactPathLen: number | null = null;
  try {
    const contacts = await conn.getContacts();
    const snap = meshcoreSnapshotContactPathFromContacts(nodeId, contacts);
    radioContactPathLen = snap.radioContactPathLen;
    const fromRadio = snap.path;
    if (fromRadio && fromRadio.length > 1) return fromRadio;
    if (fromRadio && fromRadio.length > 0) path = fromRadio;
  } catch {
    console.debug('[meshcoreRoomLoginRouteResolve] getContacts failed during path resolve');
  }

  if (path && path.length > 1) return path;

  if (opts.skipTrace) {
    return path && path.length > 0 ? path : undefined;
  }

  if (opts.allowPrime !== false) {
    const outPathMapRef = new Map<number, Uint8Array>();
    if (path) outPathMapRef.set(nodeId, path);
    const primed = await primeMeshcoreTraceRouteWithFallback({
      conn,
      nodeId,
      pubKey: opts.pubKey,
      hopsAway: opts.loginHopsAway,
      outPathMapRef,
      existingPath: path,
      initialStrategy: 'passive',
      floodWhen: meshcoreTracePrimeFloodWhenForRoomLogin,
    });
    if (primed.path && primed.path.length > 1) return primed.path;
    if (primed.path && primed.path.length > 0) path = primed.path;
  }

  if (path && path.length > 1) return path;

  if (opts.runSerialized && opts.traceTimeoutMs != null && opts.traceTimeoutMs > 0) {
    const traced = await traceRouteForRoomLogin(
      conn,
      nodeId,
      opts.pubKey,
      path,
      radioContactPathLen,
      opts.traceTimeoutMs,
      opts.runSerialized,
    );
    if (traced && traced.length > 1) return traced;
  }

  if (opts.loginHopsAway >= 1) {
    return path && path.length > 1 ? path : undefined;
  }
  return path && path.length > 0 ? path : undefined;
}
