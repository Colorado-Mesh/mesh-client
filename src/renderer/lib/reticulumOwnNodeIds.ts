import { reticulumHashToNodeId } from './reticulum/destHash';
import { loadPersistedReticulumSelfNodeId } from './reticulumLastSelfLxmfHash';

/** Reticulum node ids treated as "self" for chat unread / DM tab filtering. */
export function resolveReticulumOwnNodeIdSet(opts: {
  runtimeSelfNodeId?: number | null;
  connectionMyNodeNum?: number | null;
  lxmfHash?: string | null;
  persistedSelfNodeId?: number;
}): Set<number> {
  const fromRuntime =
    typeof opts.runtimeSelfNodeId === 'number'
      ? opts.runtimeSelfNodeId
      : (opts.connectionMyNodeNum ?? 0);
  const fromIdentity = opts.lxmfHash ? reticulumHashToNodeId(opts.lxmfHash) : 0;
  const fromPersisted = opts.persistedSelfNodeId ?? loadPersistedReticulumSelfNodeId();
  const ids = new Set<number>();
  for (const id of [fromRuntime, fromIdentity, fromPersisted]) {
    if (id > 0) ids.add(id >>> 0);
  }
  return ids;
}
