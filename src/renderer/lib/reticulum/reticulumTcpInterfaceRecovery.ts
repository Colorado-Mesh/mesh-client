import { MS_PER_MINUTE, MS_PER_SECOND } from '@/shared/timeConstants';

import {
  isReticulumInterfaceOnlineStatus,
  isReticulumRemoteInterfaceType,
} from './reticulumLocalInterfaceHealth';

/** Consecutive probe-ok / sidecar-down polls before auto stack restart. */
export const RETICULUM_TCP_PROBE_SIDECAR_MISMATCH_STREAK = 3;

/** Minimum gap between automatic TCP recovery restarts after a sticky recovery. */
export const RETICULUM_TCP_RECOVERY_COOLDOWN_MS = 5 * MS_PER_MINUTE;

/** Shorter cooldown when a prior recovery did not keep the hub up. */
export const RETICULUM_TCP_RECOVERY_RETRY_COOLDOWN_MS = 90 * MS_PER_SECOND;

/** Window after recovery during which a repeat failure uses the shorter cooldown. */
export const RETICULUM_TCP_RECOVERY_RETRY_WINDOW_MS = 10 * MS_PER_MINUTE;

/** Grace after stack start before mismatch detection runs. */
export const RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS = 30 * MS_PER_SECOND;

export function resolveReticulumTcpRecoveryCooldownMs(
  nowMs: number,
  lastRecoveryAtMs: number,
): number {
  if (lastRecoveryAtMs > 0 && nowMs - lastRecoveryAtMs < RETICULUM_TCP_RECOVERY_RETRY_WINDOW_MS) {
    return RETICULUM_TCP_RECOVERY_RETRY_COOLDOWN_MS;
  }
  return RETICULUM_TCP_RECOVERY_COOLDOWN_MS;
}

/** Hub is actively RST/EOF-looping — auto stack restart will not help. */
export function isReticulumTcpHubActivelyRejecting(
  ifaceName: string,
  alert: { tcpResetByPeer?: string[]; tcpReadEof?: string[] } | null | undefined,
): boolean {
  if (!alert) return false;
  return (
    (alert.tcpResetByPeer?.includes(ifaceName) ?? false) ||
    (alert.tcpReadEof?.includes(ifaceName) ?? false)
  );
}

export interface ReticulumTcpRecoveryRow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: string;
  host?: string | null;
  port?: number | null;
}

/**
 * Host TCP connect succeeded (finite RTT) but the sidecar reports the hub offline.
 * Raw socket reachability ≠ RNS link up; sustained mismatch implies a stuck client.
 */
export function isReticulumTcpProbeSidecarMismatch(
  iface: ReticulumTcpRecoveryRow,
  rttMs: number | null | undefined,
): boolean {
  if (!iface.enabled || !isReticulumRemoteInterfaceType(iface.type)) {
    return false;
  }
  const host = iface.host?.trim();
  const port = iface.port;
  if (!host || typeof port !== 'number' || !Number.isInteger(port) || port <= 0) {
    return false;
  }
  if (isReticulumInterfaceOnlineStatus(iface.status)) {
    return false;
  }
  return typeof rttMs === 'number' && Number.isFinite(rttMs);
}

export function listReticulumTcpProbeSidecarMismatches(
  interfaces: readonly ReticulumTcpRecoveryRow[],
  rttById: ReadonlyMap<string, number | null>,
): ReticulumTcpRecoveryRow[] {
  return interfaces.filter((iface) =>
    isReticulumTcpProbeSidecarMismatch(iface, rttById.get(iface.id)),
  );
}
