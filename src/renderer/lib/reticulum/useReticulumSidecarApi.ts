/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isReticulumAutostartEnabled,
  setReticulumAutostartEnabled,
} from '@/renderer/lib/appSettingsStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isBleScanBusyErrorMessage } from '@/renderer/lib/reticulum/reticulumBleAdapterLease';
import { refreshGamesSessions } from '@/renderer/lib/reticulum/reticulumGamesSession';
import {
  isReticulumManualStackStopSuppress,
  setReticulumManualStackStopSuppress,
} from '@/renderer/lib/reticulum/reticulumManualStackStopSuppress';
import { fetchReticulumIdentityStatus } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { notifyReticulumStartupAutostartSettled } from '@/renderer/lib/reticulum/reticulumStartupAutostartGate';
import { tryGetReticulumSession } from '@/renderer/lib/sessions/reticulumSession';
import {
  beginReticulumIdentityFetch,
  bumpReticulumIdentityFetchGeneration,
  refreshReticulumIdentityShared,
  useReticulumIdentityStore,
} from '@/renderer/stores/reticulumIdentityStore';
import type { ReticulumSidecarEvent, ReticulumSidecarStatus } from '@/shared/reticulum-types';

export type { ReticulumIdentityStatus } from '@/renderer/stores/reticulumIdentityStore';

export interface UseReticulumSidecarApiOptions {
  connecting: boolean;
  onStartStack: () => Promise<void>;
  onEvent?: (evt: ReticulumSidecarEvent) => void;
  /** Only Connection tab should auto-start the stack. */
  enableAutostart?: boolean;
}

const SESSION_READY_POLL_MS = 50;
const SESSION_READY_MAX_WAIT_MS = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForReticulumSession(): Promise<boolean> {
  const deadline = Date.now() + SESSION_READY_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (tryGetReticulumSession()) return true;
    await sleep(SESSION_READY_POLL_MS);
  }
  return false;
}

export function useReticulumSidecarApi({
  connecting,
  onStartStack,
  onEvent,
  enableAutostart = false,
}: UseReticulumSidecarApiOptions) {
  const { t } = useTranslation();
  const [sidecarStatus, setSidecarStatus] = useState<ReticulumSidecarStatus>({
    running: false,
    port: 0,
    pid: null,
  });
  const [autoStart, setAutoStart] = useState(isReticulumAutostartEnabled);
  const autostartAttemptedRef = useRef(false);
  const startInFlightRef = useRef(false);
  const statusHydratedRef = useRef(false);
  const sidecarRunningRef = useRef(false);
  const connectingRef = useRef(connecting);
  const onStartStackRef = useRef(onStartStack);
  const identity = useReticulumIdentityStore((state) => state.identity);
  const [statsSummary, setStatsSummary] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<{ sidecar_version?: string; rns_version?: string } | null>(
    null,
  );

  const sidecarUiRunning = sidecarStatus.running;
  const sidecarApiReady = sidecarStatus.running && !connecting;

  useEffect(() => {
    connectingRef.current = connecting;
  }, [connecting]);

  useEffect(() => {
    onStartStackRef.current = onStartStack;
  }, [onStartStack]);

  useEffect(() => {
    sidecarRunningRef.current = sidecarStatus.running;
  }, [sidecarStatus.running]);

  const applySidecarStatus = useCallback((status: ReticulumSidecarStatus) => {
    statusHydratedRef.current = true;
    if (sidecarRunningRef.current && !status.running) {
      bumpReticulumIdentityFetchGeneration();
    }
    setSidecarStatus(status);
  }, []);

  const refreshSidecarStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.reticulum.getStatus();
      applySidecarStatus(status);
      return status;
    } catch (e) {
      console.debug('[useReticulumSidecarApi] getStatus ' + errLikeToLogString(e));
      return { running: false, port: 0, pid: null };
    }
  }, [applySidecarStatus]);

  const refreshIdentity = useCallback(async () => {
    if (!sidecarRunningRef.current) {
      if (statusHydratedRef.current && !connectingRef.current) {
        bumpReticulumIdentityFetchGeneration();
        useReticulumIdentityStore.getState().setIdentity(null);
      }
      return;
    }
    const generation = beginReticulumIdentityFetch();
    try {
      await refreshReticulumIdentityShared(async () => {
        const status = await fetchReticulumIdentityStatus();
        if (!status.lxmfHash) {
          const existing = useReticulumIdentityStore.getState().identity;
          if (existing?.lxmf_hash) {
            return existing;
          }
          return {
            configured: false,
            identity_hash: '',
            lxmf_hash: '',
            display_name: null,
            public_key: null,
          };
        }
        return {
          configured: status.configured,
          identity_hash: status.identityHash?.trim() || '',
          lxmf_hash: status.lxmfHash,
          display_name: status.displayName,
          public_key: status.publicKey ?? null,
        };
      }, generation);
    } catch (e) {
      console.debug('[useReticulumSidecarApi] identity status ' + errLikeToLogString(e));
    }
  }, []);

  const refreshAppInfo = useCallback(async () => {
    if (!sidecarApiReady) {
      setAppInfo(null);
      return;
    }
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/app/info')) as {
        sidecar_version?: string;
        rns_version?: string;
        lxmf_version?: string;
      };
      setAppInfo(body);
    } catch (e) {
      console.debug('[useReticulumSidecarApi] app info ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  useEffect(() => {
    void refreshSidecarStatus();
    const unsubStatus = window.electronAPI.reticulum.onStatus((status) => {
      statusHydratedRef.current = true;
      if (sidecarRunningRef.current && !status.running) {
        bumpReticulumIdentityFetchGeneration();
      }
      setSidecarStatus(status);
      if (!status.running && !isReticulumManualStackStopSuppress() && !startInFlightRef.current) {
        autostartAttemptedRef.current = false;
      }
    });
    return unsubStatus;
  }, [refreshSidecarStatus]);

  useEffect(() => {
    // Only the autostart-owning mount may settle the RF BLE gate when the user has
    // disabled stack autostart. StackPanel/Admin/Network use enableAutostart:false and
    // must not unblock Noble while ReticulumStackAutostartCoordinator still starts the
    // sidecar + BLE RNode (otherwise CoreBluetooth "Event receiver died").
    if (enableAutostart && !autoStart) {
      notifyReticulumStartupAutostartSettled();
    }
  }, [enableAutostart, autoStart]);

  useEffect(() => {
    if (!enableAutostart || !autoStart || autostartAttemptedRef.current) return;
    if (isReticulumManualStackStopSuppress()) return;
    if (sidecarStatus.running || connecting || startInFlightRef.current) return;
    autostartAttemptedRef.current = true;
    startInFlightRef.current = true;
    let cancelled = false;
    void (async () => {
      const ready = await waitForReticulumSession();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
      if (cancelled) {
        // Effect re-ran (unstable callback) before start — allow a fresh attempt unless Stop latched.
        if (!isReticulumManualStackStopSuppress()) {
          autostartAttemptedRef.current = false;
        }
        startInFlightRef.current = false;
        return;
      }
      if (isReticulumManualStackStopSuppress()) {
        autostartAttemptedRef.current = true;
        startInFlightRef.current = false;
        return;
      }
      if (!ready) {
        console.warn(
          '[useReticulumSidecarApi] autostart skipped — Reticulum runtime session never registered',
        );
        autostartAttemptedRef.current = false;
        startInFlightRef.current = false;
        notifyReticulumStartupAutostartSettled();
        return;
      }
      try {
        if (isReticulumManualStackStopSuppress()) {
          autostartAttemptedRef.current = true;
          return;
        }
        await onStartStackRef.current();
        if (isReticulumManualStackStopSuppress()) {
          // Stop won the race after start was invoked — keep suppress sticky.
          autostartAttemptedRef.current = true;
          return;
        }
        // Confirm sidecar actually came up — connect() can no-op coalesce.
        const status = await window.electronAPI.reticulum.getStatus().catch(() => null);
        const running = Boolean(status && typeof status === 'object' && status.running);
        if (!running) {
          if (isReticulumManualStackStopSuppress()) {
            autostartAttemptedRef.current = true;
          } else {
            console.warn(
              '[useReticulumSidecarApi] autostart resolved but sidecar not running — will retry',
            );
            autostartAttemptedRef.current = false;
          }
        } else if (status) {
          applySidecarStatus(status);
          notifyReticulumStartupAutostartSettled();
        }
      } catch (e: unknown) {
        const msg = errLikeToLogString(e);
        console.warn('[useReticulumSidecarApi] autostart failed ' + msg);
        if (isReticulumManualStackStopSuppress()) {
          autostartAttemptedRef.current = true;
          return;
        }
        const isBusy = isBleScanBusyErrorMessage(msg);
        const notMounted = msg.includes('runtime is not mounted');
        if (isBusy || notMounted) {
          window.setTimeout(() => {
            if (!isReticulumManualStackStopSuppress() && !sidecarRunningRef.current) {
              autostartAttemptedRef.current = false;
            }
          }, 1_500);
          return;
        }
        autostartAttemptedRef.current = false;
        notifyReticulumStartupAutostartSettled();
      } finally {
        startInFlightRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // onStartStack is read via ref — do not re-fire on inline callback identity churn.
  }, [enableAutostart, autoStart, connecting, sidecarStatus.running, applySidecarStatus]);

  const notifyManualStackStop = useCallback(() => {
    setReticulumManualStackStopSuppress(true);
    autostartAttemptedRef.current = true;
  }, []);

  const notifyManualStackStart = useCallback(() => {
    setReticulumManualStackStopSuppress(false);
    autostartAttemptedRef.current = false;
  }, []);

  useEffect(() => {
    void refreshIdentity();
    if (sidecarApiReady) {
      void refreshAppInfo();
      void refreshGamesSessions();
    }
  }, [sidecarStatus.running, sidecarApiReady, refreshIdentity, refreshAppInfo]);

  useEffect(() => {
    if (!sidecarApiReady || !onEvent) return;
    const unsub = window.electronAPI.reticulum.onEvent((evt: ReticulumSidecarEvent) => {
      if (evt.type === 'stats_update' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as Record<string, unknown>;
        const parts: string[] = [];
        if (typeof p.interface_count === 'number') {
          parts.push(t('connectionPanel.reticulumStats.interfaces', { count: p.interface_count }));
        }
        if (typeof p.peer_count === 'number') {
          parts.push(t('connectionPanel.reticulumStats.peers', { count: p.peer_count }));
        }
        if (parts.length > 0) setStatsSummary(parts.join(' · '));
      }
      onEvent(evt);
    });
    return unsub;
  }, [sidecarApiReady, onEvent, t]);

  const handleAutoStartChange = useCallback((enabled: boolean) => {
    setAutoStart(enabled);
    setReticulumAutostartEnabled(enabled);
  }, []);

  return {
    sidecarStatus,
    sidecarUiRunning,
    sidecarApiReady,
    autoStart,
    identity,
    statsSummary,
    appInfo,
    applySidecarStatus,
    refreshSidecarStatus,
    refreshIdentity,
    refreshAppInfo,
    handleAutoStartChange,
    notifyManualStackStop,
    notifyManualStackStart,
  };
}
