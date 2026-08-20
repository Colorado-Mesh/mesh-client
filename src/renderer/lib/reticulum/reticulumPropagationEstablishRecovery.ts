import { MS_PER_SECOND } from '@/shared/timeConstants';

/** Establish-class sync errors — reverse path / LRPROOF on this client, not a bad PN. */
export const CLIENT_LOCAL_PROPAGATION_ESTABLISH_ERROR_KEYS = [
  'reticulumPropagation.syncEstablishNoLinkProof',
  'reticulumPropagation.syncEstablishIdentityMissing',
  'reticulumPropagation.syncEstablishInvalidProof',
] as const;

export type ClientLocalPropagationEstablishErrorKey =
  (typeof CLIENT_LOCAL_PROPAGATION_ESTABLISH_ERROR_KEYS)[number];

/** True when Sync should stop cascading remotes and show the recovery callout. */
export function isClientLocalPropagationEstablishError(
  key: string | null | undefined,
): key is ClientLocalPropagationEstablishErrorKey {
  if (!key) return false;
  return (CLIENT_LOCAL_PROPAGATION_ESTABLISH_ERROR_KEYS as readonly string[]).includes(key);
}

/**
 * Post-announce wait before Retry Sync — matches sidecar
 * `PROPAGATION_SYNC_ANNOUNCE_SETTLE` (10s).
 */
export const PROPAGATION_ESTABLISH_RECOVERY_ANNOUNCE_WAIT_MS = 10 * MS_PER_SECOND;

/** Count enabled TCP interfaces (dual-egress tip when ≥2). */
export function countEnabledTcpInterfaces(
  interfaces: readonly { enabled?: boolean; type?: string }[],
): number {
  let count = 0;
  for (const row of interfaces) {
    if (row.enabled !== true) continue;
    if ((row.type ?? '').toLowerCase() !== 'tcp') continue;
    count += 1;
  }
  return count;
}

export function shouldShowPropagationDualTcpTip(enabledTcpCount: number): boolean {
  return enabledTcpCount >= 2;
}
