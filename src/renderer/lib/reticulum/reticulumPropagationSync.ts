import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

/** Keep refresh affordance visible long enough to perceive (~10ms API otherwise). */
export const RETICULUM_PROPAGATION_REFRESH_MIN_VISIBLE_MS = 500;

/** Cancel sync when stuck establishing connection to an unreachable node. */
export const RETICULUM_PROPAGATION_SYNC_STALL_MS = 60_000;

/** Hard ceiling for any in-flight propagation sync (includes transfer). */
export const RETICULUM_PROPAGATION_SYNC_CEILING_MS = 180_000;

/** Match sidecar Establishing (~10) — do not cancel once negotiation/transfer starts. */
export const RETICULUM_PROPAGATION_SYNC_ESTABLISHING_MAX_PROGRESS = 15;

const SYNC_FAILED_KEY = 'reticulumPropagation.syncFailed';
const SYNC_TIMED_OUT_KEY = 'reticulumPropagation.syncTimedOut';
const SYNC_LOCAL_UNSUPPORTED_KEY = 'reticulumPropagation.syncLocalNotSupported';
const SYNC_IDENTITY_UNKNOWN_KEY = 'reticulumPropagation.syncIdentityUnknown';
const SYNC_TARGET_NOT_PN_KEY = 'reticulumPropagation.syncTargetNotPropagationNode';
const SYNC_PEERAGE_STAMP_FAILED_KEY = 'reticulumPropagation.syncPeeringStampFailed';

/** Idle sync blob shared by cancel / complete / failure paths. */
export const RETICULUM_PROPAGATION_SYNC_IDLE = {
  active: false,
  progress: 0,
  message: null,
} as const;

/** Map sidecar/API sync error codes to i18n keys. */
export function mapPropagationSyncError(error: string | null | undefined): string {
  if (!error) return SYNC_FAILED_KEY;
  if (error === 'LOCAL_PROPAGATION_SYNC_UNSUPPORTED') return SYNC_LOCAL_UNSUPPORTED_KEY;
  if (
    error === 'PROPAGATION_IDENTITY_UNKNOWN' ||
    error.startsWith('PROPAGATION_IDENTITY_UNKNOWN:')
  ) {
    return SYNC_IDENTITY_UNKNOWN_KEY;
  }
  if (error === 'PROPAGATION_TARGET_NOT_PN') return SYNC_TARGET_NOT_PN_KEY;
  if (
    error === 'PROPAGATION_PEERING_STAMP_FAILED' ||
    error.startsWith('PROPAGATION_PEERING_STAMP_FAILED:')
  ) {
    return SYNC_PEERAGE_STAMP_FAILED_KEY;
  }
  return SYNC_FAILED_KEY;
}

let syncStallTimer: ReturnType<typeof setTimeout> | null = null;
let syncCeilingTimer: ReturnType<typeof setTimeout> | null = null;

export function clearPropagationSyncStallWatchdog(): void {
  if (syncStallTimer) {
    clearTimeout(syncStallTimer);
    syncStallTimer = null;
  }
  if (syncCeilingTimer) {
    clearTimeout(syncCeilingTimer);
    syncCeilingTimer = null;
  }
}

export function schedulePropagationSyncStallWatchdog(): void {
  clearPropagationSyncStallWatchdog();
  syncStallTimer = setTimeout(() => {
    syncStallTimer = null;
    const { sync } = useReticulumPropagationStore.getState();
    if (!sync.active) return;
    // Progress past Establishing means link+offer are in flight; lxmf-core owns the
    // remaining timeout (120s). Canceling here aborts healthy multi-hop syncs.
    if (sync.progress >= RETICULUM_PROPAGATION_SYNC_ESTABLISHING_MAX_PROGRESS) {
      return;
    }
    void useReticulumPropagationStore.getState().cancelSync();
    useReticulumPropagationStore.getState().setLastSyncError(SYNC_TIMED_OUT_KEY);
    useReticulumPropagationStore.getState().setSyncState({ ...RETICULUM_PROPAGATION_SYNC_IDLE });
  }, RETICULUM_PROPAGATION_SYNC_STALL_MS);

  syncCeilingTimer = setTimeout(() => {
    syncCeilingTimer = null;
    const { sync } = useReticulumPropagationStore.getState();
    if (!sync.active) return;
    void useReticulumPropagationStore.getState().cancelSync();
    useReticulumPropagationStore.getState().setLastSyncError(SYNC_TIMED_OUT_KEY);
    useReticulumPropagationStore.getState().setSyncState({ ...RETICULUM_PROPAGATION_SYNC_IDLE });
  }, RETICULUM_PROPAGATION_SYNC_CEILING_MS);
}

/** Sidecar uses 0–1 for in-progress states and 0–100 for complete. */
export function normalizePropagationSyncProgress(raw: number): number {
  if (!Number.isFinite(raw) || raw < 0) return 0;
  if (raw <= 1) return raw * 100;
  return Math.min(100, raw);
}

export function propagationSyncStatusLabel(progress: number): string {
  if (progress < 15) return 'reticulumPropagation.syncStatusEstablishing';
  if (progress < 50) return 'reticulumPropagation.syncStatusNegotiating';
  return 'reticulumPropagation.syncStatusTransferring';
}

export function applyPropagationSyncEvent(payload: {
  progress?: number;
  active?: boolean;
  message?: string | null;
}): void {
  const normalizedProgress = normalizePropagationSyncProgress(payload.progress ?? 0);
  const wasActive = useReticulumPropagationStore.getState().sync.active;

  if (payload.active === false && normalizedProgress === 0 && wasActive) {
    clearPropagationSyncStallWatchdog();
    useReticulumPropagationStore.getState().setSyncState({ ...RETICULUM_PROPAGATION_SYNC_IDLE });
    useReticulumPropagationStore.getState().setLastSyncError(SYNC_FAILED_KEY);
    return;
  }

  if (payload.active === false && normalizedProgress >= 100) {
    clearPropagationSyncStallWatchdog();
    const state = useReticulumPropagationStore.getState();
    const hadError = state.lastSyncError;
    // Ignore late "complete" frames after user cancel / failure already cleared active.
    if (!wasActive && hadError) {
      return;
    }
    useReticulumPropagationStore.getState().setSyncState({ ...RETICULUM_PROPAGATION_SYNC_IDLE });
    if (!hadError) {
      useReticulumPropagationStore.getState().setLastPropagationSyncAt(Date.now());
    }
    return;
  }

  useReticulumPropagationStore.getState().setSyncState({
    active: payload.active ?? true,
    progress: normalizedProgress,
    message: payload.message ?? null,
  });
}
