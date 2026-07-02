/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useNowMs } from '@/renderer/hooks/useNowMs';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  collectReticulumLocalInterfaceAlerts,
  collectReticulumLocalInterfaceConnecting,
  type ReticulumLocalInterfaceAlert,
  type ReticulumLocalInterfaceInput,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { logReticulumLocalInterfaceHealthChanges } from '@/renderer/lib/reticulum/reticulumLocalInterfaceLogging';
import {
  pickReticulumLocalHealthPollMs,
  RETICULUM_BLE_CONNECT_GRACE_MS,
  scheduleReticulumLocalInterfaceBurst,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceRefresh';
import {
  fetchReticulumInterfaces,
  fetchReticulumSerialPorts,
  invalidateReticulumInterfacesCache,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { useReticulumSidecarApi } from '@/renderer/lib/reticulum/useReticulumSidecarApi';
import { tryGetReticulumSession } from '@/renderer/lib/sessions/reticulumSession';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

import { ReticulumLocalInterfaceAlertsBlock } from './ReticulumLocalInterfaceAlertsBlock';
import { ReticulumLocalInterfaceConnectingBlock } from './ReticulumLocalInterfaceConnectingBlock';

export interface ReticulumStackPanelProps {
  connecting: boolean;
  stackError?: string | null;
  onStartStack: () => Promise<void>;
  onStopStack: () => Promise<void>;
  onOpenRadioPanel?: () => void;
}

/** Connection tab: sidecar lifecycle only (start/stop, autostart, status). */
export function ReticulumStackPanel({
  connecting,
  stackError,
  onStartStack,
  onStopStack,
  onOpenRadioPanel,
}: ReticulumStackPanelProps) {
  const { t } = useTranslation();
  const [interfaceSnapshot, setInterfaceSnapshot] = useState<{
    interfaces: ReticulumLocalInterfaceInput[];
    ports: string[];
  }>({ interfaces: [], ports: [] });
  const [bleConnectGraceExpiresAt, setBleConnectGraceExpiresAt] = useState(0);
  const [restartError, setRestartError] = useState<string | null>(null);
  const refreshLocalHealthRef = useRef<
    (() => Promise<{ interfaces: ReticulumLocalInterfaceInput[]; ports: string[] }>) | null
  >(null);
  const localHealthPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localHealthBurstCancelRef = useRef<(() => void) | null>(null);

  const nowMs = useNowMs(bleConnectGraceExpiresAt > 0, bleConnectGraceExpiresAt > 0 ? 1_000 : 0);
  const healthOptions = useMemo(
    () => (bleConnectGraceExpiresAt > 0 ? { bleConnectGraceExpiresAt, now: nowMs } : undefined),
    [bleConnectGraceExpiresAt, nowMs],
  );

  const localAlerts = useMemo(
    (): ReticulumLocalInterfaceAlert[] =>
      collectReticulumLocalInterfaceAlerts(
        interfaceSnapshot.interfaces,
        interfaceSnapshot.ports,
        healthOptions,
      ),
    [interfaceSnapshot, healthOptions],
  );
  const connectingInterfaces = useMemo(
    () =>
      collectReticulumLocalInterfaceConnecting(
        interfaceSnapshot.interfaces,
        interfaceSnapshot.ports,
        healthOptions,
      ),
    [interfaceSnapshot, healthOptions],
  );
  const availablePorts = interfaceSnapshot.ports;

  const refreshLocalHealth = useCallback(async () => {
    invalidateReticulumInterfacesCache();
    const [interfaces, ports] = await Promise.all([
      fetchReticulumInterfaces(),
      fetchReticulumSerialPorts(),
    ]);
    logReticulumLocalInterfaceHealthChanges(interfaces, ports);
    setInterfaceSnapshot({ interfaces, ports });
    return { interfaces, ports };
  }, []);

  useEffect(() => {
    refreshLocalHealthRef.current = refreshLocalHealth;
  }, [refreshLocalHealth]);

  const beginBleConnectGrace = useCallback(() => {
    setBleConnectGraceExpiresAt(Date.now() + RETICULUM_BLE_CONNECT_GRACE_MS);
  }, []);

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
        void refreshLocalHealthRef.current?.();
      }
    },
    [beginBleConnectGrace],
  );

  const {
    sidecarStatus,
    sidecarUiRunning,
    sidecarApiReady,
    autoStart,
    handleAutoStartChange,
    notifyManualStackStop,
    notifyManualStackStart,
    refreshSidecarStatus,
  } = useReticulumSidecarApi({
    connecting,
    onStartStack,
    enableAutostart: true,
    onEvent: handleSidecarEvent,
  });

  useEffect(() => {
    if (!sidecarApiReady) {
      setInterfaceSnapshot({ interfaces: [], ports: [] });
      setBleConnectGraceExpiresAt(0);
      localHealthBurstCancelRef.current?.();
      localHealthBurstCancelRef.current = null;
      return;
    }
    beginBleConnectGrace();
    void refreshLocalHealth();
    localHealthBurstCancelRef.current?.();
    localHealthBurstCancelRef.current = scheduleReticulumLocalInterfaceBurst(() => {
      void refreshLocalHealthRef.current?.();
    });
    return () => {
      localHealthBurstCancelRef.current?.();
      localHealthBurstCancelRef.current = null;
    };
  }, [sidecarApiReady, refreshLocalHealth, beginBleConnectGrace]);

  useEffect(() => {
    if (!sidecarApiReady || !sidecarUiRunning) {
      if (localHealthPollTimeoutRef.current) {
        clearTimeout(localHealthPollTimeoutRef.current);
        localHealthPollTimeoutRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) return;
      localHealthPollTimeoutRef.current = setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      const health = await refreshLocalHealthRef.current?.();
      if (cancelled || !health) return;
      scheduleNextPoll(
        pickReticulumLocalHealthPollMs(health.interfaces, health.ports, healthOptions),
      );
    };

    void tick();

    return () => {
      cancelled = true;
      if (localHealthPollTimeoutRef.current) {
        clearTimeout(localHealthPollTimeoutRef.current);
        localHealthPollTimeoutRef.current = null;
      }
    };
  }, [sidecarApiReady, sidecarUiRunning, healthOptions]);

  return (
    <div className="bg-deep-black overflow-hidden rounded-lg border border-gray-700">
      <div className="bg-secondary-dark flex items-center justify-between border-b border-gray-700 px-4 py-3">
        <h2 className="font-medium text-gray-200">{t('connectionPanel.reticulumStackTitle')}</h2>
        <span
          className={`text-xs font-medium ${
            sidecarUiRunning
              ? 'text-brand-green'
              : connecting
                ? 'animate-pulse text-yellow-400'
                : 'text-gray-400'
          }`}
        >
          ●{' '}
          {sidecarUiRunning
            ? t('connectionPanel.reticulumStackRunning')
            : connecting
              ? t('connectionPanel.connecting')
              : t('connectionPanel.disconnected')}
        </span>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-muted text-xs">{t('connectionPanel.reticulumStackHint')}</p>
        {stackError ? (
          <p className="text-sm text-red-400" role="alert">
            {stackError}
          </p>
        ) : null}
        {restartError ? (
          <p className="text-sm text-red-400" role="alert">
            {restartError}
          </p>
        ) : null}
        {sidecarUiRunning && sidecarStatus.port > 0 ? (
          <p className="text-muted text-xs" role="status">
            127.0.0.1:{sidecarStatus.port}
          </p>
        ) : null}
        {sidecarUiRunning ? (
          <>
            <ReticulumLocalInterfaceConnectingBlock interfaces={connectingInterfaces} />
            <ReticulumLocalInterfaceAlertsBlock
              alerts={localAlerts}
              availablePorts={availablePorts}
              onOpenRadio={onOpenRadioPanel}
              onRefreshPorts={() => {
                void refreshLocalHealth();
              }}
              onRestartStack={() => {
                setRestartError(null);
                void (async () => {
                  const session = tryGetReticulumSession();
                  if (!session?.restartStack) {
                    setRestartError(
                      t('connectionPanel.reticulumInterfaces.restartStackUnavailable'),
                    );
                    return;
                  }
                  try {
                    await session.restartStack();
                    beginBleConnectGrace();
                    await refreshLocalHealth();
                  } catch (e) {
                    console.error(
                      '[ReticulumStackPanel] restart stack failed ' + errLikeToLogString(e),
                    );
                    setRestartError(
                      t('connectionPanel.reticulumInterfaces.restartStackFailed', {
                        message: errLikeToLogString(e),
                      }),
                    );
                  }
                })();
              }}
            />
          </>
        ) : null}
        {sidecarUiRunning ? (
          <button
            type="button"
            aria-label={t('connectionPanel.reticulumStopStack')}
            disabled={connecting}
            onClick={() => {
              notifyManualStackStop();
              void (async () => {
                await onStopStack();
                await refreshSidecarStatus();
              })();
            }}
            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40"
          >
            {t('connectionPanel.reticulumStopStack')}
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('connectionPanel.reticulumStartStack')}
            disabled={connecting}
            onClick={() => {
              notifyManualStackStart();
              void onStartStack();
            }}
            className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-40"
          >
            {connecting
              ? t('connectionPanel.connecting')
              : t('connectionPanel.reticulumStartStack')}
          </button>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={autoStart}
            onChange={(e) => {
              handleAutoStartChange(e.target.checked);
            }}
            aria-label={t('connectionPanel.reticulumAutostart')}
          />
          {t('connectionPanel.reticulumAutostart')}
        </label>
      </div>
    </div>
  );
}
