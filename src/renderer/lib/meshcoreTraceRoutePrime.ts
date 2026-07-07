import {
  computeMeshcoreTracePrimeAggregateTimeoutMs,
  computeMeshcoreTracePrimeWaitMs,
  MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
  MESHCORE_TRACE_PRIME_CONTACT_REFRESH_MS,
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
import {
  meshcoreIsUsableTraceStoredPath,
  type MeshcoreTracePrimeStrategy,
} from './meshcoreRepeaterTracePath';

export type { MeshcoreTracePrimeStrategy };

export interface MeshcoreTraceRoutePrimeConn {
  getContacts(): Promise<MeshCoreContactRaw[]>;
  sendFloodAdvert(): Promise<void>;
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
}

export interface MeshcoreTraceRoutePrimeMetrics {
  strategy: MeshcoreTracePrimeStrategy;
  rounds: number;
  path129Received: boolean;
  floodAdvertsSent: number;
  postPathLen: number;
  usableAfterPrime: boolean;
}

export interface MeshcoreTraceRoutePrimeResult {
  path: Uint8Array | undefined;
  radioContactPathLen: number | null;
  metrics?: MeshcoreTraceRoutePrimeMetrics;
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
    const contactsRaw = await withTimeout(
      conn.getContacts(),
      MESHCORE_TRACE_PRIME_CONTACT_REFRESH_MS,
      'meshcoreTracePrimeGetContacts',
    );
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
  strategy?: MeshcoreTracePrimeStrategy;
}): Promise<MeshcoreTraceRoutePrimeResult> {
  const strategy = opts.strategy ?? 'passive';
  if (strategy === 'none') {
    return {
      path: opts.existingPath,
      radioContactPathLen: null,
      metrics: {
        strategy,
        rounds: 0,
        path129Received: false,
        floodAdvertsSent: 0,
        postPathLen: opts.existingPath?.length ?? 0,
        usableAfterPrime: isUsablePrimedPath(opts.existingPath, opts.hopsAway, opts.pubKey),
      },
    };
  }

  const maxRounds = strategy === 'flood' ? (opts.maxRounds ?? MESHCORE_TRACE_PRIME_MAX_ROUNDS) : 1;
  const waitMs = computeMeshcoreTracePrimeWaitMs(opts.hopsAway);
  let routeStoredPath = opts.existingPath;
  let radioContactPathLen: number | null = null;
  let path129Received = false;
  let floodAdvertsSent = 0;
  let roundsRun = 0;

  for (let round = 0; round < maxRounds; round++) {
    roundsRun = round + 1;
    const path129Wait = waitForMeshcorePath129ForNode(opts.conn, opts.nodeId, waitMs);
    if (strategy === 'flood') {
      try {
        await withTimeout(
          opts.conn.sendFloodAdvert(),
          MESHCORE_SEND_FLOOD_ADVERT_TIMEOUT_MS,
          'meshcoreTraceRoutePrimeFloodAdvert',
        );
        floodAdvertsSent += 1;
      } catch (e: unknown) {
        console.warn('[meshcoreTraceRoutePrime] sendFloodAdvert failed ' + errLikeToLogString(e));
      }
    }
    const got129 = await path129Wait;
    if (got129) path129Received = true;

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

    if (strategy === 'passive') {
      break;
    }
  }

  const usableAfterPrime = isUsablePrimedPath(routeStoredPath, opts.hopsAway, opts.pubKey);
  return {
    path: routeStoredPath,
    radioContactPathLen,
    metrics: {
      strategy,
      rounds: roundsRun,
      path129Received,
      floodAdvertsSent,
      postPathLen: routeStoredPath?.length ?? 0,
      usableAfterPrime,
    },
  };
}

/**
 * PathUpdated wait (+ optional flood advert) before trace/ping.
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
  strategy?: MeshcoreTracePrimeStrategy;
}): Promise<MeshcoreTraceRoutePrimeResult> {
  const strategy = opts.strategy ?? 'passive';
  if (strategy === 'none') {
    return primeMeshcoreTraceRouteInner({ ...opts, strategy });
  }
  const maxRounds = strategy === 'flood' ? (opts.maxRounds ?? MESHCORE_TRACE_PRIME_MAX_ROUNDS) : 1;
  const aggregateMs = computeMeshcoreTracePrimeAggregateTimeoutMs(
    opts.hopsAway,
    maxRounds,
    strategy,
  );
  try {
    return await withTimeout(
      primeMeshcoreTraceRouteInner({ ...opts, strategy, maxRounds }),
      aggregateMs,
      'meshcoreTraceRoutePrimeAggregate',
    );
  } catch (e: unknown) {
    // catch-no-log-ok expected when aggregate or getContacts times out during priming
    console.debug('[meshcoreTraceRoutePrime] aggregate timeout ' + errLikeToLogString(e));
    const fromMap = opts.outPathMapRef.get(opts.nodeId);
    return {
      path: fromMap ?? opts.existingPath,
      radioContactPathLen: null,
      metrics: {
        strategy,
        rounds: maxRounds,
        path129Received: false,
        floodAdvertsSent: 0,
        postPathLen: (fromMap ?? opts.existingPath)?.length ?? 0,
        usableAfterPrime: isUsablePrimedPath(
          fromMap ?? opts.existingPath,
          opts.hopsAway,
          opts.pubKey,
        ),
      },
    };
  }
}
