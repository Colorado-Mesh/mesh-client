import {
  hasEnabledLocalPropagationNode,
  isLocalPropagationLoading,
  listConfiguredRemotePropagationIds,
  listDiscoveredPropagationTargets,
  readReticulumPropagationMode,
  type ReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import {
  awaitPropagationSyncSettled,
  type PropagationAttemptOutcome,
  RETICULUM_PROPAGATION_SYNC_STALL_MS,
} from '@/renderer/lib/reticulum/reticulumPropagationSync';
import {
  clearReticulumPropagationSyncFailure,
  noteReticulumPropagationSyncFailure,
  omitRecentlyFailedPropagationTargets,
} from '@/renderer/lib/reticulum/reticulumPropagationSyncBackoff';
import {
  type PropagationNodeRow,
  useReticulumPropagationStore,
} from '@/renderer/stores/reticulumPropagationStore';
import { MS_PER_MINUTE, MS_PER_SECOND } from '@/shared/timeConstants';

/** Cap Auto discovered one-time sync attempts so a long failure chain cannot hang Sync. */
const MAX_DISCOVERED_SYNC_ATTEMPTS = 3;

/**
 * Total time the remote half of a cascade may consume. Each attempt is already bounded by the
 * stall (45s) and ceiling (180s) watchdogs; this stops a chain of slow nodes from delaying the
 * local-inbox settle for many minutes.
 */
export const PROPAGATION_CASCADE_BUDGET_MS = 5 * MS_PER_MINUTE;

/**
 * Per remote attempt while cascading. Remotes that get past Establishing can otherwise burn the
 * full ~120s lxmf-core timeout before failing; cascade advances (and reaches local) sooner.
 */
export const PROPAGATION_CASCADE_ATTEMPT_TIMEOUT_MS =
  RETICULUM_PROPAGATION_SYNC_STALL_MS + 15 * MS_PER_SECOND;

/** No discovered PN, no reachable configured remote, and no usable local inbox. */
export const PROPAGATION_SYNC_NO_TARGET_KEY = 'reticulumPropagation.syncNoTarget';
/** Local inbox is enabled but its messagestore is still loading, so it cannot settle yet. */
export const PROPAGATION_SYNC_LOCAL_LOADING_KEY = 'reticulumPropagation.syncLocalLoading';

const DESTINATION_HASH_RE = /^[0-9a-fA-F]{32}$/;

/** Shared run for overlapping auto-sync ticks. */
let inFlightCascade: Promise<boolean> | null = null;
/** Bumped per run so a superseded cascade stops at its next attempt boundary. */
let cascadeGeneration = 0;

/** Test seam — drops the shared run so suites do not leak a cascade between cases. */
export function resetPropagationSyncCascadeState(): void {
  inFlightCascade = null;
  cascadeGeneration = 0;
}

/** Tracks whether any node was actually contacted, so a real error is never overwritten. */
interface CascadeAttempts {
  any: boolean;
}

/**
 * Start one sync and wait for its real outcome.
 *
 * `startSync` resolves as soon as the sidecar accepts the request, so a node that accepts and
 * then fails to establish would otherwise look like success and end the cascade.
 */
async function attemptSync(
  id: string,
  attempts: CascadeAttempts,
): Promise<PropagationAttemptOutcome> {
  attempts.any = true;
  const accepted = await useReticulumPropagationStore.getState().startSync(id);
  // Local settle is immediate; remotes use a cascade-sized budget so a slow PN cannot
  // monopolize the whole lxmf-core 120s window before we advance.
  const outcome = accepted
    ? await awaitPropagationSyncSettled(
        id === 'local-prop' ? undefined : { timeoutMs: PROPAGATION_CASCADE_ATTEMPT_TIMEOUT_MS },
      )
    : 'failed';
  if (outcome === 'success') {
    clearReticulumPropagationSyncFailure(id);
  } else if (outcome === 'failed') {
    noteReticulumPropagationSyncFailure(id);
  }
  return outcome;
}

/**
 * Nothing was reachable. When no node was contacted at all, replace the generic
 * "node may be unreachable" error with why there was no target in the first place.
 */
function finishWithoutTarget(attempts: CascadeAttempts): boolean {
  const { nodes } = useReticulumPropagationStore.getState();
  const loading = isLocalPropagationLoading(nodes);
  // Remotes already failed: keep their error unless local is still loading (actionable).
  if (attempts.any && !loading) return false;
  useReticulumPropagationStore
    .getState()
    .setLastSyncError(
      loading ? PROPAGATION_SYNC_LOCAL_LOADING_KEY : PROPAGATION_SYNC_NO_TARGET_KEY,
    );
  // No node was called, so nothing may be named alongside this error.
  if (!attempts.any) {
    useReticulumPropagationStore.getState().setSyncTargetId(null);
  }
  return false;
}

async function tryLocalSettleIfEnabled(attempts: CascadeAttempts): Promise<boolean> {
  let { nodes } = useReticulumPropagationStore.getState();
  // Auto ticks can start with a stale nodes list (local still "disabled" until refresh).
  if (!hasEnabledLocalPropagationNode(nodes)) {
    await useReticulumPropagationStore.getState().refreshFromSidecar();
    nodes = useReticulumPropagationStore.getState().nodes;
  }
  if (!hasEnabledLocalPropagationNode(nodes)) return finishWithoutTarget(attempts);
  return (await attemptSync('local-prop', attempts)) === 'success';
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
 *
 * Each step waits for that attempt to actually settle, so a node that accepts the request and
 * then fails to establish hands off to the next candidate instead of ending the cascade.
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
  const explicitTarget = opts?.firstTargetId != null && opts.firstTargetId.length > 0;
  // A cascade now spans the whole attempt chain, so the 30s auto-sync tick would otherwise
  // start a competing run between attempts. An explicit user Sync supersedes instead.
  if (inFlightCascade != null && !explicitTarget) return inFlightCascade;

  const generation = ++cascadeGeneration;
  const run = runPropagationSyncCascade(generation, opts).finally(() => {
    if (cascadeGeneration === generation) inFlightCascade = null;
  });
  inFlightCascade = run;
  return run;
}

async function runPropagationSyncCascade(
  generation: number,
  opts?: { firstTargetId?: string | null; hasEnabledInterfaces?: boolean },
): Promise<boolean> {
  const mode = readReticulumPropagationMode();
  if (mode === 'off') return false;

  const state = useReticulumPropagationStore.getState();
  const { nodes, preferredId, discovered } = state;
  const first = opts?.firstTargetId ?? null;
  const attempts: CascadeAttempts = { any: false };
  const remoteDeadlineMs = Date.now() + PROPAGATION_CASCADE_BUDGET_MS;
  /** Mode changed under us, or a newer cascade took over — abandon this run entirely. */
  const superseded = (forMode: ReticulumPropagationMode): boolean =>
    readReticulumPropagationMode() !== forMode || cascadeGeneration !== generation;
  /** Remote attempts ran long enough; stop chaining them but still settle the local inbox. */
  const remoteBudgetSpent = (): boolean => Date.now() >= remoteDeadlineMs;

  if (mode === 'auto') {
    const hasInterfaces =
      opts?.hasEnabledInterfaces ?? (await fetchHasEnabledReticulumInterfaces());
    if (!hasInterfaces) {
      return tryLocalSettleIfEnabled(attempts);
    }

    const triedHashes = new Set<string>();
    const discoveredTargets = omitRecentlyFailedPropagationTargets(
      listDiscoveredPropagationTargets(nodes, discovered),
      (target) => target.destinationHash,
    ).slice(0, MAX_DISCOVERED_SYNC_ATTEMPTS);

    for (const target of discoveredTargets) {
      if (superseded('auto')) return false;
      if (remoteBudgetSpent()) break;
      const hash = target.destinationHash.toLowerCase();
      triedHashes.add(hash);
      const outcome = await attemptSync(hash, attempts);
      if (outcome === 'success') return true;
      if (outcome === 'cancelled') return false;
    }

    for (const id of omitRecentlyFailedPropagationTargets(
      listConfiguredRemotePropagationIds(useReticulumPropagationStore.getState().nodes),
      (id) => id,
    )) {
      if (superseded('auto')) return false;
      if (remoteBudgetSpent()) break;
      const row = useReticulumPropagationStore.getState().nodes.find((n) => n.id === id);
      const hash = row?.destination_hash?.toLowerCase();
      if (hash != null && triedHashes.has(hash)) continue;
      const outcome = await attemptSync(id, attempts);
      if (outcome === 'success') return true;
      if (outcome === 'cancelled') return false;
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
  const seedOutcome = await attemptSync(seed, attempts);
  if (seedOutcome === 'success') return true;
  if (seedOutcome === 'cancelled') return false;

  for (const id of omitRecentlyFailedPropagationTargets(
    listConfiguredRemotePropagationIds(useReticulumPropagationStore.getState().nodes),
    (id) => id,
  )) {
    if (superseded('manual')) return false;
    if (remoteBudgetSpent()) break;
    if (tried.has(id)) continue;
    const currentNodes = useReticulumPropagationStore.getState().nodes;
    const rowHash = propagationTargetHash(currentNodes, id);
    if (rowHash && tried.has(rowHash)) continue;
    tried.add(id);
    if (rowHash) tried.add(rowHash);
    const outcome = await attemptSync(id, attempts);
    if (outcome === 'success') return true;
    if (outcome === 'cancelled') return false;
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
