/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  isReticulumAutostartEnabled,
  setReticulumAutostartEnabled,
} from '@/renderer/lib/appSettingsStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumSidecarEvent, ReticulumSidecarStatus } from '@/shared/reticulum-types';

export interface ReticulumIdentityStatus {
  configured: boolean;
  identity_hash: string;
  lxmf_hash: string;
  display_name?: string | null;
}

export interface UseReticulumSidecarApiOptions {
  stackRunning: boolean;
  connecting: boolean;
  onStartStack: () => Promise<void>;
  onEvent?: (evt: ReticulumSidecarEvent) => void;
  /** Only Connection tab should auto-start the stack. */
  enableAutostart?: boolean;
}

export function useReticulumSidecarApi({
  stackRunning,
  connecting,
  onStartStack,
  onEvent,
  enableAutostart = false,
}: UseReticulumSidecarApiOptions) {
  const [sidecarStatus, setSidecarStatus] = useState<ReticulumSidecarStatus>({
    running: false,
    port: 0,
    pid: null,
  });
  const [autoStart, setAutoStart] = useState(isReticulumAutostartEnabled);
  const autostartAttemptedRef = useRef(false);
  const [identity, setIdentity] = useState<ReticulumIdentityStatus | null>(null);
  const [statsSummary, setStatsSummary] = useState<string | null>(null);
  const [appInfo, setAppInfo] = useState<{ sidecar_version?: string; rns_version?: string } | null>(
    null,
  );

  const sidecarUiRunning = stackRunning || sidecarStatus.running;
  const sidecarApiReady = sidecarStatus.running || (stackRunning && !connecting);

  const refreshSidecarStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.reticulum.getStatus();
      setSidecarStatus(status);
      return status;
    } catch (e) {
      console.debug('[useReticulumSidecarApi] getStatus ' + errLikeToLogString(e));
      return { running: false, port: 0, pid: null };
    }
  }, []);

  const refreshIdentity = useCallback(async () => {
    if (!sidecarApiReady) {
      setIdentity(null);
      return;
    }
    try {
      const body = (await window.electronAPI.reticulum.proxyGet(
        '/api/v1/identity/status',
      )) as ReticulumIdentityStatus;
      setIdentity(body);
    } catch (e) {
      console.debug('[useReticulumSidecarApi] identity status ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

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
      setSidecarStatus(status);
    });
    return unsubStatus;
  }, [refreshSidecarStatus]);

  useEffect(() => {
    if (!enableAutostart || !autoStart || autostartAttemptedRef.current) return;
    autostartAttemptedRef.current = true;
    void refreshSidecarStatus().then((status) => {
      if (!status.running && !connecting) {
        void onStartStack().catch((e: unknown) => {
          console.warn('[useReticulumSidecarApi] autostart failed ' + errLikeToLogString(e));
        });
      }
    });
  }, [enableAutostart, autoStart, connecting, onStartStack, refreshSidecarStatus]);

  useEffect(() => {
    void refreshIdentity();
    void refreshAppInfo();
  }, [refreshIdentity, refreshAppInfo]);

  useEffect(() => {
    if (!sidecarApiReady || !onEvent) return;
    const unsub = window.electronAPI.reticulum.onEvent((evt: ReticulumSidecarEvent) => {
      if (evt.type === 'stats_update' && evt.payload && typeof evt.payload === 'object') {
        const p = evt.payload as Record<string, unknown>;
        const parts: string[] = [];
        if (typeof p.interface_count === 'number') {
          parts.push(`interfaces: ${p.interface_count}`);
        }
        if (typeof p.peer_count === 'number') {
          parts.push(`peers: ${p.peer_count}`);
        }
        if (parts.length > 0) setStatsSummary(parts.join(' · '));
      }
      onEvent(evt);
    });
    return unsub;
  }, [sidecarApiReady, onEvent]);

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
    refreshSidecarStatus,
    refreshIdentity,
    refreshAppInfo,
    handleAutoStartChange,
  };
}
