import { useEffect, useRef } from 'react';

import type { ReticulumInterfaceIssueAlert } from '@/shared/reticulum-types';

import { fetchReticulumInterfaces } from '../lib/reticulum/reticulumSidecarReads';
import {
  isReticulumTcpHubActivelyRejecting,
  listReticulumTcpProbeSidecarMismatches,
  resolveReticulumTcpRecoveryCooldownMs,
  RETICULUM_TCP_PROBE_SIDECAR_MISMATCH_STREAK,
  RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS,
  type ReticulumTcpRecoveryRow,
} from '../lib/reticulum/reticulumTcpInterfaceRecovery';

export interface UseReticulumTcpInterfaceRecoveryOptions {
  interfaces: readonly ReticulumTcpRecoveryRow[];
  rttById: ReadonlyMap<string, number | null>;
  /** Sidecar HTTP + identity ready (same gate as TCP link-quality probes). */
  sidecarReady: boolean;
  /** Stack is mid connect/restart — skip recovery. */
  connecting: boolean;
  interfaceIssueAlert?: Pick<ReticulumInterfaceIssueAlert, 'tcpResetByPeer' | 'tcpReadEof'> | null;
  /** Skip auto stack restart when this client already triggered hub fast-flap. */
  stackFastFlapSuspected?: boolean;
  onRecover: () => Promise<void>;
}

/**
 * When host TCP probes succeed but RNS TCP client rows stay down, restart the stack
 * (same recovery path as manual Restart stack) after a short sustained mismatch.
 */
export function useReticulumTcpInterfaceRecovery({
  interfaces,
  rttById,
  sidecarReady,
  connecting,
  interfaceIssueAlert,
  stackFastFlapSuspected = false,
  onRecover,
}: UseReticulumTcpInterfaceRecoveryOptions): void {
  const streakByIdRef = useRef<Map<string, number>>(new Map());
  const recoveryInFlightRef = useRef(false);
  const lastRecoveryAtRef = useRef(0);
  const readySinceRef = useRef<number | null>(null);
  const onRecoverRef = useRef(onRecover);

  useEffect(() => {
    onRecoverRef.current = onRecover;
  }, [onRecover]);

  const rttKey = [...rttById.entries()]
    .map(([id, rtt]) => `${id}:${rtt ?? 'null'}`)
    .sort()
    .join('|');

  const lastRttKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sidecarReady) {
      readySinceRef.current = null;
      streakByIdRef.current.clear();
      return;
    }
    readySinceRef.current ??= Date.now();
  }, [sidecarReady]);

  useEffect(() => {
    if (!sidecarReady || connecting || recoveryInFlightRef.current) {
      return;
    }
    if (rttKey === lastRttKeyRef.current) {
      return;
    }
    lastRttKeyRef.current = rttKey;

    let cancelled = false;

    void (async () => {
      const readySince = readySinceRef.current;
      if (readySince != null && Date.now() - readySince < RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS) {
        return;
      }

      // Bypass the 5s interfaces cache — stale "up" masked post-restart regressions in logs.
      let statusRows: readonly ReticulumTcpRecoveryRow[] = interfaces;
      try {
        statusRows = await fetchReticulumInterfaces({ bypassCache: true });
      } catch {
        // catch-no-log-ok fall back to snapshot rows when proxy is rate-limited
      }
      if (cancelled) return;

      const mismatches = listReticulumTcpProbeSidecarMismatches(statusRows, rttById);
      const streakById = streakByIdRef.current;
      const mismatchIds = new Set(mismatches.map((m) => m.id));

      for (const id of [...streakById.keys()]) {
        if (!mismatchIds.has(id)) {
          streakById.delete(id);
        }
      }
      for (const iface of mismatches) {
        streakById.set(iface.id, (streakById.get(iface.id) ?? 0) + 1);
      }

      const worst = mismatches
        .map((iface) => ({ iface, streak: streakById.get(iface.id) ?? 0 }))
        .sort((a, b) => b.streak - a.streak)[0];

      if (!worst || worst.streak < RETICULUM_TCP_PROBE_SIDECAR_MISMATCH_STREAK) {
        return;
      }

      if (
        stackFastFlapSuspected ||
        isReticulumTcpHubActivelyRejecting(worst.iface.name, interfaceIssueAlert)
      ) {
        return;
      }

      const now = Date.now();
      const cooldownMs = resolveReticulumTcpRecoveryCooldownMs(now, lastRecoveryAtRef.current);
      const sinceLastRecovery = now - lastRecoveryAtRef.current;
      if (lastRecoveryAtRef.current > 0 && sinceLastRecovery < cooldownMs) {
        return;
      }

      recoveryInFlightRef.current = true;
      lastRecoveryAtRef.current = now;
      streakByIdRef.current.clear();

      console.warn(
        `[Reticulum] TCP hub "${worst.iface.name}" reachable but sidecar link is down — restarting stack`,
      );

      try {
        await onRecoverRef.current();
      } catch (err: unknown) {
        console.warn(
          '[Reticulum] TCP interface auto-recovery restart failed:',
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        if (!cancelled) {
          recoveryInFlightRef.current = false;
          readySinceRef.current = Date.now();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    interfaces,
    rttById,
    rttKey,
    sidecarReady,
    connecting,
    interfaceIssueAlert,
    stackFastFlapSuspected,
  ]);
}
