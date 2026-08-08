import {
  hasEnabledLocalPropagationNode,
  isLocalPropagationLoading,
  listConfiguredRemotePropagationIds,
  listDiscoveredPropagationTargets,
  readReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import {
  type PropagationNodeRow,
  useReticulumPropagationStore,
} from '@/renderer/stores/reticulumPropagationStore';

/** Cap Auto discovered one-time sync attempts so a long failure chain cannot hang Sync. */
const MAX_DISCOVERED_SYNC_ATTEMPTS = 3;

/** No discovered PN, no reachable configured remote, and no usable local inbox. */
export const PROPAGATION_SYNC_NO_TARGET_KEY = 'reticulumPropagation.syncNoTarget';
/** Local inbox is enabled but its messagestore is still loading, so it cannot settle yet. */
export const PROPAGATION_SYNC_LOCAL_LOADING_KEY = 'reticulumPropagation.syncLocalLoading';

const DESTINATION_HASH_RE = /^[0-9a-fA-F]{32}$/;

/** Tracks whether any node was actually contacted, so a real error is never overwritten. */
interface CascadeAttempts {
  any: boolean;
}

async function startSyncId(id: string, attempts: CascadeAttempts): Promise<boolean> {
  attempts.any = true;
  return useReticulumPropagationStore.getState().startSync(id);
}

/**
 * Nothing was reachable. When no node was contacted at all, replace the generic
 * "node may be unreachable" error with why there was no target in the first place.
 */
function finishWithoutTarget(attempts: CascadeAttempts): boolean {
  if (attempts.any) return false;
  const { nodes } = useReticulumPropagationStore.getState();
  useReticulumPropagationStore
    .getState()
    .setLastSyncError(
      isLocalPropagationLoading(nodes)
        ? PROPAGATION_SYNC_LOCAL_LOADING_KEY
        : PROPAGATION_SYNC_NO_TARGET_KEY,
    );
  // No node was called, so nothing may be named alongside this error.
  useReticulumPropagationStore.getState().setSyncTargetId(null);
  return false;
}

async function tryLocalSettleIfEnabled(attempts: CascadeAttempts): Promise<boolean> {
  const { nodes } = useReticulumPropagationStore.getState();
  if (!hasEnabledLocalPropagationNode(nodes)) return finishWithoutTarget(attempts);
  return startSyncId('local-prop', attempts);
}

/**
 * Destination hash for a sync target id (or the id itself when it is already a hash);
 * empty string when the row has no known hash.
 */
function propagationTargetHash(nodes: PropagationNodeRow[], id: string): string {
  if (DESTINATION_HASH_RE.test(id)) return id.toLowerCase();
  return nodes.find((n) => n.id === id)?.destination_hash?.toLowerCase() ?? '';
}

/** True when the sidecar reports at least one enabled interface. Fail open on read errors. */
export async function fetchHasEnabledReticulumInterfaces(): Promise<boolean> {
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
      interfaces?: { enabled?: boolean }[];
    };
    const rows = body.interfaces ?? [];
    return rows.some((row) => row.enabled === true);
  } catch (e) {
    console.warn('[reticulumPropagationAutoApply] interfaces read failed', e);
    return true;
  }
}

/**
 * Auto: best discovered (one-time sync by hash — **no** Add, **no** Preferred) →
 * configured remotes → local-prop settle.
 * Manual: explicit first target, else Preferred, else best configured remote (picked for this
 * sync only — **no** Preferred write) → remaining configured remotes → local-prop settle.
 * Off: no propagation support — never syncs, even with an explicit target.
 */
export async function startPropagationSyncCascade(opts?: {
  /** Per-row Sync or resolved Preferred; optional for Auto (uses discovered/configured lists). */
  firstTargetId?: string | null;
  /**
   * When false, skip discovered/remote sync and settle local-prop (no active interfaces).
   * When omitted, Auto probes `/api/v1/interfaces`.
   */
  hasEnabledInterfaces?: boolean;
}): Promise<boolean> {
  const mode = readReticulumPropagationMode();
  if (mode === 'off') return false;

  const state = useReticulumPropagationStore.getState();
  const { nodes, preferredId, discovered } = state;
  const first = opts?.firstTargetId ?? null;
  const attempts: CascadeAttempts = { any: false };

  if (mode === 'auto') {
    const hasInterfaces =
      opts?.hasEnabledInterfaces ?? (await fetchHasEnabledReticulumInterfaces());
    if (!hasInterfaces) {
      return tryLocalSettleIfEnabled(attempts);
    }

    const triedHashes = new Set<string>();
    const discoveredTargets = listDiscoveredPropagationTargets(nodes, discovered).slice(
      0,
      MAX_DISCOVERED_SYNC_ATTEMPTS,
    );

    for (const target of discoveredTargets) {
      if (readReticulumPropagationMode() !== 'auto') return false;
      const hash = target.destinationHash.toLowerCase();
      triedHashes.add(hash);
      if (await startSyncId(hash, attempts)) return true;
    }

    for (const id of listConfiguredRemotePropagationIds(
      useReticulumPropagationStore.getState().nodes,
    )) {
      const row = useReticulumPropagationStore.getState().nodes.find((n) => n.id === id);
      const hash = row?.destination_hash?.toLowerCase();
      if (hash != null && triedHashes.has(hash)) continue;
      if (await startSyncId(id, attempts)) return true;
    }

    return tryLocalSettleIfEnabled(attempts);
  }

  // Manual: explicit first target → Preferred → picked remote → other remotes → local.
  const seed =
    first && first.length > 0
      ? first
      : preferredId && preferredId.length > 0
        ? preferredId
        : (listConfiguredRemotePropagationIds(nodes).at(0) ?? null);

  if (seed === 'local-prop' || seed == null) {
    return tryLocalSettleIfEnabled(attempts);
  }

  const tried = new Set<string>([seed]);
  const seedHash = propagationTargetHash(nodes, seed);
  if (seedHash) tried.add(seedHash);
  if (await startSyncId(seed, attempts)) return true;

  for (const id of listConfiguredRemotePropagationIds(
    useReticulumPropagationStore.getState().nodes,
  )) {
    if (readReticulumPropagationMode() !== 'manual') return false;
    if (tried.has(id)) continue;
    const currentNodes = useReticulumPropagationStore.getState().nodes;
    const rowHash = propagationTargetHash(currentNodes, id);
    if (rowHash && tried.has(rowHash)) continue;
    tried.add(id);
    if (rowHash) tried.add(rowHash);
    if (await startSyncId(id, attempts)) return true;
  }

  return tryLocalSettleIfEnabled(attempts);
}

/**
 * Run the mode-appropriate sync cascade.
 * `targetId` seeds Manual/Off (and Auto bottom-sync hint); local-prop / dest hashes allowed.
 */
export async function ensurePreferredThenStartSync(targetId: string): Promise<boolean> {
  return startPropagationSyncCascade({ firstTargetId: targetId });
}
