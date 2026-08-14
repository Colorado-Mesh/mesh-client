import { meshcoreTraceResponsesInFlightCount } from './meshcoreTracePathMultiplex';

export type MeshcoreRepeaterRpcKind = 'neighbors' | 'telemetry' | 'status' | 'trace' | 'cli';

const inFlightByKey = new Map<string, Promise<unknown>>();

/** Serializes trace sends on the radio; one in-flight promise per node for duplicate clicks. */
let traceQueueTail: Promise<unknown> = Promise.resolve();
const traceInFlightByNode = new Map<number, Promise<unknown>>();

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

function runMeshcoreTraceRpcOnce<T>(nodeId: number, fn: () => Promise<T>): Promise<T> {
  const existingForNode = traceInFlightByNode.get(nodeId);
  if (existingForNode) {
    return existingForNode as Promise<T>;
  }

  const queued = traceQueueTail.then(() => {
    if (cliReplyHoldCount > 0) {
      return awaitMeshcoreCliReplyHoldClear().then(() => fn());
    }
    return fn();
  });
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
  cliReplyHoldCount = 0;
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
    cliReplyHoldCount > 0 ||
    inFlightByKey.size > 0 ||
    traceInFlightByNode.size > 0 ||
    meshcoreTraceResponsesInFlightCount() > 0
  );
}
