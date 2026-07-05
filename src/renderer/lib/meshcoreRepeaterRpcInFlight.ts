export type MeshcoreRepeaterRpcKind = 'neighbors' | 'telemetry' | 'status';

const inFlightByKey = new Map<string, Promise<unknown>>();

function rpcKey(kind: MeshcoreRepeaterRpcKind, nodeId: number): string {
  return `${kind}:${nodeId}`;
}

/** Serialize duplicate repeater RPC clicks for the same node — returns the in-flight promise. */
export function runMeshcoreRepeaterRpcOnce<T>(
  kind: MeshcoreRepeaterRpcKind,
  nodeId: number,
  fn: () => Promise<T>,
): Promise<T> {
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
}
