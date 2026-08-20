import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

/** Keep refresh affordance visible long enough to perceive (~10ms API otherwise). */
export const RETICULUM_PROPAGATION_REFRESH_MIN_VISIBLE_MS = 500;

/** Cancel sync when stuck in the Establishing progress band past this window. */
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
const SYNC_CANCELLED_KEY = 'reticulumPropagation.syncCancelled';
const SYNC_LOCAL_UNSUPPORTED_KEY = 'reticulumPropagation.syncLocalNotSupported';

/** Sidecar cancel when replacing/deleting a PN — not a user-visible failure. */
export const PROPAGATION_SYNC_SUPERSEDED = 'PROPAGATION_SYNC_SUPERSEDED';

export function isPropagationSyncSupersedeMessage(message: string | null | undefined): boolean {
  return message === PROPAGATION_SYNC_SUPERSEDED;
}

export function isPropagationSyncCancelledMessage(message: string | null | undefined): boolean {
  return typeof message === 'string' && /propagation sync cancelled/i.test(message);
}
const SYNC_IDENTITY_UNKNOWN_KEY = 'reticulumPropagation.syncIdentityUnknown';
const SYNC_TARGET_NOT_PN_KEY = 'reticulumPropagation.syncTargetNotPropagationNode';
const SYNC_PATH_UNKNOWN_KEY = 'reticulumPropagation.syncPathUnknown';
const SYNC_PEERAGE_STAMP_FAILED_KEY = 'reticulumPropagation.syncPeeringStampFailed';
export const SYNC_ESTABLISH_IDENTITY_KEY = 'reticulumPropagation.syncEstablishIdentityMissing';
export const SYNC_ESTABLISH_INVALID_KEY = 'reticulumPropagation.syncEstablishInvalidProof';
export const SYNC_ESTABLISH_NO_PROOF_KEY = 'reticulumPropagation.syncEstablishNoLinkProof';
const SYNC_OFFER_NO_IDENTITY_KEY = 'reticulumPropagation.syncOfferNoIdentity';
const SYNC_OFFER_NO_ACCESS_KEY = 'reticulumPropagation.syncOfferNoAccess';
const SYNC_OFFER_INVALID_KEY_KEY = 'reticulumPropagation.syncOfferInvalidKey';
const SYNC_OFFER_THROTTLED_KEY = 'reticulumPropagation.syncOfferThrottled';
const SYNC_OFFER_INVALID_DATA_KEY = 'reticulumPropagation.syncOfferInvalidData';
const SYNC_OFFER_INVALID_STAMP_KEY = 'reticulumPropagation.syncOfferInvalidStamp';
const SYNC_PEER_COST_EXCEEDS_MAX_KEY = 'reticulumPropagation.syncPeerCostExceedsMax';
const SYNC_OFFER_UNSUPPORTED_KEY = 'reticulumPropagation.offerUnsupported';
const SYNC_OFFER_PROBE_TIMEOUT_KEY = 'reticulumPropagation.offerProbeTimeout';
const SYNC_OFFER_PROBE_FAILED_KEY = 'reticulumPropagation.offerProbeFailed';
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

function mapPropagationSyncErrorByPrefix(error: string): string | null {
  if (
    error === 'PROPAGATION_IDENTITY_UNKNOWN' ||
    error.startsWith('PROPAGATION_IDENTITY_UNKNOWN:')
  ) {
    return SYNC_IDENTITY_UNKNOWN_KEY;
  }
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
  return null;
}

function mapPropagationSyncErrorBySubstring(error: string): string | null {
  if (error.includes('LrproofIdentityMissing')) return SYNC_ESTABLISH_IDENTITY_KEY;
  if (error.includes('LrproofInvalid')) return SYNC_ESTABLISH_INVALID_KEY;
  if (error.includes('NoLinkProof')) return SYNC_ESTABLISH_NO_PROOF_KEY;
  if (/propagation node unreachable/i.test(error)) return SYNC_FAILED_KEY;
  return null;
}

/** Soft-defer codes: clear lastSyncError, skip 15‑min backoff, cascade may retry. */
export const PROPAGATION_SYNC_SOFT_DEFER_ERRORS = [
  'PROPAGATION_SYNC_OUTBOUND_BUSY',
  'PROPAGATION_RETRIEVE_BUSY',
  'PROPAGATION_STACK_NOT_LIVE',
  'RNS stack not live',
] as const;

export function isPropagationSyncSoftDeferError(error: string | null | undefined): boolean {
  if (!error) return false;
  return (PROPAGATION_SYNC_SOFT_DEFER_ERRORS as readonly string[]).includes(error);
}

/**
 * Map sidecar/API sync error codes or WS failure messages to i18n keys.
 * Returns `null` for quiet supersede (delete/replace) — caller must not show unreachable.
 */
export function mapPropagationSyncError(error: string | null | undefined): string | null {
  if (isPropagationSyncSupersedeMessage(error)) return null;
  if (!error) return SYNC_FAILED_KEY;
  if (isPropagationSyncCancelledMessage(error)) return SYNC_CANCELLED_KEY;
  if (error === 'LOCAL_PROPAGATION_SYNC_UNSUPPORTED') return SYNC_LOCAL_UNSUPPORTED_KEY;
  const byPrefix = mapPropagationSyncErrorByPrefix(error);
  if (byPrefix) return byPrefix;
  if (error === 'PROPAGATION_TARGET_NOT_PN') return SYNC_TARGET_NOT_PN_KEY;
  if (error === 'PROPAGATION_PATH_UNKNOWN') return SYNC_PATH_UNKNOWN_KEY;
  if (error === 'PROPAGATION_PEER_COST_EXCEEDS_MAX') return SYNC_PEER_COST_EXCEEDS_MAX_KEY;
  if (error === 'PROPAGATION_OFFER_UNSUPPORTED') return SYNC_OFFER_UNSUPPORTED_KEY;
  if (error === 'PROPAGATION_OFFER_PROBE_TIMEOUT') return SYNC_OFFER_PROBE_TIMEOUT_KEY;
  if (error === 'PROPAGATION_OFFER_PROBE_FAILED') return SYNC_OFFER_PROBE_FAILED_KEY;
  // Soft conflict with outbound deposit — surface a specific key for diagnostics/UI.
  if (error === 'PROPAGATION_SYNC_OUTBOUND_BUSY') {
    return 'reticulumPropagation.syncOutboundBusy';
  }
  // Client `/get` already active (host silent retrieve / overlapping Sync).
  if (error === 'PROPAGATION_RETRIEVE_BUSY') {
    return 'reticulumPropagation.syncRetrieveBusy';
  }
  // Live attach lag — startSync treats this as deferred; map if it surfaces elsewhere.
  if (error === 'PROPAGATION_STACK_NOT_LIVE' || error === 'RNS stack not live') {
    return 'reticulumPropagation.syncStackNotLive';
  }
  return mapPropagationSyncErrorBySubstring(error) ?? SYNC_FAILED_KEY;
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

/**
 * Outcome of a single propagation sync attempt once it stops being in flight.
 * `cancelled` is the user pressing Cancel — a cascade must stop rather than advance.
 */
export type PropagationAttemptOutcome = 'success' | 'failed' | 'cancelled' | 'deferred';

/**
 * Backstop for {@link awaitPropagationSyncSettled}. The stall/ceiling watchdogs settle a
 * real attempt well before this; it only covers a dropped websocket stream.
 */
export const RETICULUM_PROPAGATION_SYNC_SETTLE_TIMEOUT_MS =
  RETICULUM_PROPAGATION_SYNC_CEILING_MS + 15_000;

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
