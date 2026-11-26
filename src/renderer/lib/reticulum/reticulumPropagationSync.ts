import {
  clearPropagationSyncStallWatchdog,
  schedulePropagationSyncStallWatchdog,
  useReticulumPropagationStore,
} from '@/renderer/stores/reticulumPropagationStore';

export { clearPropagationSyncStallWatchdog, schedulePropagationSyncStallWatchdog };
import {
  isPropagationSyncCancelledMessage,
  isPropagationSyncSoftDeferError,
  isPropagationSyncStillEstablishing,
  isPropagationSyncSupersedeMessage,
  mapPropagationSyncError,
  PROPAGATION_SYNC_SUPERSEDED,
  RETICULUM_PROPAGATION_SYNC_CEILING_MS,
  RETICULUM_PROPAGATION_SYNC_ESTABLISHING_MAX_PROGRESS,
  RETICULUM_PROPAGATION_SYNC_IDLE,
  RETICULUM_PROPAGATION_SYNC_STALL_MS,
  SYNC_CANCELLED_KEY,
  SYNC_TIMED_OUT_KEY,
} from './reticulumPropagationSyncShared';

export { RETICULUM_PROPAGATION_SYNC_STALL_MS };

/** Keep refresh affordance visible long enough to perceive (~10ms API otherwise). */
export const RETICULUM_PROPAGATION_REFRESH_MIN_VISIBLE_MS = 500;

/** How long a failed sync keeps the Diagnostics failing row visible. */
export const RETICULUM_PROPAGATION_SYNC_FAILING_DIAGNOSTIC_TTL_MS = 60 * 60 * 1000;

export interface PropagationSyncStuckInput {
  syncActive: boolean;
  syncProgress: number;
  lastAttemptAt: number | null;
}

/** True when sync is stuck in Establishing past the stall window. */
export function isPropagationSyncEstablishingStuck(
  input: PropagationSyncStuckInput,
  now = Date.now(),
): boolean {
  return (
    input.syncActive &&
    input.lastAttemptAt != null &&
    now - input.lastAttemptAt >= RETICULUM_PROPAGATION_SYNC_STALL_MS &&
    isPropagationSyncStillEstablishing(input.syncProgress)
  );
}

export {
  isPropagationSyncSoftDeferError,
  isPropagationSyncSupersedeMessage,
  mapPropagationSyncError,
  PROPAGATION_SYNC_SUPERSEDED,
};

/**
 * Outcome of a single propagation sync attempt once it stops being in flight.
 * `cancelled` is the user pressing Cancel — a cascade must stop rather than advance.
 */
export type PropagationAttemptOutcome = 'success' | 'failed' | 'cancelled' | 'deferred';

/**
 * Backstop for {@link awaitPropagationSyncSettled}. The stall/ceiling watchdogs settle a
 * real attempt well before this; it only covers a dropped websocket stream.
 */
const RETICULUM_PROPAGATION_SYNC_SETTLE_TIMEOUT_MS = RETICULUM_PROPAGATION_SYNC_CEILING_MS + 15_000;

function classifySettledPropagationSync(lastSyncError: string | null): PropagationAttemptOutcome {
  if (lastSyncError == null) return 'success';
  // Supersede keeps a quiet marker (not null) so settle does not look like success.
  if (lastSyncError === SYNC_CANCELLED_KEY || isPropagationSyncSupersedeMessage(lastSyncError)) {
    return 'cancelled';
  }
  return 'failed';
}

/**
 * Resolve once the in-flight sync attempt goes idle.
 *
 * `startSync` only reports that the sidecar *accepted* the request; the real outcome arrives
 * later on the `propagation_sync` websocket stream or from the stall/ceiling watchdogs. A
 * cascade must wait for that before deciding whether to try the next node.
 */
export async function awaitPropagationSyncSettled(opts?: {
  timeoutMs?: number;
}): Promise<PropagationAttemptOutcome> {
  const store = useReticulumPropagationStore;
  const initial = store.getState();
  // local-prop settles inside startSync, and a fast failure may already have landed.
  if (!initial.sync.active) return classifySettledPropagationSync(initial.lastSyncError);

  const timeoutMs = opts?.timeoutMs ?? RETICULUM_PROPAGATION_SYNC_SETTLE_TIMEOUT_MS;
  return new Promise<PropagationAttemptOutcome>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (outcome: PropagationAttemptOutcome) => {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      unsubscribe?.();
      resolve(outcome);
    };

    timer = setTimeout(() => {
      timer = null;
      // Sidecar never reported a terminal frame — release the sync so the cascade continues.
      // Await cancel so lastSyncError is stamped before the cascade reads outcome/UI state.
      void store
        .getState()
        .cancelSync({ reasonKey: SYNC_TIMED_OUT_KEY })
        .finally(() => {
          finish('failed');
        });
    }, timeoutMs);

    unsubscribe = store.subscribe((state) => {
      if (state.sync.active) return;
      finish(classifySettledPropagationSync(state.lastSyncError));
    });

    // The terminal frame can land between the initial read and the subscription.
    const current = store.getState();
    if (!current.sync.active) {
      finish(classifySettledPropagationSync(current.lastSyncError));
    }
  });
}

/** Sidecar uses 0–1 for in-progress states and 0–100 for complete. */
export function normalizePropagationSyncProgress(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (raw <= 1) return raw * 100;
  return Math.min(100, raw);
}

export function propagationSyncStatusLabel(progress: number): string {
  if (progress < RETICULUM_PROPAGATION_SYNC_ESTABLISHING_MAX_PROGRESS) {
    return 'reticulumPropagation.syncStatusEstablishing';
  }
  if (progress < 50) return 'reticulumPropagation.syncStatusNegotiating';
  return 'reticulumPropagation.syncStatusTransferring';
}

export function applyPropagationSyncEvent(payload: {
  progress?: number;
  active?: boolean;
  message?: string | null;
}): void {
  const normalizedProgress = normalizePropagationSyncProgress(payload.progress ?? 0);
  const state = useReticulumPropagationStore.getState();
  const wasActive = state.sync.active;
  const quietSupersede = isPropagationSyncSupersedeMessage(payload.message);
  const cancelMessage = isPropagationSyncCancelledMessage(payload.message);

  // Late cancel/supersede after we already settled (e.g. local-prop) must not re-fail UI.
  if (
    payload.active === false &&
    normalizedProgress === 0 &&
    !wasActive &&
    (quietSupersede || cancelMessage)
  ) {
    return;
  }

  if (payload.active === false && normalizedProgress === 0 && wasActive) {
    clearPropagationSyncStallWatchdog();
    const mapped = mapPropagationSyncError(payload.message);
    useReticulumPropagationStore.setState({
      sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
      // Keep the supersede marker (quiet for UI) so settle classifies non-success.
      lastSyncError: quietSupersede ? PROPAGATION_SYNC_SUPERSEDED : mapped,
      activePropagationSyncAttemptAt: null,
    });
    return;
  }

  if (payload.active === false && normalizedProgress >= 100) {
    clearPropagationSyncStallWatchdog();
    const current = useReticulumPropagationStore.getState();
    const hadError = current.lastSyncError;
    const forAttemptAt = current.activePropagationSyncAttemptAt;
    // Ignore late "complete" frames after user cancel / failure already cleared active.
    if (!wasActive && hadError) {
      return;
    }
    useReticulumPropagationStore.getState().setSyncState({ ...RETICULUM_PROPAGATION_SYNC_IDLE });
    if (!hadError) {
      useReticulumPropagationStore.getState().setLastPropagationSyncAt(Date.now(), forAttemptAt);
    } else {
      useReticulumPropagationStore.setState({ activePropagationSyncAttemptAt: null });
    }
    return;
  }

  useReticulumPropagationStore.getState().setSyncState({
    active: payload.active ?? true,
    progress: normalizedProgress,
    message: payload.message ?? null,
  });
}
