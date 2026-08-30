import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  countEnabledTcpInterfaces,
  isClientLocalPropagationEstablishError,
  PROPAGATION_ESTABLISH_RECOVERY_ANNOUNCE_WAIT_MS,
  shouldShowPropagationDualTcpTip,
} from '@/renderer/lib/reticulum/reticulumPropagationEstablishRecovery';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { MS_PER_SECOND } from '@/shared/timeConstants';

import { useToast } from './Toast';

export interface ReticulumPropagationEstablishRecoveryCalloutProps {
  lastSyncError: string | null;
  /** Prefer / last sync target used for Retry Sync (not a full Auto cascade). */
  retryTargetId: string | null;
  syncBusy: boolean;
  onRetrySync: (targetId: string) => void;
  onOpenInterfaces?: () => void;
  /** Test seam — defaults to sidecar-aligned announce settle. */
  announceWaitMs?: number;
}

/**
 * Recovery UI after client-local establish failures (NoLinkProof / Lrproof*).
 * Announce → wait settle → Retry Sync on one target; optional dual-TCP tip.
 */
export function ReticulumPropagationEstablishRecoveryCallout({
  lastSyncError,
  retryTargetId,
  syncBusy,
  onRetrySync,
  onOpenInterfaces,
  announceWaitMs = PROPAGATION_ESTABLISH_RECOVERY_ANNOUNCE_WAIT_MS,
}: Readonly<ReticulumPropagationEstablishRecoveryCalloutProps>) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [announceBusy, setAnnounceBusy] = useState(false);
  const [waitUntilMs, setWaitUntilMs] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [enabledTcpCount, setEnabledTcpCount] = useState(0);

  const show = isClientLocalPropagationEstablishError(lastSyncError);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    void (async () => {
      try {
        const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
          interfaces?: { enabled?: boolean; type?: string }[];
          ok?: boolean;
        };
        if (cancelled || body.ok === false) return;
        setEnabledTcpCount(countEnabledTcpInterfaces(body.interfaces ?? []));
      } catch (e) {
        console.warn(
          '[ReticulumPropagationEstablishRecoveryCallout] interfaces read ' + errLikeToLogString(e),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [show, lastSyncError]);

  useEffect(() => {
    if (waitUntilMs == null) return;
    const tick = (): void => {
      const now = Date.now();
      setNowMs(now);
      if (now >= waitUntilMs) setWaitUntilMs(null);
    };
    tick();
    const id = window.setInterval(tick, MS_PER_SECOND);
    return () => {
      window.clearInterval(id);
    };
  }, [waitUntilMs]);

  if (!show || lastSyncError == null) return null;

  const waitRemainingMs = waitUntilMs != null ? Math.max(0, waitUntilMs - nowMs) : 0;
  const waitRemainingSec = Math.ceil(waitRemainingMs / MS_PER_SECOND);
  const waiting = waitRemainingMs > 0;
  const retryDisabled = syncBusy || announceBusy || waiting || !retryTargetId;
  const showDualTip = shouldShowPropagationDualTcpTip(enabledTcpCount);

  const announceNow = async (): Promise<void> => {
    setAnnounceBusy(true);
    try {
      if (!(await isReticulumSidecarRunning())) {
        addToast(t('reticulumIdentity.announceSaveSidecarStopped'), 'error');
        return;
      }
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/announces', {})) as {
        ok?: boolean;
        error?: string;
      };
      if (res?.ok === false) {
        addToast(
          t('reticulumIdentity.announceNowFailed', {
            error: res.error ?? t('common.error'),
          }),
          'error',
        );
        return;
      }
      addToast(t('reticulumIdentity.announceNowDone'), 'success');
      setWaitUntilMs(Date.now() + announceWaitMs);
      setNowMs(Date.now());
    } catch (e) {
      console.warn(
        '[ReticulumPropagationEstablishRecoveryCallout] announce ' + errLikeToLogString(e),
      );
      addToast(t('reticulumIdentity.announceNowFailed', { error: errLikeToLogString(e) }), 'error');
    } finally {
      setAnnounceBusy(false);
    }
  };

  return (
    <output
      className="mt-2 block rounded border border-amber-700/60 bg-amber-950/30 px-2 py-2 text-xs text-amber-200"
      aria-live="polite"
      data-testid="propagation-establish-recovery"
    >
      <p className="font-medium text-amber-100">
        {t('reticulumPropagation.establishRecoveryTitle')}
      </p>
      <p className="mt-1 text-amber-200/90">{t('reticulumPropagation.establishRecoveryBody')}</p>
      <p className="mt-1 text-amber-200/80">{t(lastSyncError)}</p>
      {showDualTip ? (
        <p className="mt-1 text-amber-200/90">
          {t('reticulumPropagation.establishRecoveryDualTcpTip')}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={announceBusy || syncBusy}
          className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
          aria-label={t('reticulumPropagation.establishRecoveryAnnounceAria')}
          onClick={() => {
            void announceNow();
          }}
        >
          {t('reticulumPropagation.establishRecoveryAnnounce')}
        </button>
        <button
          type="button"
          disabled={retryDisabled}
          className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
          aria-label={t('reticulumPropagation.establishRecoveryRetryAria')}
          onClick={() => {
            if (!retryTargetId || retryDisabled) return;
            onRetrySync(retryTargetId);
          }}
        >
          {waiting
            ? t('reticulumPropagation.establishRecoveryRetryWaiting', {
                seconds: waitRemainingSec,
              })
            : t('reticulumPropagation.establishRecoveryRetry')}
        </button>
        {showDualTip && onOpenInterfaces ? (
          <button
            type="button"
            className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-100"
            aria-label={t('reticulumPropagation.establishRecoveryOpenInterfacesAria')}
            onClick={() => {
              onOpenInterfaces();
            }}
          >
            {t('reticulumPropagation.establishRecoveryOpenInterfaces')}
          </button>
        ) : null}
      </div>
    </output>
  );
}
