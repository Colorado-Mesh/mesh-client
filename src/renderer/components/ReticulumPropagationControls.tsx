import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  readReticulumPropagationMode,
  resolvePropagationSyncTargetId,
  type ReticulumPropagationMode,
  writeReticulumPropagationMode,
} from '@/renderer/lib/reticulum/reticulumPropagationMode';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

export interface ReticulumPropagationControlsProps {
  sidecarReady?: boolean;
  disabled?: boolean;
}

/** Propagation mode selector and sync controls for App panel (and other embedded surfaces). */
export function ReticulumPropagationControls({
  sidecarReady = false,
  disabled = false,
}: ReticulumPropagationControlsProps) {
  const { t } = useTranslation();
  const nodes = useReticulumPropagationStore((s) => s.nodes);
  const preferredId = useReticulumPropagationStore((s) => s.preferredId);
  const sync = useReticulumPropagationStore((s) => s.sync);
  const refreshFromSidecar = useReticulumPropagationStore((s) => s.refreshFromSidecar);
  const setPreferredOnSidecar = useReticulumPropagationStore((s) => s.setPreferredOnSidecar);
  const startSync = useReticulumPropagationStore((s) => s.startSync);
  const cancelSync = useReticulumPropagationStore((s) => s.cancelSync);

  const [mode, setMode] = useState<ReticulumPropagationMode>(() => readReticulumPropagationMode());

  useEffect(() => {
    if (!sidecarReady) return;
    void refreshFromSidecar();
  }, [sidecarReady, refreshFromSidecar]);

  const syncTargetId = resolvePropagationSyncTargetId(mode, nodes, preferredId);

  const applyAutoPreferred = useCallback(async () => {
    const autoId = resolvePropagationSyncTargetId('auto', nodes, preferredId);
    if (!autoId || autoId === preferredId) return;
    await setPreferredOnSidecar(autoId);
  }, [nodes, preferredId, setPreferredOnSidecar]);

  useEffect(() => {
    if (!sidecarReady || mode !== 'auto' || nodes.length === 0) return;
    void applyAutoPreferred();
  }, [applyAutoPreferred, mode, nodes.length, sidecarReady]);

  const handleModeChange = (next: ReticulumPropagationMode) => {
    setMode(next);
    writeReticulumPropagationMode(next);
  };

  const handleSync = () => {
    if (!syncTargetId) return;
    if (mode === 'auto' && syncTargetId !== preferredId) {
      void setPreferredOnSidecar(syncTargetId).then(() => startSync(syncTargetId));
      return;
    }
    void startSync(syncTargetId);
  };

  const syncDisabled = disabled || !sidecarReady || mode === 'off' || !syncTargetId || sync.active;

  return (
    <div className="space-y-2 border-t border-gray-700 pt-4">
      <label htmlFor="app-propagation-mode" className="text-sm text-gray-300">
        {t('reticulumPropagationHeader.modeLabel')}
      </label>
      <select
        id="app-propagation-mode"
        value={mode}
        disabled={disabled || !sidecarReady || sync.active}
        onChange={(e) => {
          handleModeChange(e.target.value as ReticulumPropagationMode);
        }}
        className="bg-deep-black focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-40"
        aria-label={t('reticulumPropagationHeader.modeAria')}
      >
        <option value="auto">{t('reticulumPropagationHeader.modeAuto')}</option>
        <option value="manual">{t('reticulumPropagationHeader.modeManual')}</option>
        <option value="off">{t('reticulumPropagationHeader.modeOff')}</option>
      </select>
      <p className="text-muted text-xs">{t('appPanel.reticulumPropagationHelp')}</p>
      {sync.active ? (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded bg-gray-800">
            <div
              className="bg-readable-green h-full transition-all"
              style={{ width: `${Math.min(100, sync.progress)}%` }}
            />
          </div>
          <button
            type="button"
            disabled={disabled || !sidecarReady}
            className="text-xs text-red-400 hover:underline disabled:opacity-40"
            aria-label={t('reticulumPropagationHeader.cancelSyncAria')}
            onClick={() => {
              void cancelSync();
            }}
          >
            {t('reticulumPropagationHeader.cancelSync')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={syncDisabled}
          className="rounded-lg border border-amber-600 px-3 py-2 text-sm text-amber-300 transition-colors hover:bg-slate-800 disabled:opacity-40"
          aria-label={t('reticulumPropagationHeader.syncAria')}
          onClick={handleSync}
        >
          {t('reticulumPropagationHeader.sync')}
        </button>
      )}
    </div>
  );
}
