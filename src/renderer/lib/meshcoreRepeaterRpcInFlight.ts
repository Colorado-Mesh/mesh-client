import { MESHCORE_CLI_PREEMPT_TRACE_REASON } from './meshcoreRepeaterTracePath';
import { meshcoreTraceResponsesInFlightCount } from './meshcoreTracePathMultiplex';

export type MeshcoreRepeaterRpcKind = 'neighbors' | 'telemetry' | 'status' | 'trace' | 'cli';

const inFlightByKey = new Map<string, Promise<unknown>>();

/** Serializes trace sends on the radio; coalesce key disambiguates ping vs room-login. */
let traceQueueTail: Promise<unknown> = Promise.resolve();
/** In-flight trace promises keyed by `trace:nodeId` or `trace:nodeId:coalesceKey`. */
const traceInFlightByKey = new Map<string, Promise<unknown>>();
/** How many trace wrappers are active per node (ping settle waits on count > 0). */
const traceInFlightCountByNode = new Map<number, number>();

/** Chains status/telemetry/neighbors on the same node (firmware handles one admin RPC at a time). */
const adminQueueTailByNode = new Map<number, Promise<unknown>>();

/**
 * While >0, a repeater/room CLI command is awaiting its DM reply via waiting messages.
 * New traces must wait so TraceData deferral cannot starve CLI_DATA delivery.
 */
let cliReplyHoldCount = 0;

const CLI_REPLY_HOLD_POLL_MS = 50;
const CLI_REPLY_HOLD_MAX_WAIT_MS = 120_000;

export function beginMeshcoreCliReplyHold(): void {
  cliReplyHoldCount += 1;
}

export function endMeshcoreCliReplyHold(): void {
  cliReplyHoldCount = Math.max(0, cliReplyHoldCount - 1);
}

export function meshcoreCliReplyHoldActive(): boolean {
  return cliReplyHoldCount > 0;
}

/** Block until no CLI reply hold is active (or timeout). Used before starting a new traceroute. */
export async function awaitMeshcoreCliReplyHoldClear(
  maxWaitMs: number = CLI_REPLY_HOLD_MAX_WAIT_MS,
): Promise<void> {
  const start = Date.now();
  while (cliReplyHoldCount > 0) {
    if (Date.now() - start > maxWaitMs) {
      throw new Error('timeout waiting for CLI reply hold');
    }
    await new Promise((resolve) => setTimeout(resolve, CLI_REPLY_HOLD_POLL_MS));
  }
}

function rpcKey(kind: MeshcoreRepeaterRpcKind, nodeId: number, coalesceKey?: string): string {
  return coalesceKey != null && coalesceKey !== ''
    ? `${kind}:${nodeId}:${coalesceKey}`
    : `${kind}:${nodeId}`;
}

function runMeshcoreTraceRpcOnce<T>(
  nodeId: number,
  fn: () => Promise<T>,
  coalesceKey?: string,
): Promise<T> {
  const key = rpcKey('trace', nodeId, coalesceKey);
  const existing = traceInFlightByKey.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const normalizedId = nodeId >>> 0;
  const queued = traceQueueTail.then(() => {
    // Fail fast while CLI holds the reply path — waiting here deadlocks multi-hop CLI
    // ping-settle (CLI waits for this map entry; this wait waits for CLI hold).
    if (cliReplyHoldCount > 0) {
      return Promise.reject(new Error(MESHCORE_CLI_PREEMPT_TRACE_REASON));
    }
    return fn();
  });
  traceQueueTail = queued.then(
    () => undefined,
    () => undefined,
  );
  traceInFlightCountByNode.set(normalizedId, (traceInFlightCountByNode.get(normalizedId) ?? 0) + 1);
  const tracked: Promise<T> = queued.finally(() => {
    if (traceInFlightByKey.get(key) === tracked) {
      traceInFlightByKey.delete(key);
    }
    const next = (traceInFlightCountByNode.get(normalizedId) ?? 1) - 1;
    if (next <= 0) traceInFlightCountByNode.delete(normalizedId);
    else traceInFlightCountByNode.set(normalizedId, next);
  });
  traceInFlightByKey.set(key, tracked);
  return tracked;
}

function runMeshcoreAdminRpcOnce<T>(
  kind: MeshcoreRepeaterRpcKind,
  nodeId: number,
  fn: () => Promise<T>,
  coalesceKey?: string,
): Promise<T> {
  const key = rpcKey(kind, nodeId, coalesceKey);
  const existing = inFlightByKey.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const tail = adminQueueTailByNode.get(nodeId) ?? Promise.resolve();
  const queued = tail.then(() => fn());
  adminQueueTailByNode.set(
    nodeId,
    queued.then(
      () => undefined,
      () => undefined,
    ),
  );
  const tracked: Promise<T> = queued.finally(() => {
    if (inFlightByKey.get(key) === tracked) {
      inFlightByKey.delete(key);
    }
  });
  inFlightByKey.set(key, tracked);
  return tracked;
}

export interface MeshcoreRepeaterRpcOnceOpts {
  /**
   * Disambiguates in-flight coalesce. Same kind+node+coalesceKey returns the existing promise;
   * different keys still serialize (admin: per-node queue; trace: global queue) so both `fn`s run.
   * Use for neighbors paging so offset 0 and offset N do not share one closed-over fetch.
   * Use `'room-login'` vs default for traces so ping and room-login do not share results.
   */
  coalesceKey?: string;
}

/** Serialize duplicate repeater RPC clicks for the same node — returns the in-flight promise. */
export function runMeshcoreRepeaterRpcOnce<T>(
  kind: MeshcoreRepeaterRpcKind,
  nodeId: number,
  fn: () => Promise<T>,
  opts?: MeshcoreRepeaterRpcOnceOpts,
): Promise<T> {
  if (kind === 'trace') {
    return runMeshcoreTraceRpcOnce(nodeId, fn, opts?.coalesceKey);
  }
  return runMeshcoreAdminRpcOnce(kind, nodeId, fn, opts?.coalesceKey);
}

/** Test-only reset. */
export function resetMeshcoreRepeaterRpcInFlightForTests(): void {
  inFlightByKey.clear();
  traceInFlightByKey.clear();
  traceInFlightCountByNode.clear();
  adminQueueTailByNode.clear();
  traceQueueTail = Promise.resolve();
  cliReplyHoldCount = 0;
}

/** Test / support-bundle snapshot of repeater RF congestion gates. */
export function getMeshcoreCompanionRepeaterRfBusySnapshot(): {
  repeaterRfBusy: boolean;
  cliReplyHoldCount: number;
  adminRpcInFlightCount: number;
  traceRpcInFlightCount: number;
  traceResponsesInFlightCount: number;
} {
  return {
    repeaterRfBusy: meshcoreCompanionRepeaterRfBusy(),
    cliReplyHoldCount,
    adminRpcInFlightCount: inFlightByKey.size,
    traceRpcInFlightCount: traceInFlightByKey.size,
    traceResponsesInFlightCount: meshcoreTraceResponsesInFlightCount(),
  };
}

/** Reset in-flight admin/trace queues when the radio disconnects. */
export const resetMeshcoreRepeaterRpcInFlightOnDisconnect =
  resetMeshcoreRepeaterRpcInFlightForTests;

/** Repeater pings/traces queued or running (MeshCore allows one trace at a time on the radio). */
export function meshcoreRepeaterTraceInFlightCount(): number {
  return traceInFlightByKey.size;
}

/** True while the per-node ping/trace RPC wrapper is still running (includes direct-retry window). */
export function meshcoreRepeaterTraceActiveForNode(nodeId: number): boolean {
  return (traceInFlightCountByNode.get(nodeId >>> 0) ?? 0) > 0;
}

/**
 * True while repeater admin/trace work holds the shared companion RF path.
 * Background room sync/auto-login should defer to avoid false login failures.
 */
export function meshcoreCompanionRepeaterRfBusy(): boolean {
  return (
    cliReplyHoldCount > 0 ||
    inFlightByKey.size > 0 ||
    traceInFlightByKey.size > 0 ||
    meshcoreTraceResponsesInFlightCount() > 0
  );
}
