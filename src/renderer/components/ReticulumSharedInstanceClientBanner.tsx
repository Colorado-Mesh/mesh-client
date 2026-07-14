import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { restartReticulumStack } from '@/renderer/lib/reticulum/restartReticulumStack';
import { parseReticulumStackSettingsPayload } from '@/renderer/lib/reticulum/reticulumStackSettings';

export interface ReticulumSharedInstanceClientBannerProps {
  /** Optional external restart; must settle before banner clears busy. */
  onRestartStack?: () => void | Promise<void>;
  onRefresh?: () => Promise<unknown>;
  onBeginBleConnectGrace?: () => void;
}

/** Connection alert when mesh-client is a shared-instance client of another RNS app. */
export function ReticulumSharedInstanceClientBanner({
  onRestartStack,
  onRefresh,
  onBeginBleConnectGrace,
}: ReticulumSharedInstanceClientBannerProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const runRestart = async (): Promise<boolean> => {
    if (onRestartStack) {
      await onRestartStack();
      return true;
    }
    const result = await restartReticulumStack({
      onBeginBleConnectGrace,
      onRefresh:
        onRefresh ??
        (async () => {
          /* no-op refresh */
        }),
      logTag: 'ReticulumSharedInstanceClientBanner',
    });
    if (!result.ok) {
      setActionError(
        t('connectionPanel.reticulumInterfaces.restartStackFailed', {
          message: result.message,
        }),
      );
      return false;
    }
    if (!result.restarted && result.unavailable) {
      setActionError(t('connectionPanel.reticulumInterfaces.restartStackUnavailable'));
      return false;
    }
    return true;
  };

  const withBusy = async (fn: () => Promise<void>): Promise<void> => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      console.error(`[ReticulumSharedInstanceClientBanner] action failed ${errLikeToLogString(e)}`);
      setActionError(errLikeToLogString(e));
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  const disableShareAndRestart = () =>
    withBusy(async () => {
      const current = parseReticulumStackSettingsPayload(
        await window.electronAPI.reticulum.proxyGet('/api/v1/stack/settings'),
      );
      const res = (await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', {
        ...current,
        share_instance: false,
      })) as { ok?: boolean; error?: string };
      if (res?.ok === false) {
        setActionError(res.error ?? t('connectionPanel.reticulumSharedInstance.disableFailed'));
        return;
      }
      await runRestart();
    });

  const restartOnly = () =>
    withBusy(async () => {
      await runRestart();
    });

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-600/50 bg-amber-950/30 px-3 py-2.5 text-sm text-amber-100"
    >
      <p className="font-medium text-amber-200">
        {t('connectionPanel.reticulumSharedInstance.title')}
      </p>
      <p className="text-muted mt-1 text-xs text-amber-100/90">
        {t('connectionPanel.reticulumSharedInstance.body')}
      </p>
      <p className="text-muted mt-1 text-[11px]">
        {t('connectionPanel.reticulumSharedInstance.networkHint')}
      </p>
      {actionError ? (
        <p className="mt-2 text-xs text-red-300" role="status">
          {actionError}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void disableShareAndRestart();
          }}
          className="rounded bg-amber-700/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          aria-label={t('connectionPanel.reticulumSharedInstance.disableShareAria')}
        >
          {t('connectionPanel.reticulumSharedInstance.disableShare')}
        </button>
        {onRestartStack ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void restartOnly();
            }}
            className="rounded border border-amber-600/60 px-2.5 py-1 text-xs font-medium text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
            aria-label={t('connectionPanel.reticulumLocalInterfaces.restartStackAria')}
          >
            {t('connectionPanel.reticulumLocalInterfaces.restartStack')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
