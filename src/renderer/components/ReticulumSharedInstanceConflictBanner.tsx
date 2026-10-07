import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { restartReticulumStack } from '@/renderer/lib/reticulum/restartReticulumStack';
import { patchReticulumStackSettings } from '@/renderer/lib/reticulum/reticulumStackSettings';

import { ReticulumSystemRnsExplainer } from './reticulum/ReticulumSystemRnsExplainer';

export interface ReticulumSharedInstanceConflictBannerProps {
  /** Shared endpoint held by the other app (`127.0.0.1:37428` or `rns/<name>`). */
  endpoint: string;
  /** Optional external restart; must settle before banner clears busy. */
  onRestartStack?: () => void | Promise<void>;
  onRefresh?: () => Promise<unknown>;
  onBeginBleConnectGrace?: () => void;
}

/** Share was requested but another Reticulum app owns the endpoint; mesh-client runs standalone. */
export function ReticulumSharedInstanceConflictBanner({
  endpoint,
  onRestartStack,
  onRefresh,
  onBeginBleConnectGrace,
}: ReticulumSharedInstanceConflictBannerProps) {
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
      logTag: 'ReticulumSharedInstanceConflictBanner',
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
      console.error(
        `[ReticulumSharedInstanceConflictBanner] action failed ${errLikeToLogString(e)}`,
      );
      setActionError(errLikeToLogString(e));
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  };

  const disableShareAndRestart = () =>
    withBusy(async () => {
      const res = await patchReticulumStackSettings({ share_instance: false });
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
      className="rounded-lg border border-orange-600/50 bg-orange-950/30 px-3 py-2.5 text-sm text-orange-100"
    >
      <p className="font-medium text-orange-200">
        {t('connectionPanel.reticulumSharedInstance.conflictTitle')}
      </p>
      <p className="text-muted mt-1 text-xs text-orange-100/90">
        {t('connectionPanel.reticulumSharedInstance.conflictBody', { endpoint })}
      </p>
      <ReticulumSystemRnsExplainer />
      <p className="text-muted text-label mt-1">
        {t('connectionPanel.reticulumSharedInstance.conflictHint')}
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
          className="rounded bg-orange-700/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50"
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
            className="rounded border border-orange-600/60 px-2.5 py-1 text-xs font-medium text-orange-100 hover:bg-orange-900/40 disabled:opacity-50"
            aria-label={t('connectionPanel.reticulumLocalInterfaces.restartStackAria')}
          >
            {t('connectionPanel.reticulumLocalInterfaces.restartStack')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
