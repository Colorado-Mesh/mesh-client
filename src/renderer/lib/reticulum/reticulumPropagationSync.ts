import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

/** Keep refresh affordance visible long enough to perceive (~10ms API otherwise). */
export const RETICULUM_PROPAGATION_REFRESH_MIN_VISIBLE_MS = 500;

/** Cancel sync when stuck establishing connection to an unreachable node. */
export const RETICULUM_PROPAGATION_SYNC_STALL_MS = 45_000;

/** How long a failed sync keeps the Diagnostics failing row visible. */
export const RETICULUM_PROPAGATION_SYNC_FAILING_DIAGNOSTIC_TTL_MS = 60 * 60 * 1000;

/** Hard ceiling for any in-flight propagation sync (includes transfer). */
export const RETICULUM_PROPAGATION_SYNC_CEILING_MS = 180_000;

/** Match sidecar Establishing (~10) — do not cancel once negotiation/transfer starts. */
export const RETICULUM_PROPAGATION_SYNC_ESTABLISHING_MAX_PROGRESS = 15;

export interface PropagationSyncStuckInput {
  syncActive: boolean;
  syncProgress: number;
  lastAttemptAt: number | null;
}

/** True while progress is still in the Establishing band. */
export function isPropagationSyncStillEstablishing(progress: number): boolean {
  return progress < RETICULUM_PROPAGATION_SYNC_ESTABLISHING_MAX_PROGRESS;
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

const SYNC_FAILED_KEY = 'reticulumPropagation.syncFailed';
const SYNC_TIMED_OUT_KEY = 'reticulumPropagation.syncTimedOut';
const SYNC_LOCAL_UNSUPPORTED_KEY = 'reticulumPropagation.syncLocalNotSupported';
const SYNC_IDENTITY_UNKNOWN_KEY = 'reticulumPropagation.syncIdentityUnknown';
const SYNC_TARGET_NOT_PN_KEY = 'reticulumPropagation.syncTargetNotPropagationNode';
const SYNC_PEERAGE_STAMP_FAILED_KEY = 'reticulumPropagation.syncPeeringStampFailed';
const SYNC_ESTABLISH_IDENTITY_KEY = 'reticulumPropagation.syncEstablishIdentityMissing';
const SYNC_ESTABLISH_INVALID_KEY = 'reticulumPropagation.syncEstablishInvalidProof';
const SYNC_ESTABLISH_NO_PROOF_KEY = 'reticulumPropagation.syncEstablishNoLinkProof';
const SYNC_OFFER_NO_IDENTITY_KEY = 'reticulumPropagation.syncOfferNoIdentity';
const SYNC_OFFER_NO_ACCESS_KEY = 'reticulumPropagation.syncOfferNoAccess';
const SYNC_OFFER_INVALID_KEY_KEY = 'reticulumPropagation.syncOfferInvalidKey';
const SYNC_OFFER_THROTTLED_KEY = 'reticulumPropagation.syncOfferThrottled';
const SYNC_OFFER_INVALID_DATA_KEY = 'reticulumPropagation.syncOfferInvalidData';
const SYNC_OFFER_INVALID_STAMP_KEY = 'reticulumPropagation.syncOfferInvalidStamp';
const SYNC_OFFER_UNKNOWN_KEY = 'reticulumPropagation.syncOfferUnknown';

/** Idle sync blob shared by cancel / complete / failure paths. */
export const RETICULUM_PROPAGATION_SYNC_IDLE = {
  active: false,
  progress: 0,
  message: null,
} as const;

const OFFER_ERROR_KEYS: Record<string, string> = {
  ErrorNoIdentity: SYNC_OFFER_NO_IDENTITY_KEY,
  ErrorNoAccess: SYNC_OFFER_NO_ACCESS_KEY,
  ErrorInvalidKey: SYNC_OFFER_INVALID_KEY_KEY,
  ErrorThrottled: SYNC_OFFER_THROTTLED_KEY,
  ErrorInvalidData: SYNC_OFFER_INVALID_DATA_KEY,
  ErrorInvalidStamp: SYNC_OFFER_INVALID_STAMP_KEY,
  Unknown: SYNC_OFFER_UNKNOWN_KEY,
};

const ESTABLISH_ERROR_KEYS: Record<string, string> = {
  LrproofIdentityMissing: SYNC_ESTABLISH_IDENTITY_KEY,
  LrproofInvalid: SYNC_ESTABLISH_INVALID_KEY,
  LrproofInvalidKey: SYNC_ESTABLISH_INVALID_KEY,
  NoLinkProof: SYNC_ESTABLISH_NO_PROOF_KEY,
};

/** Map sidecar/API sync error codes or WS failure messages to i18n keys. */
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

  const offerMatch = /^propagation offer rejected:\s*(\S+)/i.exec(error);
  if (offerMatch?.[1] && OFFER_ERROR_KEYS[offerMatch[1]]) {
    return OFFER_ERROR_KEYS[offerMatch[1]];
  }

  const establishMatch = /^propagation establish failed:\s*(\S+)/i.exec(error);
  if (establishMatch?.[1] && ESTABLISH_ERROR_KEYS[establishMatch[1]]) {
    return ESTABLISH_ERROR_KEYS[establishMatch[1]];
  }
  if (error.includes('LrproofIdentityMissing')) return SYNC_ESTABLISH_IDENTITY_KEY;
  if (error.includes('LrproofInvalid')) return SYNC_ESTABLISH_INVALID_KEY;
  if (error.includes('NoLinkProof')) return SYNC_ESTABLISH_NO_PROOF_KEY;

  if (/propagation node unreachable/i.test(error)) return SYNC_FAILED_KEY;

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
    if (!isPropagationSyncStillEstablishing(sync.progress)) {
      return;
    }
    void useReticulumPropagationStore.getState().cancelSync({ reasonKey: SYNC_TIMED_OUT_KEY });
  }, RETICULUM_PROPAGATION_SYNC_STALL_MS);

  syncCeilingTimer = setTimeout(() => {
    syncCeilingTimer = null;
    const { sync } = useReticulumPropagationStore.getState();
    if (!sync.active) return;
    void useReticulumPropagationStore.getState().cancelSync({ reasonKey: SYNC_TIMED_OUT_KEY });
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
    useReticulumPropagationStore.setState({
      sync: { ...RETICULUM_PROPAGATION_SYNC_IDLE },
      lastSyncError: mapPropagationSyncError(payload.message),
      activePropagationSyncAttemptAt: null,
    });
    return;
  }

  if (payload.active === false && normalizedProgress >= 100) {
    clearPropagationSyncStallWatchdog();
    const state = useReticulumPropagationStore.getState();
    const hadError = state.lastSyncError;
    const forAttemptAt = state.activePropagationSyncAttemptAt;
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
