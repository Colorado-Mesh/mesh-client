/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNowMs } from '@/renderer/hooks/useNowMs';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { syncReticulumBleRegistry } from '@/renderer/lib/reticulum/reticulumBleAdapterConflict';
import {
  beginReticulumBleConnectGrace,
  getReticulumBleConnectGraceExpiresAt,
  subscribeReticulumBleConnectGrace,
} from '@/renderer/lib/reticulum/reticulumBleConnectGrace';
import type { ReticulumLocalInterfaceHealthOptions } from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { logReticulumLocalInterfaceHealthChanges } from '@/renderer/lib/reticulum/reticulumLocalInterfaceLogging';
import {
  pickReticulumLocalHealthPollMs,
  RETICULUM_LOCAL_HEALTH_POLL_MS,
  scheduleReticulumLocalInterfaceBurst,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh';
import {
  isReticulumProxyRateLimitBackoffActive,
  noteReticulumProxyRateLimitHit,
} from '@/renderer/lib/reticulum/reticulumProxyRateLimitBackoff';
import { reticulumSidecarEventRefreshActions } from '@/renderer/lib/reticulum/reticulumSidecarPeerRefreshEvents';
import {
  fetchReticulumInterfaces,
  fetchReticulumSerialPortOptions,
  getCachedReticulumEffectivePrimaryLocalSerialInterfaceId,
  invalidateReticulumInterfacesCache,
  isReticulumSidecarRateLimitError,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

export interface ReticulumInterfaceRow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: string;
  host?: string | null;
  port?: number | null;
  serial_port?: string | null;
  frequency?: number | null;
  bandwidth?: number | null;
  txpower?: number | null;
  spreading_factor?: number | null;
  coding_rate?: number | null;
  callsign?: string | null;
  preset?: string | null;
  /** rnsd interface mode (`full`, `boundary`, `access_point`, …). */
  mode?: string | null;
  /**
   * Effective RNS mode from live sidecar stats (canonical rnsd value).
   * When it differs from `mode`, the stack rewrote a discoverable interface.
   */
  runtime_mode?: string | null;
  seed_addresses?: string[];
  discoverable?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
  height?: number | null;
  discovery_name?: string | null;
  announce_interval_min?: number | null;
  connectable?: boolean | null;
  reachable_on?: string | null;
  /** IFAC virtual network name. */
  network_name?: string | null;
  /** IFAC authentication passphrase. */
  passphrase?: string | null;
  /** RNode/KISS TX ready-gate. Only present for RF interface types. */
  flow_control?: boolean | null;
  /**
   * Upstream RNS opt-out so discoverable + Full/Roaming/Boundary keeps the
   * configured mode. Sidecar-derived; not edited in the UI form.
   */
  ignore_config_warnings?: boolean | null;
  /** Host outbound TX mpsc fill from live sidecar stats. */
  tx_queue_used?: number | null;
  /** Host outbound TX mpsc capacity from live sidecar stats. */
  tx_queue_max?: number | null;
  /** Unknown INI keys preserved by the sidecar across CRUD. */
  extra_config?: Record<string, string> | null;
}

export interface ReticulumSerialPortOption {
  path: string;
  label?: string;
}

export interface UseReticulumInterfaceSnapshotOptions {
  /**
   * Sidecar process is up (may still be `connecting` in the UI).
   * Read/refresh while running so BLE RNode rows exist during first-start settle;
   * mutations stay gated by `sidecarApiReady` in the panel.
   */
  sidecarRunning: boolean;
  /** When false, adaptive polling pauses (stack stopped). */
  pollActive: boolean;
}

export function useReticulumInterfaceSnapshot({
  sidecarRunning,
  pollActive,
}: UseReticulumInterfaceSnapshotOptions) {
  const [interfaces, setInterfaces] = useState<ReticulumInterfaceRow[]>([]);
  const [serialPorts, setSerialPorts] = useState<ReticulumSerialPortOption[]>([]);
  const [effectivePrimaryLocalSerialInterfaceId, setEffectivePrimaryLocalSerialInterfaceId] =
    useState<string | null>(null);
  const [bleConnectGraceExpiresAt, setBleConnectGraceExpiresAt] = useState(() =>
    getReticulumBleConnectGraceExpiresAt(),
  );
  const [interfacesHydrated, setInterfacesHydrated] = useState(false);
  const refreshRef = useRef<
    (() => Promise<{ interfaces: ReticulumInterfaceRow[]; paths: string[] } | undefined>) | null
  >(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const burstCancelRef = useRef<(() => void) | null>(null);

  const nowMs = useNowMs(bleConnectGraceExpiresAt > 0, bleConnectGraceExpiresAt > 0 ? 1_000 : 0);
  const healthOptions = useMemo((): ReticulumLocalInterfaceHealthOptions | undefined => {
    if (bleConnectGraceExpiresAt <= 0 || nowMs <= 0) return undefined;
    return { bleConnectGraceExpiresAt, now: nowMs };
  }, [bleConnectGraceExpiresAt, nowMs]);

  const serialPortPaths = useMemo(() => serialPorts.map((p) => p.path), [serialPorts]);

  useEffect(() => {
    return subscribeReticulumBleConnectGrace(() => {
      setBleConnectGraceExpiresAt(getReticulumBleConnectGraceExpiresAt());
    });
  }, []);

  const beginBleConnectGrace = useCallback(() => {
    setBleConnectGraceExpiresAt(beginReticulumBleConnectGrace());
  }, []);

  const refresh = useCallback(async () => {
    if (!sidecarRunning) return undefined;
    if (isReticulumProxyRateLimitBackoffActive('shared')) {
      return { interfaces: [], paths: [], rateLimited: true as const };
    }
    try {
      const [rows, ports] = await Promise.all([
        fetchReticulumInterfaces({ propagateRateLimit: true }),
        fetchReticulumSerialPortOptions({ propagateRateLimit: true }),
      ]);
      // Do not clear shared backoff here — warm interface/serial caches can succeed
      // without a proxy round-trip and would incorrectly shorten peer-store backoff.
      const paths = ports.map((p) => p.path);
      setInterfaces(rows);
      setSerialPorts(ports);
      setInterfacesHydrated(true);
      setEffectivePrimaryLocalSerialInterfaceId(
        getCachedReticulumEffectivePrimaryLocalSerialInterfaceId(),
      );
      logReticulumLocalInterfaceHealthChanges(rows, paths);
      await syncReticulumBleRegistry(rows);
      return { interfaces: rows, paths };
    } catch (e) {
      console.debug('[useReticulumInterfaceSnapshot] refresh ' + errLikeToLogString(e));
      if (isReticulumSidecarRateLimitError(e)) {
        noteReticulumProxyRateLimitHit('shared');
        return { interfaces: [], paths: [], rateLimited: true as const };
      }
      return undefined;
    }
  }, [sidecarRunning]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const handleSidecarEvent = useCallback(
    (evt: ReticulumSidecarEvent) => {
      // stack_restart is not flagged interfaces:true on the shared helper (runtime
      // restarts the stack instead), but Connection still needs a local refresh + grace.
      if (evt.type === 'stack_restart_requested') {
        beginBleConnectGrace();
        invalidateReticulumInterfacesCache();
        if (!isReticulumProxyRateLimitBackoffActive('shared')) {
          void refreshRef.current?.();
        }
        return;
      }
      // announce.received / stats_update must not refresh interfaces — they flood
      // the shared 900/min proxy bucket after wake on large peer tables.
      if (!reticulumSidecarEventRefreshActions(evt.type).interfaces) return;
      invalidateReticulumInterfacesCache();
      if (!isReticulumProxyRateLimitBackoffActive('shared')) {
        void refreshRef.current?.();
      }
    },
    [beginBleConnectGrace],
  );

  useEffect(() => {
    if (!sidecarRunning) {
      setInterfaces([]);
      setSerialPorts([]);
      setEffectivePrimaryLocalSerialInterfaceId(null);
      setInterfacesHydrated(false);
      burstCancelRef.current?.();
      burstCancelRef.current = null;
      // Noble BLE yield + shared grace clock are owned by useReticulumNobleBleYieldWatcher.
      // Do not clear grace or release yield here while the sidecar is still up during
      // connecting — a mid-pair clear leaves release/renew stuck (CoreBluetooth Event
      // receiver died).
      return;
    }
    beginBleConnectGrace();
    invalidateReticulumInterfacesCache();
    void refresh();
    burstCancelRef.current?.();
    burstCancelRef.current = scheduleReticulumLocalInterfaceBurst(() => {
      void refreshRef.current?.();
    });
    return () => {
      burstCancelRef.current?.();
      burstCancelRef.current = null;
    };
  }, [sidecarRunning, refresh, beginBleConnectGrace]);

  useEffect(() => {
    if (!sidecarRunning || !pollActive) {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) return;
      pollTimeoutRef.current = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      if (isReticulumProxyRateLimitBackoffActive('shared')) {
        scheduleNextPoll(RETICULUM_LOCAL_HEALTH_POLL_MS);
        return;
      }
      const snapshot = await refreshRef.current?.();
      if (cancelled || !snapshot) return;
      if ('rateLimited' in snapshot && snapshot.rateLimited) {
        scheduleNextPoll(RETICULUM_LOCAL_HEALTH_POLL_MS);
        return;
      }
      scheduleNextPoll(
        pickReticulumLocalHealthPollMs(snapshot.interfaces, snapshot.paths, healthOptions),
      );
    };

    void tick();

    return () => {
      cancelled = true;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [sidecarRunning, pollActive, healthOptions]);

  return {
    interfaces,
    interfacesHydrated,
    serialPorts,
    serialPortPaths,
    effectivePrimaryLocalSerialInterfaceId,
    healthOptions,
    refresh: async () => {
      invalidateReticulumInterfacesCache();
      return refresh();
    },
    beginBleConnectGrace,
    handleSidecarEvent,
  };
}
