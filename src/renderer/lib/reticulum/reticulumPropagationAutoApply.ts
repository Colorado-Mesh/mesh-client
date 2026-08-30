import { isClientLocalPropagationEstablishError } from '@/renderer/lib/reticulum/reticulumPropagationEstablishRecovery';
import {
  hasEnabledLocalPropagationNode,
  isLocalPropagationLoading,
  listConfiguredRemotePropagationIds,
  listFiniteHopDiscoveredPropagationTargets,
  listSlowRfDiscoveredPropagationTargets,
  listUnknownHopDiscoveredPropagationTargets,
  propagationAutoBlacklistSet,
  propagationTargetDestinationHash,
  readReticulumPropagationMode,
  resolveManualCascadeSeed,
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
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';
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
 * Slack past the Establishing stall so a late WS failure still settles before we force-cancel.
 */
export const PROPAGATION_CASCADE_ATTEMPT_TIMEOUT_MS =
  RETICULUM_PROPAGATION_SYNC_STALL_MS + 15 * MS_PER_SECOND;

/** No discovered PN, no reachable configured remote, and no usable local inbox. */
export const PROPAGATION_SYNC_NO_TARGET_KEY = 'reticulumPropagation.syncNoTarget';
/** Local inbox is enabled but its messagestore is still loading, so it cannot settle yet. */
export const PROPAGATION_SYNC_LOCAL_LOADING_KEY = 'reticulumPropagation.syncLocalLoading';
/** Remotes existed but every start was soft-deferred (retrieve already in flight). */
export const PROPAGATION_SYNC_RETRIEVE_BUSY_KEY = 'reticulumPropagation.syncRetrieveBusy';

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
  /** Soft-defer (retrieve/outbound/not-live busy) — not a missing-target condition. */
  deferred: boolean;
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
  // startSync clears lastSyncError on entry; restore a prior real failure after soft-defer.
  const priorError = useReticulumPropagationStore.getState().lastSyncError;
  const startResult = await useReticulumPropagationStore.getState().startSync(id);
  if (startResult === 'deferred') {
    // Soft defer: do not 15-minute-backoff the node, but remember we had targets.
    attempts.deferred = true;
    if (priorError) {
      useReticulumPropagationStore.getState().setLastSyncError(priorError);
    }
    return 'deferred';
  }
  if (startResult !== 'accepted') {
    attempts.any = true;
    noteReticulumPropagationSyncFailure(id);
    return 'failed';
  }
  attempts.any = true;
  // Local settle is immediate; remotes use a cascade-sized budget so a slow PN cannot
  // monopolize the whole lxmf-core 120s window before we advance.
  const outcome = await awaitPropagationSyncSettled(
    id === 'local-prop' ? undefined : { timeoutMs: PROPAGATION_CASCADE_ATTEMPT_TIMEOUT_MS },
  );
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
  // Remotes already failed: keep their error (do not overwrite with local-loading).
  if (attempts.any) return false;
  const { nodes } = useReticulumPropagationStore.getState();
  const loading = isLocalPropagationLoading(nodes);
  // Discovered/configured targets existed but every startSync soft-deferred
  // (stuck prior /get). Do not claim "none discovered".
  const errorKey = loading
    ? PROPAGATION_SYNC_LOCAL_LOADING_KEY
    : attempts.deferred
      ? PROPAGATION_SYNC_RETRIEVE_BUSY_KEY
      : PROPAGATION_SYNC_NO_TARGET_KEY;
  useReticulumPropagationStore.getState().setLastSyncError(errorKey);
  // No node was called, so nothing may be named alongside this error.
  useReticulumPropagationStore.getState().setSyncTargetId(null);
  return false;
}

/**
 * @param deferFinish When true, skip the terminal `finishWithoutTarget` bookkeeping because
 * the caller still has candidates left to try (Auto's slow-RF last resort). Writing the
 * error here would strand a stale "no target" message even if the later attempt defers.
 */
async function tryLocalSettleIfEnabled(
  attempts: CascadeAttempts,
  deferFinish = false,
): Promise<boolean> {
  // Capture before local settle: remotes soft-deferred with no real contact must not
  // look like a full cascade success (would advance Auto interval and suppress retries).
  const remotesSoftDeferredOnly = attempts.deferred && !attempts.any;
  const hadRemoteContact = attempts.any;
  // Local settle's startSync clears lastSyncError — keep establish-class errors for the UI.
  const priorEstablishError = isClientLocalPropagationEstablishError(
    useReticulumPropagationStore.getState().lastSyncError,
  )
    ? useReticulumPropagationStore.getState().lastSyncError
    : null;
  let { nodes } = useReticulumPropagationStore.getState();
  // Auto ticks can start with a stale nodes list (local still "disabled" until refresh).
  if (!hasEnabledLocalPropagationNode(nodes)) {
    try {
      await useReticulumPropagationStore.getState().refreshFromSidecar();
      nodes = useReticulumPropagationStore.getState().nodes;
    } catch (e) {
      console.warn('[reticulumPropagationAutoApply] refreshFromSidecar failed', e);
      // Keep the nodes already read from the store and continue the enabled check.
    }
  }
  if (!hasEnabledLocalPropagationNode(nodes)) {
    if (priorEstablishError) {
      useReticulumPropagationStore.getState().setLastSyncError(priorEstablishError);
    }
    return deferFinish ? false : finishWithoutTarget(attempts);
  }
  const priorSuccessAt = useReticulumPropagationStore.getState().lastPropagationSyncAt;
  const outcome = await attemptSync('local-prop', attempts);
  const restoreEstablishError = (): void => {
    if (priorEstablishError) {
      useReticulumPropagationStore.getState().setLastSyncError(priorEstablishError);
    }
  };
  if (outcome === 'success') {
    if (remotesSoftDeferredOnly) {
      // Undo local settle's success stamp so Auto retries remotes after retrieve idle.
      useReticulumPropagationStore.getState().setLastPropagationSyncAt(priorSuccessAt);
      useReticulumPropagationStore.getState().setLastSyncError(PROPAGATION_SYNC_RETRIEVE_BUSY_KEY);
      return false;
    }
    // Keep establish-class error sticky for recovery UI even after local settle succeeds.
    restoreEstablishError();
    return true;
  }
  if (outcome === 'cancelled') {
    restoreEstablishError();
    return false;
  }
  restoreEstablishError();
  // Local soft-defer/fail with no prior remote contact → surface why (busy / loading / none).
  if (!hadRemoteContact && !deferFinish) return finishWithoutTarget(attempts);
  return false;
}

/**
 * True when the sidecar reports at least one enabled interface.
 * Fail closed on read/rate-limit errors so Auto does not burn remote cascade budget.
 */
export async function fetchHasEnabledReticulumInterfaces(): Promise<boolean> {
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
      interfaces?: { enabled?: boolean }[];
      ok?: boolean;
      error?: string;
    };
    if (body.ok === false || typeof body.error === 'string') {
      return false;
    }
    const rows = body.interfaces ?? [];
    return rows.some((row) => row.enabled === true);
  } catch (e) {
    console.warn('[reticulumPropagationAutoApply] interfaces read failed', e);
    return false;
  }
}

type RemoteAttemptsResult = 'success' | 'stop' | 'exhausted' | 'client_local';

/** After a failed attempt, stop chaining remotes when the error is client-local establish. */
function stopRemotesForClientLocalEstablish(): boolean {
  return isClientLocalPropagationEstablishError(
    useReticulumPropagationStore.getState().lastSyncError,
  );
}

/**
 * Try configured remotes (skipping recently failed / already-tried ids or hashes).
 * `stop` = superseded or user cancel; `exhausted` = fall through to local settle.
 */
async function runConfiguredRemoteAttempts(args: {
  mode: ReticulumPropagationMode;
  tried: Set<string>;
  attempts: CascadeAttempts;
  generation: number;
  remoteDeadlineMs: number;
  /** When set (Auto), skip remotes whose destination hash is ignored for Auto. */
  autoBlacklist?: ReadonlySet<string>;
}): Promise<RemoteAttemptsResult> {
  const { mode, tried, attempts, generation, remoteDeadlineMs, autoBlacklist } = args;
  const superseded = (): boolean =>
    readReticulumPropagationMode() !== mode || cascadeGeneration !== generation;

  for (const id of omitRecentlyFailedPropagationTargets(
    listConfiguredRemotePropagationIds(
      useReticulumPropagationStore.getState().nodes,
      autoBlacklist,
    ),
    (remoteId) => remoteId,
  )) {
    if (superseded()) return 'stop';
    if (Date.now() >= remoteDeadlineMs) break;
    if (tried.has(id)) continue;
    const currentNodes = useReticulumPropagationStore.getState().nodes;
    const rowHash = propagationTargetDestinationHash(currentNodes, id);
    if (rowHash && tried.has(rowHash)) continue;
    tried.add(id);
    if (rowHash) tried.add(rowHash);
    const outcome = await attemptSync(id, attempts);
    if (outcome === 'success') return 'success';
    if (outcome === 'cancelled') return 'stop';
    if (outcome === 'failed' && stopRemotesForClientLocalEstablish()) return 'client_local';
  }
  return 'exhausted';
}

/**
 * Auto: finite-hop discovered (one-time by hash — **no** Add/Preferred) → configured
 * remotes → unknown-hop discovered → local-prop settle.
 * Manual: explicit first target, else Preferred, else best configured remote (picked for this
 * sync only — **no** Preferred write) → remaining configured remotes → local-prop settle.
 * Off: no propagation support — never syncs, even with an explicit target.
 *
 * Each step waits for that attempt to actually settle, so a node that accepts the request and
 * then fails to establish hands off to the next candidate instead of ending the cascade.
 *
 * In Auto, `firstTargetId` is ignored — per-row Sync and bottom Sync both run the full
 * finite-discovered → configured → unknown-discovered → local cascade — unless
 * `singleTargetOnly` is set (recovery Retry Sync).
 */
export async function startPropagationSyncCascade(opts?: {
  /** Seeds Manual (Preferred / per-row Sync). Ignored in Auto unless `singleTargetOnly`. */
  firstTargetId?: string | null;
  /**
   * When false, skip discovered/remote sync and settle local-prop (no active interfaces).
   * When omitted, Auto probes `/api/v1/interfaces`.
   */
  hasEnabledInterfaces?: boolean;
  /**
   * Attempt only `firstTargetId` (then local settle). Used by establish-recovery Retry so
   * Auto does not burn through other remotes again.
   */
  singleTargetOnly?: boolean;
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
  opts?: {
    firstTargetId?: string | null;
    hasEnabledInterfaces?: boolean;
    singleTargetOnly?: boolean;
  },
): Promise<boolean> {
  const mode = readReticulumPropagationMode();
  if (mode === 'off') return false;

  const state = useReticulumPropagationStore.getState();
  const { nodes, preferredId, discovered, autoBlacklist: blacklistRows } = state;
  const autoBlacklist = propagationAutoBlacklistSet(blacklistRows);
  const first = opts?.firstTargetId ?? null;
  const attempts: CascadeAttempts = { any: false, deferred: false };
  const remoteDeadlineMs = Date.now() + PROPAGATION_CASCADE_BUDGET_MS;
  /** Mode changed under us, or a newer cascade took over — abandon this run entirely. */
  const superseded = (forMode: ReticulumPropagationMode): boolean =>
    readReticulumPropagationMode() !== forMode || cascadeGeneration !== generation;
  /** Remote attempts ran long enough; stop chaining them but still settle the local inbox. */
  const remoteBudgetSpent = (): boolean => Date.now() >= remoteDeadlineMs;

  // Establish-recovery Retry: one remote (or local) only, then local settle if needed.
  if (opts?.singleTargetOnly && first != null && first.length > 0) {
    if (first === 'local-prop') {
      return tryLocalSettleIfEnabled(attempts);
    }
    const seedOutcome = await attemptSync(first, attempts);
    if (seedOutcome === 'success') return true;
    if (seedOutcome === 'cancelled') return false;
    return tryLocalSettleIfEnabled(attempts);
  }

  if (mode === 'auto') {
    const hasInterfaces =
      opts?.hasEnabledInterfaces ?? (await fetchHasEnabledReticulumInterfaces());
    if (!hasInterfaces) {
      return tryLocalSettleIfEnabled(attempts);
    }

    const tried = new Set<string>();
    const tryDiscoveredBatch = async (
      batch: { destinationHash: string; hops: number }[],
    ): Promise<'success' | 'cancelled' | 'continue' | 'client_local'> => {
      const targets = omitRecentlyFailedPropagationTargets(
        batch,
        (target) => target.destinationHash,
      ).slice(0, MAX_DISCOVERED_SYNC_ATTEMPTS);
      for (const target of targets) {
        if (superseded('auto')) return 'cancelled';
        if (remoteBudgetSpent()) return 'continue';
        const hash = target.destinationHash.toLowerCase();
        if (tried.has(hash)) continue;
        tried.add(hash);
        const outcome = await attemptSync(hash, attempts);
        if (outcome === 'success') return 'success';
        if (outcome === 'cancelled') return 'cancelled';
        if (outcome === 'failed' && stopRemotesForClientLocalEstablish()) return 'client_local';
      }
      return 'continue';
    };

    // Prefer path-known discovered PNs before configured remotes; leave hops-unknown
    // vanity announces until after configured so they cannot starve Preferred/added PNs.
    const finiteOutcome = await tryDiscoveredBatch(
      listFiniteHopDiscoveredPropagationTargets(nodes, discovered, autoBlacklist),
    );
    if (finiteOutcome === 'success') return true;
    if (finiteOutcome === 'cancelled') return false;
    if (finiteOutcome === 'client_local') return tryLocalSettleIfEnabled(attempts);

    const remotes = await runConfiguredRemoteAttempts({
      mode: 'auto',
      tried,
      attempts,
      generation,
      remoteDeadlineMs,
      autoBlacklist,
    });
    if (remotes === 'success') return true;
    if (remotes === 'stop') return false;
    if (remotes === 'client_local') return tryLocalSettleIfEnabled(attempts);

    const unknownOutcome = await tryDiscoveredBatch(
      listUnknownHopDiscoveredPropagationTargets(nodes, discovered, autoBlacklist),
    );
    if (unknownOutcome === 'success') return true;
    if (unknownOutcome === 'cancelled') return false;
    if (unknownOutcome === 'client_local') return tryLocalSettleIfEnabled(attempts);

    // Slow-RF nodes still follow, so the local settle must not write a terminal
    // "no target" error yet — a slow-RF attempt that soft-defers has to win the message.
    if (await tryLocalSettleIfEnabled(attempts, true)) return true;

    // Last resort: a PN reachable only over multi-hop RF. Depositing there usually
    // exceeds the sync timeout, so it is tried only once everything else has failed.
    const slowRfOutcome = await tryDiscoveredBatch(
      listSlowRfDiscoveredPropagationTargets(nodes, discovered, autoBlacklist),
    );
    if (slowRfOutcome === 'success') return true;
    if (slowRfOutcome === 'cancelled') return false;
    return finishWithoutTarget(attempts);
  }

  // Manual: explicit first target → Preferred → picked remote → other remotes → local.
  const seed = resolveManualCascadeSeed(first, preferredId, nodes);

  if (seed === 'local-prop' || seed == null) {
    return tryLocalSettleIfEnabled(attempts);
  }

  const tried = new Set<string>([seed]);
  const seedHash = propagationTargetDestinationHash(nodes, seed);
  if (seedHash) tried.add(seedHash);
  const seedOutcome = await attemptSync(seed, attempts);
  if (seedOutcome === 'success') return true;
  if (seedOutcome === 'cancelled') return false;
  if (seedOutcome === 'failed' && stopRemotesForClientLocalEstablish()) {
    return tryLocalSettleIfEnabled(attempts);
  }

  const remotes = await runConfiguredRemoteAttempts({
    mode: 'manual',
    tried,
    attempts,
    generation,
    remoteDeadlineMs,
  });
  if (remotes === 'success') return true;
  if (remotes === 'stop') return false;
  // client_local and exhausted both fall through to local settle
  return tryLocalSettleIfEnabled(attempts);
}

/**
 * Run the mode-appropriate sync cascade with an optional Manual seed target.
 * Auto ignores `targetId` and always runs finite-discovered → configured →
 * unknown-discovered → local.
 */
export async function startPropagationSyncWithTarget(targetId: string): Promise<boolean> {
  return startPropagationSyncCascade({ firstTargetId: targetId });
}

/** Retry one Prefer/last target after establish recovery (skips Auto multi-PN burn). */
export async function startPropagationSyncSingleTarget(targetId: string): Promise<boolean> {
  return startPropagationSyncCascade({ firstTargetId: targetId, singleTargetOnly: true });
}
