/**
 * Per-hub cooldown / give-up for RRC hub auto-join after handshake failures.
 * Prevents forever re-connect when WELCOME never arrives (will_reconnect=false clears session;
 * auto-join would otherwise re-queue every ~21s).
 * Cleared on successful link or explicit Connect. In-memory only.
 */

import { MS_PER_MINUTE, MS_PER_SECOND } from '@/shared/timeConstants';

/** Consecutive auto-join failures before sticky give-up until manual Connect. */
export const RRC_AUTO_JOIN_GIVE_UP_AFTER = 5;

/** Cooldown steps: 30s → 60s → 120s → 300s → 900s (cap). */
const RRC_AUTO_JOIN_COOLDOWN_STEPS_MS = [
  30 * MS_PER_SECOND,
  60 * MS_PER_SECOND,
  120 * MS_PER_SECOND,
  5 * MS_PER_MINUTE,
  15 * MS_PER_MINUTE,
] as const;

interface HubBackoffState {
  consecutiveFailures: number;
  /** Exclusive: blocked while Date.now() < nextEligibleAtMs. 0 when given up (always blocked). */
  nextEligibleAtMs: number;
  givenUp: boolean;
  lastFailureAtMs: number;
}

const byHub = new Map<string, HubBackoffState>();

/** Same WELCOME failure often arrives via HTTP reject and rrc.disconnected — count once. */
const RRC_AUTO_JOIN_FAILURE_COALESCE_MS = 5 * MS_PER_SECOND;

function normHub(hub: string): string {
  return hub.trim().toLowerCase();
}

function cooldownMsForFailureCount(consecutiveFailures: number): number {
  const idx = Math.min(
    Math.max(consecutiveFailures - 1, 0),
    RRC_AUTO_JOIN_COOLDOWN_STEPS_MS.length - 1,
  );
  return RRC_AUTO_JOIN_COOLDOWN_STEPS_MS[idx] ?? RRC_AUTO_JOIN_COOLDOWN_STEPS_MS[0];
}

/** True when auto-join should skip this hub (cooldown or sticky give-up). */
export function isRrcHubAutoJoinBlocked(hub: string, nowMs = Date.now()): boolean {
  const h = normHub(hub);
  if (!h) return false;
  const state = byHub.get(h);
  if (!state) return false;
  if (state.givenUp) return true;
  return nowMs < state.nextEligibleAtMs;
}

export function recordRrcHubAutoJoinFailure(hub: string, nowMs = Date.now()): void {
  const h = normHub(hub);
  if (!h) return;
  const prev = byHub.get(h);
  if (prev && nowMs - prev.lastFailureAtMs < RRC_AUTO_JOIN_FAILURE_COALESCE_MS) {
    return;
  }
  const consecutiveFailures = (prev?.consecutiveFailures ?? 0) + 1;
  if (consecutiveFailures >= RRC_AUTO_JOIN_GIVE_UP_AFTER) {
    byHub.set(h, {
      consecutiveFailures,
      nextEligibleAtMs: 0,
      givenUp: true,
      lastFailureAtMs: nowMs,
    });
    return;
  }
  byHub.set(h, {
    consecutiveFailures,
    nextEligibleAtMs: nowMs + cooldownMsForFailureCount(consecutiveFailures),
    givenUp: false,
    lastFailureAtMs: nowMs,
  });
}

export function clearRrcHubAutoJoinBackoff(hub: string): void {
  const h = normHub(hub);
  if (!h) return;
  byHub.delete(h);
}

/**
 * Sidecar disconnect / HTTP reasons that should back off auto-join when will_reconnect=false.
 * Excludes local_disconnect / cancel (user or superseded connect) and listen-first
 * "requires live rns-stack" (HTTP up before attach_live finishes — retry, do not cool down).
 */
export function isRrcLinkProofNotReadyError(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /link proof|timed out waiting for link/i.test(reason);
}

export function isRrcPathNotReadyError(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /path not ready/i.test(reason);
}

export function isRrcAutoJoinBackoffWorthyReason(reason: string | null | undefined): boolean {
  if (!reason) return true; // unknown initial-connect failure — still back off
  if (/local_disconnect/i.test(reason)) return false;
  if (/cancelled/i.test(reason)) return false;
  if (isRrcLiveNotReadyError(reason)) return false;
  if (isRrcLinkProofNotReadyError(reason)) return false;
  if (isRrcPathNotReadyError(reason)) return false;
  return true;
}

/** True when connect failed only because attach_live has not finished yet. */
export function isRrcLiveNotReadyError(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /requires live rns-stack/i.test(reason);
}

export function resetRrcHubAutoJoinBackoffForTests(): void {
  byHub.clear();
}

/** Test helper — inspect cooldown after N failures without waiting. */
export function rrcHubAutoJoinCooldownMsForFailureCountForTests(
  consecutiveFailures: number,
): number {
  return cooldownMsForFailureCount(consecutiveFailures);
}
