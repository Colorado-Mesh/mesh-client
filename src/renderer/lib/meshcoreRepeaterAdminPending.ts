export type MeshcoreRepeaterAdminPendingKind =
  'status' | 'telemetry' | 'neighbors' | 'ping' | 'cli';

export type MeshcoreRepeaterRpcPendingMap = Map<number, Set<MeshcoreRepeaterAdminPendingKind>>;

export function isRepeaterAdminRpcPending(
  map: MeshcoreRepeaterRpcPendingMap | undefined,
  nodeId: number,
  kind: MeshcoreRepeaterAdminPendingKind,
): boolean {
  return map?.get(nodeId)?.has(kind) ?? false;
}

export function setRepeaterAdminRpcPending(
  prev: MeshcoreRepeaterRpcPendingMap,
  nodeId: number,
  kind: MeshcoreRepeaterAdminPendingKind,
  pending: boolean,
): MeshcoreRepeaterRpcPendingMap {
  const next = new Map(prev);
  const kinds = new Set(next.get(nodeId) ?? []);
  if (pending) kinds.add(kind);
  else kinds.delete(kind);
  if (kinds.size === 0) next.delete(nodeId);
  else next.set(nodeId, kinds);
  return next;
}
