import { pushAppToast } from '@/renderer/components/Toast';
import {
  type AutoPropagationTarget,
  hasEnabledLocalPropagationNode,
  listConfiguredRemotePropagationIds,
  listDiscoveredPropagationTargets,
  pickAutoPropagationTarget,
  readReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

function toastI18n(key: string, type: 'error' | 'warning'): void {
  // Lazy import so node/renderer-logic tests that only touch shouldRun* don't load i18n.
  void import('@/renderer/lib/i18n').then((mod) => {
    pushAppToast(mod.default.t(key), type);
  });
}

function targetLabel(target: AutoPropagationTarget): string {
  if (target.kind === 'configured') return `configured:${target.id}`;
  if (target.kind === 'discovered') return `discovered:${target.destinationHash.slice(0, 12)}`;
  return 'local';
}

/** Bumped when leaving Auto (or explicitly) so in-flight Preferred writes become stale. */
let modeGeneration = 0;

/** Single-flight mutex + the generation that started it. */
let applyInFlight: Promise<ApplyAutoPreferredResult> | null = null;
let inFlightGeneration = -1;

const AUTO_APPLY_RETRY_MS = 750;

export type ApplyAutoPreferredResult = 'applied' | 'noop' | 'skipped' | 'failed';

export function bumpPropagationModeGeneration(): void {
  modeGeneration += 1;
}

export function getPropagationModeGeneration(): number {
  return modeGeneration;
}

async function runAutoApplyOnce(
  generation: number,
  forceAlign: boolean,
): Promise<ApplyAutoPreferredResult> {
  if (readReticulumPropagationMode() !== 'auto') return 'skipped';
  if (generation !== modeGeneration) return 'skipped';

  const state = useReticulumPropagationStore.getState();
  if (state.sync.active) return 'skipped';

  const target = pickAutoPropagationTarget(state.nodes, state.discovered);
  if (!target) return 'noop';

  const { preferredId, setPreferredOnSidecar, addFromDiscovered } = state;
  let appliedLocal = false;
  let ok: boolean;
  if (target.kind === 'configured') {
    if (!forceAlign && target.id === preferredId) return 'noop';
    ok = await setPreferredOnSidecar(target.id);
  } else if (target.kind === 'local') {
    if (!forceAlign && preferredId === 'local-prop') return 'noop';
    ok = await setPreferredOnSidecar('local-prop');
    appliedLocal = ok;
  } else {
    // Soft-upsert discovered → configured preferred (no manual Add click).
    ok = await addFromDiscovered(target.destinationHash, { prefer: true });
  }

  if (generation !== modeGeneration || readReticulumPropagationMode() !== 'auto') {
    return 'skipped';
  }
  if (!ok) {
    console.warn(
      `[reticulumPropagationAutoApply] preferred apply failed target=${targetLabel(target)} ` +
        `lastAddError=${useReticulumPropagationStore.getState().lastAddError ?? 'none'}`,
    );
    return 'failed';
  }
  if (appliedLocal) {
    toastI18n('reticulumPropagation.preferredLocalWarning', 'warning');
  }
  return 'applied';
}

/**
 * Apply Auto-mode Preferred from {@link pickAutoPropagationTarget}: soft-upsert discovered,
 * set Preferred for configured/local. Single-flight per generation; a newer generation waits
 * for the stale flight then runs again (does not inherit a cancelled skip/fail).
 * On hard failure, retries once after a short delay before toasting.
 */
export async function applyAutoPropagationPreferredIfNeeded(opts?: {
  /** Capture before awaits; if mode generation advances, discard the result. */
  generation?: number;
  /** When true, still run even if current preferred already matches (used before sync). */
  forceAlign?: boolean;
}): Promise<ApplyAutoPreferredResult> {
  const generation = opts?.generation ?? modeGeneration;
  const forceAlign = opts?.forceAlign === true;

  if (applyInFlight) {
    if (generation === inFlightGeneration) {
      return applyInFlight;
    }
    // Stale flight for an older generation — wait it out, then start fresh for this gen.
    try {
      await applyInFlight;
    } catch {
      // catch-no-log-ok prior flight Result path never rejects
    }
    if (generation !== modeGeneration) return 'skipped';
  }

  const run = async (): Promise<ApplyAutoPreferredResult> => {
    let result = await runAutoApplyOnce(generation, forceAlign);
    if (result !== 'failed') return result;
    if (generation !== modeGeneration || readReticulumPropagationMode() !== 'auto') {
      return 'skipped';
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, AUTO_APPLY_RETRY_MS);
    });
    if (generation !== modeGeneration || readReticulumPropagationMode() !== 'auto') {
      return 'skipped';
    }
    result = await runAutoApplyOnce(generation, forceAlign);
    if (result === 'failed') {
      toastI18n('reticulumPropagation.autoApplyFailed', 'error');
    }
    return result;
  };

  inFlightGeneration = generation;
  applyInFlight = run().finally(() => {
    applyInFlight = null;
    inFlightGeneration = -1;
  });
  return applyInFlight;
}

async function startSyncId(id: string): Promise<boolean> {
  return useReticulumPropagationStore.getState().startSync(id);
}

async function tryLocalSettleIfEnabled(): Promise<boolean> {
  const { nodes } = useReticulumPropagationStore.getState();
  if (!hasEnabledLocalPropagationNode(nodes)) return false;
  return startSyncId('local-prop');
}

/**
 * Auto: best discovered → configured remotes (hop-sorted) → local-prop.
 * Manual/Off: optional first target (Preferred or per-row), then local on failure.
 */
export async function startPropagationSyncCascade(opts?: {
  /** Per-row Sync or resolved Preferred; optional for Auto (rebuilds from pick lists). */
  firstTargetId?: string | null;
}): Promise<boolean> {
  const mode = readReticulumPropagationMode();
  const state = useReticulumPropagationStore.getState();
  const { nodes, preferredId, addFromDiscovered } = state;
  const first = opts?.firstTargetId ?? null;

  if (mode === 'auto') {
    await applyAutoPropagationPreferredIfNeeded({ forceAlign: true });
    if (readReticulumPropagationMode() !== 'auto') return false;

    const tried = new Set<string>();
    const fresh = useReticulumPropagationStore.getState();
    const bestDiscovered = listDiscoveredPropagationTargets(fresh.nodes, fresh.discovered).at(0);
    if (bestDiscovered != null) {
      const okAdd = await addFromDiscovered(bestDiscovered.destinationHash, { prefer: true });
      const after = useReticulumPropagationStore.getState();
      const row = after.nodes.find(
        (n) => n.destination_hash?.toLowerCase() === bestDiscovered.destinationHash.toLowerCase(),
      );
      const id = row?.id ?? (okAdd ? after.preferredId : null);
      if (id != null && id !== 'local-prop') {
        tried.add(id);
        if (await startSyncId(id)) return true;
      }
    }

    for (const id of listConfiguredRemotePropagationIds(
      useReticulumPropagationStore.getState().nodes,
    )) {
      if (tried.has(id)) continue;
      tried.add(id);
      if (await startSyncId(id)) return true;
    }

    return tryLocalSettleIfEnabled();
  }

  // Manual / Off: Preferred or explicit first target, then local fallback.
  const preferred = preferredId;
  if (first === 'local-prop' || preferred === 'local-prop') {
    return tryLocalSettleIfEnabled();
  }

  const remoteFirst =
    first && first !== 'local-prop'
      ? first
      : preferred && preferred !== 'local-prop'
        ? preferred
        : null;

  if (remoteFirst) {
    if (await startSyncId(remoteFirst)) return true;
  }

  // Manual with no Preferred but local enabled (only-local install).
  if (!remoteFirst && hasEnabledLocalPropagationNode(nodes)) {
    return startSyncId('local-prop');
  }

  return tryLocalSettleIfEnabled();
}

/**
 * Align Preferred when Auto, then run the mode-appropriate sync cascade.
 * `targetId` seeds Manual/Off (and Auto bottom-sync hint); local-prop is allowed.
 */
export async function ensurePreferredThenStartSync(targetId: string): Promise<boolean> {
  return startPropagationSyncCascade({ firstTargetId: targetId });
}

/** Test-only: reset module mutex/generation between cases. */
export function resetPropagationAutoApplyForTests(): void {
  modeGeneration = 0;
  applyInFlight = null;
  inFlightGeneration = -1;
}
