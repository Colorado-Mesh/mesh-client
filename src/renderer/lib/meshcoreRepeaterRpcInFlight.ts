export type MeshcoreRepeaterRpcKind = 'neighbors' | 'telemetry' | 'status' | 'trace';

const inFlightByKey = new Map<string, Promise<unknown>>();

/** Serializes trace sends on the radio; one in-flight promise per node for duplicate clicks. */
let traceQueueTail: Promise<unknown> = Promise.resolve();
const traceInFlightByNode = new Map<number, Promise<unknown>>();

function rpcKey(kind: MeshcoreRepeaterRpcKind, nodeId: number): string {
  if (kind === 'trace') return `trace:${nodeId}`;
  return `${kind}:${nodeId}`;
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

/** Serialize duplicate repeater RPC clicks for the same node — returns the in-flight promise. */
export function runMeshcoreRepeaterRpcOnce<T>(
  kind: MeshcoreRepeaterRpcKind,
  nodeId: number,
  fn: () => Promise<T>,
): Promise<T> {
  if (kind === 'trace') {
    return runMeshcoreTraceRpcOnce(nodeId, fn);
  }
  const key = rpcKey(kind, nodeId);
  const existing = inFlightByKey.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const next = fn().finally(() => {
    if (inFlightByKey.get(key) === next) {
      inFlightByKey.delete(key);
    }
  });
  inFlightByKey.set(key, next);
  return next;
}

/** Test-only reset. */
export function resetMeshcoreRepeaterRpcInFlightForTests(): void {
  inFlightByKey.clear();
  traceInFlightByNode.clear();
  traceQueueTail = Promise.resolve();
}

/** Repeater pings/traces queued or running (MeshCore allows one trace at a time on the radio). */
export function meshcoreRepeaterTraceInFlightCount(): number {
  return traceInFlightByNode.size;
}
