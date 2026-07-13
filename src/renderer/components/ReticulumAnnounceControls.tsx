/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  DEFAULT_ANNOUNCE_INTERVAL_SEC,
  parseReticulumStackSettingsPayload,
} from '@/renderer/lib/reticulum/reticulumStackSettings';

import { useToast } from './Toast';

export interface ReticulumAnnounceControlsProps {
  disabled?: boolean;
  /** When true, omit top border/margin for embedding in App panel. */
  embedded?: boolean;
}

function clampAnnounceIntervalSec(value: number): number {
  return Math.min(86400, Math.max(0, Math.trunc(value) || 0));
}

/** Announce interval and clear-announces controls for the Reticulum stack. */
export function ReticulumAnnounceControls({
  disabled = false,
  embedded = false,
}: ReticulumAnnounceControlsProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [announceInterval, setAnnounceInterval] = useState(DEFAULT_ANNOUNCE_INTERVAL_SEC);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!(await isReticulumSidecarRunning())) return;
    try {
      const settings = parseReticulumStackSettingsPayload(
        await window.electronAPI.reticulum.proxyGet('/api/v1/stack/settings'),
      );
      setAnnounceInterval(settings.announce_interval_sec);
    } catch (e) {
      console.warn('[ReticulumAnnounceControls] load ' + errLikeToLogString(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveAnnounceInterval = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      if (!(await isReticulumSidecarRunning())) {
        setStatusMessage(t('reticulumIdentity.announceSaveSidecarStopped'));
        addToast(t('reticulumIdentity.announceSaveSidecarStopped'), 'error');
        return;
      }
      const current = parseReticulumStackSettingsPayload(
        await window.electronAPI.reticulum.proxyGet('/api/v1/stack/settings'),
      );
      const res = (await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', {
        ...current,
        announce_interval_sec: clampAnnounceIntervalSec(announceInterval),
      })) as { ok?: boolean; error?: string };
      if (res?.ok === false) {
        const message = t('reticulumIdentity.announceSaveFailed', {
          error: res.error ?? t('common.error'),
        });
        setStatusMessage(message);
        addToast(message, 'error');
        return;
      }
      const savedMessage = t('reticulumIdentity.announceSaved');
      setStatusMessage(savedMessage);
      addToast(savedMessage, 'success');
      await load();
    } catch (e) {
      const message = t('reticulumIdentity.announceSaveFailed', {
        error: errLikeToLogString(e),
      });
      console.warn('[ReticulumAnnounceControls] announce interval ' + errLikeToLogString(e));
      setStatusMessage(message);
      addToast(message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const clearAnnounces = async () => {
    setBusy(true);
    setStatusMessage(null);
    try {
      if (!(await isReticulumSidecarRunning())) {
        setStatusMessage(t('reticulumIdentity.announceSaveSidecarStopped'));
        return;
      }
      await window.electronAPI.reticulum.proxyDelete('/api/v1/announces');
      addToast(t('reticulumIdentity.clearAnnouncesDone'), 'success');
    } catch (e) {
      console.warn('[ReticulumAnnounceControls] clear announces ' + errLikeToLogString(e));
      addToast(t('reticulumIdentity.clearAnnouncesFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const controlsDisabled = disabled || busy;

  return (
    <div className={embedded ? 'space-y-2' : 'mt-4 border-t border-gray-700 pt-4'}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-400" htmlFor="reticulum-announce-interval">
          {t('reticulumIdentity.announceIntervalSec')}
        </label>
        <input
          id="reticulum-announce-interval"
          type="number"
          min={0}
          max={86400}
          value={announceInterval}
          disabled={controlsDisabled}
          aria-label={t('reticulumIdentity.announceIntervalSec')}
          className="bg-deep-black w-24 rounded border border-gray-600 px-2 py-1 text-sm text-gray-200"
          onChange={(e) => {
            setAnnounceInterval(clampAnnounceIntervalSec(Number(e.target.value)));
            setStatusMessage(null);
          }}
        />
        <button
          type="button"
          disabled={controlsDisabled}
          aria-label={t('common.save')}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 transition-colors hover:bg-slate-800 disabled:opacity-40"
          onClick={() => {
            void saveAnnounceInterval();
          }}
        >
          {busy ? t('common.saving') : t('common.save')}
        </button>
        <button
          type="button"
          disabled={controlsDisabled}
          aria-label={t('reticulumIdentity.clearAnnounces')}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-amber-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
          onClick={() => {
            void clearAnnounces();
          }}
        >
          {t('reticulumIdentity.clearAnnounces')}
        </button>
      </div>
      <p className="text-xs text-gray-500">{t('reticulumIdentity.announceIntervalHint')}</p>
      {statusMessage ? (
        <p className="mt-2 text-xs text-gray-300" role="status">
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}
