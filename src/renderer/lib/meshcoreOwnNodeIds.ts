import { loadPersistedMeshcoreSelfNodeId } from './meshcoreLastSelfNodeId';

/** MeshCore node ids treated as "self" for unread filtering (runtime + persisted fallbacks). */
export function resolveMeshcoreOwnNodeIdSet(opts: {
  runtimeSelfNodeId: number;
  identitySelfNodeNum?: number;
  connectionMyNodeNum?: number;
  persistedSelfNodeId?: number;
}): Set<number> {
  const ids = new Set<number>();
  const persisted = opts.persistedSelfNodeId ?? loadPersistedMeshcoreSelfNodeId();
  for (const id of [
    opts.runtimeSelfNodeId,
    opts.identitySelfNodeNum,
    opts.connectionMyNodeNum,
    persisted,
  ]) {
    if (id != null && id > 0) ids.add(id >>> 0);
  }
  return ids;
}
