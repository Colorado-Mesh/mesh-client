import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  collectReticulumLocalInterfaceAlerts,
  collectReticulumLocalInterfaceConnecting,
  type ReticulumLocalInterfaceAlert,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { useReticulumInterfaceSnapshot } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { useReticulumSidecarApi } from '@/renderer/lib/reticulum/useReticulumSidecarApi';
import { tryGetReticulumSession } from '@/renderer/lib/sessions/reticulumSession';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

import { ReticulumInterfacesPanel } from './reticulum/ReticulumInterfacesPanel';
import { ReticulumLocalInterfaceAlertsBlock } from './ReticulumLocalInterfaceAlertsBlock';
import { ReticulumLocalInterfaceConnectingBlock } from './ReticulumLocalInterfaceConnectingBlock';

export interface ReticulumStackPanelProps {
  connecting: boolean;
  stackError?: string | null;
  onStartStack: () => Promise<void>;
  onStopStack: () => Promise<void>;
}

/** Connection tab: stack lifecycle, interface CRUD, and local interface health. */
export function ReticulumStackPanel({
  connecting,
  stackError,
  onStartStack,
  onStopStack,
}: ReticulumStackPanelProps) {
  const { t } = useTranslation();
  const [restartError, setRestartError] = useState<string | null>(null);
  const sidecarEventRef = useRef<(evt: ReticulumSidecarEvent) => void>(() => {});

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
    onEvent: (evt) => {
      sidecarEventRef.current(evt);
    },
  });

  const {
    interfaces,
    serialPorts,
    serialPortPaths,
    healthOptions,
    refresh,
    beginBleConnectGrace,
    handleSidecarEvent,
  } = useReticulumInterfaceSnapshot({
    sidecarApiReady,
    pollActive: sidecarApiReady && sidecarUiRunning,
  });

  useEffect(() => {
    sidecarEventRef.current = handleSidecarEvent;
  }, [handleSidecarEvent]);

  const localAlerts = useMemo(
    (): ReticulumLocalInterfaceAlert[] =>
      collectReticulumLocalInterfaceAlerts(interfaces, serialPortPaths, healthOptions),
    [interfaces, serialPortPaths, healthOptions],
  );
  const connectingInterfaces = useMemo(
    () => collectReticulumLocalInterfaceConnecting(interfaces, serialPortPaths, healthOptions),
    [interfaces, serialPortPaths, healthOptions],
  );

  const handleRestartStack = useCallback(() => {
    setRestartError(null);
    void (async () => {
      const session = tryGetReticulumSession();
      if (!session?.restartStack) {
        setRestartError(t('connectionPanel.reticulumInterfaces.restartStackUnavailable'));
        return;
      }
      try {
        await session.restartStack();
        beginBleConnectGrace();
        await refresh();
      } catch (e) {
        console.error('[ReticulumStackPanel] restart stack failed ' + errLikeToLogString(e));
        setRestartError(
          t('connectionPanel.reticulumInterfaces.restartStackFailed', {
            message: errLikeToLogString(e),
          }),
        );
      }
    })();
  }, [beginBleConnectGrace, refresh, t]);

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
              availablePorts={serialPortPaths}
              onRefreshPorts={() => {
                void refresh();
              }}
              onRestartStack={handleRestartStack}
            />
            <ReticulumInterfacesPanel
              sidecarApiReady={sidecarApiReady}
              connecting={connecting}
              interfaces={interfaces}
              serialPorts={serialPorts}
              serialPortPaths={serialPortPaths}
              onRefresh={refresh}
              onBeginBleConnectGrace={beginBleConnectGrace}
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
