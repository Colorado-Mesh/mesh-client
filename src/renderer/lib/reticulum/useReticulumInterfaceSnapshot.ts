/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useNowMs } from '@/renderer/hooks/useNowMs';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { syncReticulumBleRegistry } from '@/renderer/lib/reticulum/reticulumBleAdapterConflict';
import {
  beginReticulumBleConnectGrace,
  clearReticulumBleConnectGrace,
  getReticulumBleConnectGraceExpiresAt,
  subscribeReticulumBleConnectGrace,
} from '@/renderer/lib/reticulum/reticulumBleConnectGrace';
import type { ReticulumLocalInterfaceHealthOptions } from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { logReticulumLocalInterfaceHealthChanges } from '@/renderer/lib/reticulum/reticulumLocalInterfaceLogging';
import {
  pickReticulumLocalHealthPollMs,
  scheduleReticulumLocalInterfaceBurst,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh';
import { invalidateReticulumInterfacesCache } from '@/renderer/lib/reticulum/reticulumSidecarReads';
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
  /** Unknown INI keys preserved by the sidecar across CRUD. */
  extra_config?: Record<string, string> | null;
}

export interface ReticulumSerialPortOption {
  path: string;
  label?: string;
}

export interface UseReticulumInterfaceSnapshotOptions {
  sidecarApiReady: boolean;
  /** When false, adaptive polling pauses (stack stopped). */
  pollActive: boolean;
}

export function useReticulumInterfaceSnapshot({
  sidecarApiReady,
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
    if (!sidecarApiReady) return undefined;
    try {
      invalidateReticulumInterfacesCache();
      const [body, portsBody] = await Promise.all([
        window.electronAPI.reticulum.proxyGet('/api/v1/interfaces') as Promise<{
          interfaces?: ReticulumInterfaceRow[];
          effective_primary_local_serial_interface_id?: string | null;
        }>,
        window.electronAPI.reticulum.proxyGet('/api/v1/serial/ports') as Promise<{
          ports?: ReticulumSerialPortOption[];
        }>,
      ]);
      const rows = body.interfaces ?? [];
      const ports = portsBody.ports ?? [];
      const paths = ports.map((p) => p.path);
      setInterfaces(rows);
      setSerialPorts(ports);
      setInterfacesHydrated(true);
      setEffectivePrimaryLocalSerialInterfaceId(
        body.effective_primary_local_serial_interface_id ?? null,
      );
      logReticulumLocalInterfaceHealthChanges(rows, paths);
      await syncReticulumBleRegistry(rows);
      return { interfaces: rows, paths };
    } catch (e) {
      console.debug('[useReticulumInterfaceSnapshot] refresh ' + errLikeToLogString(e));
      return undefined;
    }
  }, [sidecarApiReady]);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const handleSidecarEvent = useCallback(
    (evt: ReticulumSidecarEvent) => {
      if (
        evt.type === 'interface.state' ||
        evt.type === 'stats_update' ||
        evt.type === 'announce.received' ||
        evt.type === 'stack_restart_requested'
      ) {
        if (evt.type === 'stack_restart_requested') {
          beginBleConnectGrace();
        }
        void refreshRef.current?.();
      }
    },
    [beginBleConnectGrace],
  );

  useEffect(() => {
    if (!sidecarApiReady) {
      setInterfaces([]);
      setSerialPorts([]);
      setEffectivePrimaryLocalSerialInterfaceId(null);
      clearReticulumBleConnectGrace();
      setBleConnectGraceExpiresAt(0);
      setInterfacesHydrated(false);
      burstCancelRef.current?.();
      burstCancelRef.current = null;
      // Noble BLE yield lifecycle is owned by useReticulumNobleBleYieldWatcher.
      // Do not release here: sidecarApiReady is false while connecting, and releasing
      // the main-process start yield mid-pair kills CoreBluetooth (Event receiver died).
      return;
    }
    beginBleConnectGrace();
    void refresh();
    burstCancelRef.current?.();
    burstCancelRef.current = scheduleReticulumLocalInterfaceBurst(() => {
      void refreshRef.current?.();
    });
    return () => {
      burstCancelRef.current?.();
      burstCancelRef.current = null;
    };
  }, [sidecarApiReady, refresh, beginBleConnectGrace]);

  useEffect(() => {
    if (!sidecarApiReady || !pollActive) {
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
      const snapshot = await refreshRef.current?.();
      if (cancelled || !snapshot) return;
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
  }, [sidecarApiReady, pollActive, healthOptions]);

  return {
    interfaces,
    interfacesHydrated,
    serialPorts,
    serialPortPaths,
    effectivePrimaryLocalSerialInterfaceId,
    healthOptions,
    refresh,
    beginBleConnectGrace,
    handleSidecarEvent,
  };
}
