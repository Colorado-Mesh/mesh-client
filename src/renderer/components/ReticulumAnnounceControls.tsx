/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';

import { useToast } from './Toast';

export interface ReticulumAnnounceControlsProps {
  disabled?: boolean;
}

interface StackSettingsPayload {
  enable_transport: boolean;
  share_instance: boolean;
  loglevel: number;
  announce_interval_sec: number;
}

function parseStackSettings(raw: Record<string, unknown>): StackSettingsPayload {
  return {
    enable_transport: Boolean(raw.enable_transport),
    share_instance: raw.share_instance !== false,
    loglevel: typeof raw.loglevel === 'number' ? raw.loglevel : Number(raw.loglevel) || 4,
    announce_interval_sec:
      typeof raw.announce_interval_sec === 'number'
        ? raw.announce_interval_sec
        : Number(raw.announce_interval_sec) || 0,
  };
}

/** Announce interval and clear-announces controls for the Reticulum stack. */
export function ReticulumAnnounceControls({ disabled = false }: ReticulumAnnounceControlsProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [announceInterval, setAnnounceInterval] = useState(0);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!(await isReticulumSidecarRunning())) return;
    try {
      const settings = (await window.electronAPI.reticulum.proxyGet('/api/v1/stack/settings')) as {
        announce_interval_sec?: number;
      };
      setAnnounceInterval(settings.announce_interval_sec ?? 0);
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
      const current = parseStackSettings(
        (await window.electronAPI.reticulum.proxyGet('/api/v1/stack/settings')) as Record<
          string,
          unknown
        >,
      );
      const res = (await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', {
        ...current,
        announce_interval_sec: announceInterval,
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
    <div className="mt-4 border-t border-gray-700 pt-4">
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
            setAnnounceInterval(Number(e.target.value) || 0);
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
      {statusMessage ? (
        <p className="mt-2 text-xs text-gray-300" role="status">
          {statusMessage}
        </p>
      ) : null}
    </div>
  );
}
