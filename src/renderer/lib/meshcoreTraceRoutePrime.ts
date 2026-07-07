import {
  computeMeshcoreTracePrimeAggregateTimeoutMs,
  computeMeshcoreTracePrimeWaitMs,
  MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
  MESHCORE_TRACE_PRIME_MAX_ROUNDS,
  meshcoreContactRawFromDevice,
  waitForMeshcorePath129ForNode,
} from '@/renderer/hooks/meshcore/meshcoreHookPreamble';
import { withTimeout } from '@/shared/withTimeout';

import { errLikeToLogString } from './errLikeToLogString';
import type { MeshCoreContactRaw } from './meshcore/meshcoreHookTypes';
import {
  type MeshcoreRadioContactPathSnapshot,
  meshcoreSnapshotContactPathFromContacts,
} from './meshcoreRadioContactPath';
import { meshcoreIsUsableTraceStoredPath } from './meshcoreRepeaterTracePath';

export interface MeshcoreTraceRoutePrimeConn {
  getContacts(): Promise<MeshCoreContactRaw[]>;
  sendFloodAdvert(): Promise<void>;
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
}

export interface MeshcoreTraceRoutePrimeResult {
  path: Uint8Array | undefined;
  radioContactPathLen: number | null;
}

function isUsablePrimedPath(
  path: Uint8Array | undefined,
  hopsAway: number | null | undefined,
  pubKey: Uint8Array,
): boolean {
  return path != null && path.length > 1 && meshcoreIsUsableTraceStoredPath(path, hopsAway, pubKey);
}

async function refreshPathAfterPrimeRound(
  conn: MeshcoreTraceRoutePrimeConn,
  nodeId: number,
  existingPath: Uint8Array | undefined,
  outPathMapRef: Map<number, Uint8Array>,
): Promise<MeshcoreRadioContactPathSnapshot> {
  try {
    const contactsRaw = await conn.getContacts();
    const contacts = contactsRaw.map(meshcoreContactRawFromDevice);
    const snap = meshcoreSnapshotContactPathFromContacts(nodeId, contacts, existingPath);
    if (snap.path && snap.path.length > 0) {
      outPathMapRef.set(nodeId, snap.path);
    }
    return snap;
  } catch (e: unknown) {
    console.warn(
      '[meshcoreTraceRoutePrime] post-prime getContacts failed ' + errLikeToLogString(e),
    );
    const fromMap = outPathMapRef.get(nodeId);
    return {
      path: fromMap ?? existingPath,
      radioContactPathLen: null,
      radioContactFound: fromMap != null,
    };
  }
}

async function primeMeshcoreTraceRouteInner(opts: {
  conn: MeshcoreTraceRoutePrimeConn;
  nodeId: number;
  pubKey: Uint8Array;
  hopsAway?: number | null;
  outPathMapRef: Map<number, Uint8Array>;
  existingPath?: Uint8Array;
  maxRounds?: number;
}): Promise<MeshcoreTraceRoutePrimeResult> {
  const maxRounds = opts.maxRounds ?? MESHCORE_TRACE_PRIME_MAX_ROUNDS;
  const waitMs = computeMeshcoreTracePrimeWaitMs(opts.hopsAway);
  let routeStoredPath = opts.existingPath;
  let radioContactPathLen: number | null = null;

  for (let round = 0; round < maxRounds; round++) {
    const path129Wait = waitForMeshcorePath129ForNode(opts.conn, opts.nodeId, waitMs);
    try {
      await withTimeout(
        opts.conn.sendFloodAdvert(),
        MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
        'meshcoreTraceRoutePrimeFloodAdvert',
      );
    } catch (e: unknown) {
      console.warn('[meshcoreTraceRoutePrime] sendFloodAdvert failed ' + errLikeToLogString(e));
    }
    await path129Wait;

    const snap = await refreshPathAfterPrimeRound(
      opts.conn,
      opts.nodeId,
      routeStoredPath,
      opts.outPathMapRef,
    );
    if (snap.radioContactPathLen != null) {
      radioContactPathLen = snap.radioContactPathLen;
    }
    if (snap.path && snap.path.length > 0) {
      routeStoredPath = snap.path;
    }

    const fromMap = opts.outPathMapRef.get(opts.nodeId);
    if (
      fromMap &&
      fromMap.length > 0 &&
      (!routeStoredPath || fromMap.length > routeStoredPath.length)
    ) {
      routeStoredPath = fromMap;
    }

    if (isUsablePrimedPath(routeStoredPath, opts.hopsAway, opts.pubKey)) {
      break;
    }
  }

  return { path: routeStoredPath, radioContactPathLen };
}

/**
 * Flood-advert route priming for multi-hop trace/ping.
 *
 * Failure point: PathUpdated never arrives — caller may fast-fail or proceed with short path.
 * Fallback: path history in caller; room login may run active trace after this helper.
 */
export async function primeMeshcoreTraceRoute(opts: {
  conn: MeshcoreTraceRoutePrimeConn;
  nodeId: number;
  pubKey: Uint8Array;
  hopsAway?: number | null;
  outPathMapRef: Map<number, Uint8Array>;
  existingPath?: Uint8Array;
  maxRounds?: number;
}): Promise<MeshcoreTraceRoutePrimeResult> {
  const maxRounds = opts.maxRounds ?? MESHCORE_TRACE_PRIME_MAX_ROUNDS;
  const aggregateMs = computeMeshcoreTracePrimeAggregateTimeoutMs(opts.hopsAway, maxRounds);
  try {
    return await withTimeout(
      primeMeshcoreTraceRouteInner(opts),
      aggregateMs,
      'meshcoreTraceRoutePrimeAggregate',
    );
  } catch (e: unknown) {
    console.warn('[meshcoreTraceRoutePrime] aggregate timeout ' + errLikeToLogString(e));
    const fromMap = opts.outPathMapRef.get(opts.nodeId);
    return {
      path: fromMap ?? opts.existingPath,
      radioContactPathLen: null,
    };
  }
}
