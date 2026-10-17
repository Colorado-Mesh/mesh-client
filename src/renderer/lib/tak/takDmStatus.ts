import type { TakDmOutcome } from '@/shared/tak-types';

import { subscribeAutoResendOutcomes } from '../autoResend/autoResendController';
import { errLikeToLogString } from '../errLikeToLogString';
import type { IdentityId } from '../types';

/**
 * How long a direct message from a TAK client is watched. Its automatic resends are over within
 * about five minutes; main gives up waiting at the same point.
 */
const WATCH_TTL_MS = 30 * 60 * 1000;
const WATCH_MAX = 256;

/** Direct messages from TAK clients being watched, by identity and first store id, oldest first. */
const watched = new Map<string, { dmRef: string; sinceMs: number }>();

function watchKey(identityId: IdentityId, storeId: string): string {
  return `${identityId}:${storeId}`;
}

/** Tell main how a TAK client's direct message ended, so its device hears about it. */
export function reportTakDmOutcome(dmRef: string, outcome: TakDmOutcome): void {
  window.electronAPI.tak.dmStatus({ dmRef, outcome }).catch((e: unknown) => {
    console.warn('[TakDmStatus] dmStatus failed ' + errLikeToLogString(e));
  });
}

/**
 * Watch a direct message a TAK client sent, stored as `storeId` on `identityId`, until its
 * automatic resends end: acknowledged, or still not after the last one.
 */
export function watchTakDirectMessage(
  identityId: IdentityId,
  storeId: string,
  dmRef: string,
): void {
  const now = Date.now();
  for (const [key, entry] of watched) {
    if (now - entry.sinceMs < WATCH_TTL_MS && watched.size < WATCH_MAX) break;
    watched.delete(key);
  }
  watched.set(watchKey(identityId, storeId), { dmRef, sinceMs: now });
}

/**
 * Report the outcome of each watched direct message to main as the resend controller settles
 * it. Mount once while TAK chat runs; returns a teardown.
 */
export function startTakDmStatus(): () => void {
  return subscribeAutoResendOutcomes((event) => {
    const key = watchKey(event.identityId, event.originId);
    const entry = watched.get(key);
    if (!entry) return;
    watched.delete(key);
    reportTakDmOutcome(entry.dmRef, event.outcome === 'acked' ? 'delivered' : 'unconfirmed');
  });
}

/** Forget watched messages; for tests. */
export function resetTakDmStatus(): void {
  watched.clear();
}
