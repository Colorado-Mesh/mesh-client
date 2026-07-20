import { meshcoreTraceResponsesInFlightCount } from './meshcoreTracePathMultiplex';

export type MeshcoreRepeaterRpcKind = 'neighbors' | 'telemetry' | 'status' | 'trace' | 'cli';

const inFlightByKey = new Map<string, Promise<unknown>>();

/** Serializes trace sends on the radio; one in-flight promise per node for duplicate clicks. */
let traceQueueTail: Promise<unknown> = Promise.resolve();
const traceInFlightByNode = new Map<number, Promise<unknown>>();

/** Chains status/telemetry/neighbors on the same node (firmware handles one admin RPC at a time). */
const adminQueueTailByNode = new Map<number, Promise<unknown>>();

function rpcKey(kind: MeshcoreRepeaterRpcKind, nodeId: number, coalesceKey?: string): string {
  return coalesceKey != null && coalesceKey !== ''
    ? `${kind}:${nodeId}:${coalesceKey}`
    : `${kind}:${nodeId}`;
}

function runMeshcoreTraceRpcOnce<T>(nodeId: number, fn: () => Promise<T>): Promise<T> {
  const existingForNode = traceInFlightByNode.get(nodeId);
  if (existingForNode) {
    return existingForNode as Promise<T>;
  }

  const queued = traceQueueTail.then(() => fn());
  traceQueueTail = queued.then(
    () => undefined,
    () => undefined,
  );
  const tracked: Promise<T> = queued.finally(() => {
    traceInFlightByNode.delete(nodeId);
  });
  traceInFlightByNode.set(nodeId, tracked);
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
   * different keys still serialize on the per-node admin queue (both `fn`s run).
   * Use for neighbors paging so offset 0 and offset N do not share one closed-over fetch.
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
    return runMeshcoreTraceRpcOnce(nodeId, fn);
  }
  return runMeshcoreAdminRpcOnce(kind, nodeId, fn, opts?.coalesceKey);
}

/** Test-only reset. */
export function resetMeshcoreRepeaterRpcInFlightForTests(): void {
  inFlightByKey.clear();
  traceInFlightByNode.clear();
  adminQueueTailByNode.clear();
  traceQueueTail = Promise.resolve();
}

/** Reset in-flight admin/trace queues when the radio disconnects. */
export const resetMeshcoreRepeaterRpcInFlightOnDisconnect =
  resetMeshcoreRepeaterRpcInFlightForTests;

/** Repeater pings/traces queued or running (MeshCore allows one trace at a time on the radio). */
export function meshcoreRepeaterTraceInFlightCount(): number {
  return traceInFlightByNode.size;
}

/** True while the per-node ping/trace RPC wrapper is still running (includes direct-retry window). */
export function meshcoreRepeaterTraceActiveForNode(nodeId: number): boolean {
  return traceInFlightByNode.has(nodeId >>> 0);
}

/**
 * True while repeater admin/trace work holds the shared companion RF path.
 * Background room sync/auto-login should defer to avoid false login failures.
 */
export function meshcoreCompanionRepeaterRfBusy(): boolean {
  return (
    inFlightByKey.size > 0 ||
    traceInFlightByNode.size > 0 ||
    meshcoreTraceResponsesInFlightCount() > 0
  );
}
