import { useEffect, useRef } from 'react';

import { sanitizeLogMessage } from '@/main/sanitize-log-message';
import type { ReticulumInterfaceIssueAlert } from '@/shared/reticulum-types';

import { HOST_LINK_QUALITY_POLL_MS } from '../lib/hostLinkQuality';
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
  const interfacesRef = useRef(interfaces);
  const rttByIdRef = useRef(rttById);
  const interfaceIssueAlertRef = useRef(interfaceIssueAlert);
  const stackFastFlapSuspectedRef = useRef(stackFastFlapSuspected);

  useEffect(() => {
    onRecoverRef.current = onRecover;
  }, [onRecover]);

  useEffect(() => {
    interfacesRef.current = interfaces;
    rttByIdRef.current = rttById;
    interfaceIssueAlertRef.current = interfaceIssueAlert;
    stackFastFlapSuspectedRef.current = stackFastFlapSuspected;
  }, [interfaces, rttById, interfaceIssueAlert, stackFastFlapSuspected]);

  useEffect(() => {
    if (!sidecarReady) {
      readySinceRef.current = null;
      streakByIdRef.current.clear();
      return;
    }
    readySinceRef.current ??= Date.now();
  }, [sidecarReady]);

  useEffect(() => {
    if (!sidecarReady || connecting) {
      return;
    }

    let cancelled = false;
    let postReadyTicks = 0;
    let tickInFlight = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      if (cancelled || recoveryInFlightRef.current || tickInFlight) {
        return;
      }
      if (postReadyTicks >= RETICULUM_TCP_PROBE_SIDECAR_MISMATCH_STREAK) {
        return;
      }
      tickInFlight = true;
      postReadyTicks += 1;
      try {
        const snapshotRows = interfacesRef.current;
        const storedRttById = rttByIdRef.current;
        // Bypass the 5s interfaces cache — stale "up" must not mask a live down row.
        // bypassCache failures rethrow; fall back to the snapshot the panel already has.
        let statusRows: readonly ReticulumTcpRecoveryRow[] = snapshotRows;
        try {
          statusRows = await fetchReticulumInterfaces({ bypassCache: true });
        } catch {
          // catch-no-log-ok use snapshot rows when the live fetch fails
          statusRows = snapshotRows;
        }
        if (cancelled) return;

        const mismatches = listReticulumTcpProbeSidecarMismatches(statusRows, storedRttById);
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
          stackFastFlapSuspectedRef.current ||
          isReticulumTcpHubActivelyRejecting(worst.iface.name, interfaceIssueAlertRef.current)
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
          `[Reticulum] TCP hub "${sanitizeLogMessage(worst.iface.name)}" reachable but sidecar link is down — restarting stack`,
        );

        try {
          await onRecoverRef.current();
        } catch (err: unknown) {
          console.warn(
            '[Reticulum] TCP interface auto-recovery restart failed:',
            err instanceof Error ? err.message : String(err),
          );
        } finally {
          recoveryInFlightRef.current = false;
          if (!cancelled) {
            readySinceRef.current = Date.now();
          }
        }
      } finally {
        tickInFlight = false;
      }
    };

    const startPolling = () => {
      if (cancelled) return;
      void tick();
      interval = setInterval(() => {
        void tick();
      }, HOST_LINK_QUALITY_POLL_MS);
    };

    const readySince = readySinceRef.current ?? Date.now();
    const graceRemaining = Math.max(
      0,
      RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS - (Date.now() - readySince),
    );
    const graceTimer = setTimeout(startPolling, graceRemaining);

    return () => {
      cancelled = true;
      clearTimeout(graceTimer);
      if (interval) clearInterval(interval);
    };
  }, [sidecarReady, connecting]);
}
