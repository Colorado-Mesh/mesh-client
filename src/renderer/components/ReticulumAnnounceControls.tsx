/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';

export interface ReticulumAnnounceControlsProps {
  disabled?: boolean;
}

/** Announce interval and clear-announces controls for the Reticulum stack. */
export function ReticulumAnnounceControls({ disabled = false }: ReticulumAnnounceControlsProps) {
  const { t } = useTranslation();
  const [announceInterval, setAnnounceInterval] = useState(0);
  const [busy, setBusy] = useState(false);

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
    try {
      const current = (await window.electronAPI.reticulum.proxyGet(
        '/api/v1/stack/settings',
      )) as Record<string, unknown>;
      await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', {
        ...current,
        announce_interval_sec: announceInterval,
      });
    } catch (e) {
      console.warn('[ReticulumAnnounceControls] announce interval ' + errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  };

  const clearAnnounces = async () => {
    setBusy(true);
    try {
      await window.electronAPI.reticulum.proxyDelete('/api/v1/announces');
    } catch (e) {
      console.warn('[ReticulumAnnounceControls] clear announces ' + errLikeToLogString(e));
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
          }}
        />
        <button
          type="button"
          disabled={controlsDisabled}
          aria-label={t('common.save')}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200"
          onClick={() => {
            void saveAnnounceInterval();
          }}
        >
          {t('common.save')}
        </button>
        <button
          type="button"
          disabled={controlsDisabled}
          aria-label={t('reticulumIdentity.clearAnnounces')}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-amber-300"
          onClick={() => {
            void clearAnnounces();
          }}
        >
          {t('reticulumIdentity.clearAnnounces')}
        </button>
      </div>
    </div>
  );
}
