import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

/** Keep refresh affordance visible long enough to perceive (~10ms API otherwise). */
export const RETICULUM_PROPAGATION_REFRESH_MIN_VISIBLE_MS = 500;

/** Cancel sync when stuck establishing connection to an unreachable node. */
export const RETICULUM_PROPAGATION_SYNC_STALL_MS = 60_000;

const SYNC_FAILED_KEY = 'reticulumPropagation.syncFailed';
const SYNC_TIMED_OUT_KEY = 'reticulumPropagation.syncTimedOut';

let syncStallTimer: ReturnType<typeof setTimeout> | null = null;

export function clearPropagationSyncStallWatchdog(): void {
  if (syncStallTimer) {
    clearTimeout(syncStallTimer);
    syncStallTimer = null;
  }
}

export function schedulePropagationSyncStallWatchdog(): void {
  clearPropagationSyncStallWatchdog();
  syncStallTimer = setTimeout(() => {
    syncStallTimer = null;
    const { sync } = useReticulumPropagationStore.getState();
    if (!sync.active) return;
    void useReticulumPropagationStore.getState().cancelSync();
    useReticulumPropagationStore.getState().setLastSyncError(SYNC_TIMED_OUT_KEY);
    useReticulumPropagationStore.getState().setSyncState({
      active: false,
      progress: 0,
      message: null,
    });
  }, RETICULUM_PROPAGATION_SYNC_STALL_MS);
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
    useReticulumPropagationStore.getState().setSyncState({
      active: false,
      progress: 0,
      message: null,
    });
    useReticulumPropagationStore.getState().setLastSyncError(SYNC_FAILED_KEY);
    return;
  }

  if (payload.active === false && normalizedProgress >= 100) {
    clearPropagationSyncStallWatchdog();
    const hadError = useReticulumPropagationStore.getState().lastSyncError;
    useReticulumPropagationStore.getState().setSyncState({
      active: false,
      progress: 0,
      message: null,
    });
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
