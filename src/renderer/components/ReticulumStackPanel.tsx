/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  collectReticulumLocalInterfaceAlerts,
  type ReticulumLocalInterfaceAlert,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import {
  fetchReticulumInterfaces,
  fetchReticulumSerialPorts,
  invalidateReticulumInterfacesCache,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { useReticulumSidecarApi } from '@/renderer/lib/reticulum/useReticulumSidecarApi';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

import { ReticulumLocalInterfaceAlertsBlock } from './ReticulumLocalInterfaceAlertsBlock';

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
  const [localAlerts, setLocalAlerts] = useState<ReticulumLocalInterfaceAlert[]>([]);
  const [availablePorts, setAvailablePorts] = useState<string[]>([]);
  const refreshLocalHealthRef = useRef<(() => Promise<void>) | null>(null);

  const refreshLocalHealth = useCallback(async () => {
    invalidateReticulumInterfacesCache();
    const [interfaces, ports] = await Promise.all([
      fetchReticulumInterfaces(),
      fetchReticulumSerialPorts(),
    ]);
    setAvailablePorts(ports);
    setLocalAlerts(collectReticulumLocalInterfaceAlerts(interfaces, ports));
  }, []);

  useEffect(() => {
    refreshLocalHealthRef.current = refreshLocalHealth;
  }, [refreshLocalHealth]);

  const handleSidecarEvent = useCallback((evt: ReticulumSidecarEvent) => {
    if (evt.type === 'interface.state' || evt.type === 'stats_update') {
      void refreshLocalHealthRef.current?.();
    }
  }, []);

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
      setLocalAlerts([]);
      setAvailablePorts([]);
      return;
    }
    void refreshLocalHealth();
  }, [sidecarApiReady, refreshLocalHealth]);

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
        {sidecarUiRunning && sidecarStatus.port > 0 ? (
          <p className="text-muted text-xs" role="status">
            127.0.0.1:{sidecarStatus.port}
          </p>
        ) : null}
        {sidecarUiRunning ? (
          <ReticulumLocalInterfaceAlertsBlock
            alerts={localAlerts}
            availablePorts={availablePorts}
            onOpenRadio={onOpenRadioPanel}
            onRefreshPorts={() => {
              void refreshLocalHealth();
            }}
          />
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
