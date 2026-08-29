/**
 * Announce-triggered auto-resend of failed LXMF messages (opt-in).
 *
 * An announce from a peer means a fresh path may exist, so failed sends to that peer
 * get one more attempt. Guarded by a per-destination cooldown and an in-flight lock so
 * an announce burst cannot fan out into a send storm.
 */
import { MS_PER_MINUTE } from '@/shared/timeConstants';

import type { IdentityId } from '../types';
import { findFailedReticulumOutboundForDest } from './reticulumOutboundFailureBridge';

/** Minimum spacing between auto-resend attempts for the same destination. */
export const RETICULUM_AUTO_RESEND_COOLDOWN_MS = 5 * MS_PER_MINUTE;

/** Cap on messages resent per announce so a large backlog cannot flood the link. */
export const RETICULUM_AUTO_RESEND_MAX_PER_ANNOUNCE = 10;

/** Bound on tracked destinations; oldest entries are dropped when exceeded. */
const COOLDOWN_MAX_ENTRIES = 500;

/** destination hash → last auto-resend attempt time (ms). */
const lastAttemptAt = new Map<string, number>();
const inFlight = new Set<string>();

export interface ResendFailedReticulumOptions {
  identityId: IdentityId | null;
  destinationHash: string;
  /** The auto-resend setting; when false this is a no-op. */
  enabled: boolean;
  /**
   * Issues one resend. `retryOfStoreId` must be forwarded so the prior SQLite row is
   * rekeyed rather than orphaned (see `shouldDeletePriorReticulumOutboundHash`).
   */
  send: (text: string, destination: number, retryOfStoreId: string) => void;
  now?: number;
}

/** Test seam: drop cooldown and in-flight state. */
export function resetReticulumAutoResendState(): void {
  lastAttemptAt.clear();
  inFlight.clear();
}

function normalize(hash: string): string {
  return hash.replace(/[^0-9a-f]/gi, '').toLowerCase();
}

function recordAttempt(key: string, now: number): void {
  if (lastAttemptAt.size >= COOLDOWN_MAX_ENTRIES && !lastAttemptAt.has(key)) {
    // Lazy eviction: Map preserves insertion order, so the first key is the oldest.
    const oldest = lastAttemptAt.keys().next();
    if (!oldest.done) lastAttemptAt.delete(oldest.value);
  }
  lastAttemptAt.set(key, now);
}

/**
 * Resend failed messages for one destination. Returns the number of resends issued
 * (0 when disabled, cooling down, already running, or nothing failed).
 */
export function resendFailedReticulumForDestination({
  identityId,
  destinationHash,
  enabled,
  send,
  now = Date.now(),
}: ResendFailedReticulumOptions): number {
  if (!enabled || !identityId) return 0;
  const key = normalize(destinationHash);
  if (key.length !== 32) return 0;
  if (inFlight.has(key)) return 0;

  const last = lastAttemptAt.get(key);
  if (last !== undefined && now - last < RETICULUM_AUTO_RESEND_COOLDOWN_MS) return 0;

  const failed = findFailedReticulumOutboundForDest(identityId, destinationHash);
  if (failed.length === 0) return 0;

  inFlight.add(key);
  try {
    recordAttempt(key, now);
    const batch = failed.slice(0, RETICULUM_AUTO_RESEND_MAX_PER_ANNOUNCE);
    console.debug(
      `[reticulumAutoResend] resending ${String(batch.length)} of ${String(failed.length)} failed messages`,
    );
    for (const msg of batch) {
      send(msg.payload, msg.to, msg.id);
    }
    return batch.length;
  } finally {
    inFlight.delete(key);
  }
}
