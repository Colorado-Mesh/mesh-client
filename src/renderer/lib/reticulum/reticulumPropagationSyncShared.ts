/**
 * Store-independent propagation sync error mapping and idle state.
 * Kept separate from reticulumPropagationSync.ts so the store can import it
 * without creating a store ↔ sync cycle.
 */
/** Cancel sync when stuck in the Establishing progress band past this window. */
export const RETICULUM_PROPAGATION_SYNC_STALL_MS = 45_000;

/** Hard ceiling for any in-flight propagation sync (includes transfer). */
export const RETICULUM_PROPAGATION_SYNC_CEILING_MS = 180_000;

/** Match sidecar Establishing (~10) — do not cancel once negotiation/transfer starts. */
export const RETICULUM_PROPAGATION_SYNC_ESTABLISHING_MAX_PROGRESS = 15;

/** True while progress is still in the Establishing band. */
export function isPropagationSyncStillEstablishing(progress: number): boolean {
  return progress < RETICULUM_PROPAGATION_SYNC_ESTABLISHING_MAX_PROGRESS;
}

const SYNC_FAILED_KEY = 'reticulumPropagation.syncFailed';
export const SYNC_TIMED_OUT_KEY = 'reticulumPropagation.syncTimedOut';
export const SYNC_CANCELLED_KEY = 'reticulumPropagation.syncCancelled';
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
const SYNC_ESTABLISH_IDENTITY_KEY = 'reticulumPropagation.syncEstablishIdentityMissing';
const SYNC_ESTABLISH_INVALID_KEY = 'reticulumPropagation.syncEstablishInvalidProof';
const SYNC_ESTABLISH_NO_PROOF_KEY = 'reticulumPropagation.syncEstablishNoLinkProof';
/** Link establishment timed out — PN slow/unreachable; cascade may try other remotes. */
const SYNC_ESTABLISH_TIMEOUT_KEY = 'reticulumPropagation.syncEstablishTimeout';
const SYNC_REQUEST_FAILED_KEY = 'reticulumPropagation.syncRequestFailed';
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
  LinkEstablishTimeout: SYNC_ESTABLISH_TIMEOUT_KEY,
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
  if (/^propagation request failed:/i.test(error)) return SYNC_REQUEST_FAILED_KEY;
  return null;
}

function mapPropagationSyncErrorBySubstring(error: string): string | null {
  if (error.includes('LrproofIdentityMissing')) return SYNC_ESTABLISH_IDENTITY_KEY;
  if (error.includes('LrproofInvalid')) return SYNC_ESTABLISH_INVALID_KEY;
  if (error.includes('LinkEstablishTimeout')) return SYNC_ESTABLISH_TIMEOUT_KEY;
  if (error.includes('NoLinkProof')) return SYNC_ESTABLISH_NO_PROOF_KEY;
  if (/propagation node unreachable/i.test(error)) return SYNC_FAILED_KEY;
  return null;
}

/** Soft-defer codes: clear lastSyncError, skip 15‑min backoff, cascade may retry. */
const PROPAGATION_SYNC_SOFT_DEFER_ERRORS = [
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
