import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { restartReticulumStack } from '@/renderer/lib/reticulum/restartReticulumStack';
import {
  collectReticulumInterfaceAlerts,
  collectReticulumLocalInterfaceConnecting,
  isReticulumSharedInstanceClientMode,
  type ReticulumLocalInterfaceAlert,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { parseReticulumStackSettingsPayload } from '@/renderer/lib/reticulum/reticulumStackSettings';
import { useReticulumInterfaceSnapshot } from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { useReticulumSidecarApi } from '@/renderer/lib/reticulum/useReticulumSidecarApi';
import {
  RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS,
  type ReticulumSidecarEvent,
} from '@/shared/reticulum-types';

import { ReticulumInterfacesPanel } from './reticulum/ReticulumInterfacesPanel';
import { ReticulumLocalInterfaceAlertsBlock } from './ReticulumLocalInterfaceAlertsBlock';
import { ReticulumLocalInterfaceConnectingBlock } from './ReticulumLocalInterfaceConnectingBlock';
import { ReticulumRmapConnectionStatus } from './ReticulumRmapConnectionStatus';
import { ReticulumSharedInstanceClientBanner } from './ReticulumSharedInstanceClientBanner';
import { ReticulumSidecarIssueAlertsBlock } from './ReticulumSidecarIssueAlertsBlock';

export interface ReticulumStackPanelProps {
  connecting: boolean;
  stackError?: string | null;
  onStartStack: () => Promise<void>;
  onStopStack: () => Promise<void>;
  onOpenReticulumRmapSettings?: () => void;
  onOpenAppGpsSettings?: () => void;
}

/** Connection tab: stack lifecycle, interface CRUD, and local interface health. */
export function ReticulumStackPanel({
  connecting,
  stackError,
  onStartStack,
  onStopStack,
  onOpenReticulumRmapSettings,
  onOpenAppGpsSettings,
}: ReticulumStackPanelProps) {
  const { t } = useTranslation();
  const [restartError, setRestartError] = useState<string | null>(null);
  const [shareInstanceSetting, setShareInstanceSetting] = useState(false);
  const sidecarEventRef = useRef<(evt: ReticulumSidecarEvent) => void>(() => {});

  const {
    sidecarStatus,
    sidecarUiRunning,
    sidecarApiReady,
    identity,
    autoStart,
    handleAutoStartChange,
    notifyManualStackStop,
    notifyManualStackStart,
    applySidecarStatus,
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
    interfacesHydrated,
    serialPorts,
    serialPortPaths,
    effectivePrimaryLocalSerialInterfaceId,
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

  const enabledInterfaceNames = useMemo(
    () =>
      interfaces
        .filter((row) => row.enabled)
        .map((row) => row.name)
        .sort((a, b) => a.localeCompare(b)),
    [interfaces],
  );
  const enabledInterfaceNamesKey = enabledInterfaceNames.join('\0');
  const enabledInterfaceNamesRef = useRef(enabledInterfaceNames);
  const syncScopeSeqRef = useRef(0);

  useEffect(() => {
    enabledInterfaceNamesRef.current = enabledInterfaceNames;
  }, [enabledInterfaceNames]);

  useEffect(() => {
    if (!sidecarApiReady || !sidecarUiRunning || !interfacesHydrated) return;
    const seq = ++syncScopeSeqRef.current;
    const names = enabledInterfaceNamesRef.current;
    let cancelled = false;
    void window.electronAPI.reticulum
      .syncInterfaceIssueScope(names)
      .then((status) => {
        if (cancelled || seq !== syncScopeSeqRef.current) return;
        applySidecarStatus(status);
      })
      .catch((e: unknown) => {
        console.debug('[ReticulumStackPanel] syncInterfaceIssueScope ' + errLikeToLogString(e));
        if (!cancelled && seq === syncScopeSeqRef.current) void refreshSidecarStatus();
      });
    return () => {
      cancelled = true;
    };
  }, [
    enabledInterfaceNamesKey,
    interfacesHydrated,
    sidecarApiReady,
    sidecarUiRunning,
    applySidecarStatus,
    refreshSidecarStatus,
  ]);

  const issueAlertLastAtMs = sidecarStatus.interfaceIssueAlert?.lastAtMs ?? null;

  useEffect(() => {
    if (!sidecarApiReady || !sidecarUiRunning || issueAlertLastAtMs == null) return;
    // Align with tracker prune (`now - atMs > STALE`): fire one ms after the boundary.
    const remainingMs =
      issueAlertLastAtMs + RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS + 1 - Date.now();
    if (remainingMs <= 0) {
      void refreshSidecarStatus();
      return;
    }
    const timer = window.setTimeout(() => {
      void refreshSidecarStatus();
    }, remainingMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [sidecarApiReady, sidecarUiRunning, issueAlertLastAtMs, refreshSidecarStatus]);

  useEffect(() => {
    if (!sidecarApiReady || !sidecarUiRunning) return;
    let cancelled = false;
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/stack/settings')
      .then((raw) => {
        if (cancelled) return;
        setShareInstanceSetting(parseReticulumStackSettingsPayload(raw).share_instance);
      })
      .catch(() => {
        if (!cancelled) setShareInstanceSetting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sidecarApiReady, sidecarUiRunning]);

  const shareInstanceEnabled = sidecarApiReady && sidecarUiRunning && shareInstanceSetting;

  const sharedInstanceClient = useMemo(
    () => isReticulumSharedInstanceClientMode(interfaces),
    [interfaces],
  );
  const localAlerts = useMemo(
    (): ReticulumLocalInterfaceAlert[] =>
      collectReticulumInterfaceAlerts(interfaces, serialPortPaths, healthOptions),
    [interfaces, serialPortPaths, healthOptions],
  );
  const connectingInterfaces = useMemo(
    () => collectReticulumLocalInterfaceConnecting(interfaces, serialPortPaths, healthOptions),
    [interfaces, serialPortPaths, healthOptions],
  );

  const handleRestartStack = useCallback(async () => {
    setRestartError(null);
    const result = await restartReticulumStack({
      onBeginBleConnectGrace: beginBleConnectGrace,
      onRefresh: refresh,
      logTag: 'ReticulumStackPanel',
    });
    if (result.ok && !result.restarted && result.unavailable) {
      setRestartError(t('connectionPanel.reticulumInterfaces.restartStackUnavailable'));
      return;
    }
    if (!result.ok) {
      setRestartError(
        t('connectionPanel.reticulumInterfaces.restartStackFailed', {
          message: result.message,
        }),
      );
    }
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
            {sharedInstanceClient ? (
              <ReticulumSharedInstanceClientBanner
                onRestartStack={handleRestartStack}
                onRefresh={refresh}
                onBeginBleConnectGrace={beginBleConnectGrace}
              />
            ) : null}
            {sidecarStatus.interfaceIssueAlert ? (
              <ReticulumSidecarIssueAlertsBlock
                alert={sidecarStatus.interfaceIssueAlert}
                shareInstanceEnabled={shareInstanceEnabled}
              />
            ) : null}
            <ReticulumLocalInterfaceAlertsBlock
              alerts={localAlerts}
              availablePorts={serialPortPaths}
              bleBondRemovedNames={sidecarStatus.interfaceIssueAlert?.bleBondRemoved}
              onRefreshPorts={() => {
                void refresh();
              }}
              onRestartStack={handleRestartStack}
            />
            <ReticulumRmapConnectionStatus
              interfaces={interfaces}
              sidecarApiReady={sidecarApiReady}
              onOpenRmapSettings={onOpenReticulumRmapSettings}
            />
            <ReticulumInterfacesPanel
              sidecarApiReady={sidecarApiReady}
              connecting={connecting}
              identityConfigured={identity?.configured === true}
              identityDisplayName={identity?.display_name ?? null}
              onOpenAppGpsSettings={onOpenAppGpsSettings}
              interfaces={interfaces}
              serialPorts={serialPorts}
              serialPortPaths={serialPortPaths}
              bleBondRemovedNames={sidecarStatus.interfaceIssueAlert?.bleBondRemoved}
              effectivePrimaryLocalSerialInterfaceId={effectivePrimaryLocalSerialInterfaceId}
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
