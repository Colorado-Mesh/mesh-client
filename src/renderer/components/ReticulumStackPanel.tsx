import { useTranslation } from 'react-i18next';

import { useReticulumSidecarApi } from '@/renderer/lib/reticulum/useReticulumSidecarApi';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

export interface ReticulumStackPanelProps {
  connecting: boolean;
  stackError?: string | null;
  onStartStack: () => Promise<void>;
  onStopStack: () => Promise<void>;
  onSidecarEvent?: (evt: ReticulumSidecarEvent) => void;
}

/** Connection tab: sidecar lifecycle only (start/stop, autostart, status). */
export function ReticulumStackPanel({
  connecting,
  stackError,
  onStartStack,
  onStopStack,
  onSidecarEvent,
}: ReticulumStackPanelProps) {
  const { t } = useTranslation();
  const { sidecarStatus, sidecarUiRunning, autoStart, handleAutoStartChange } =
    useReticulumSidecarApi({
      connecting,
      onStartStack,
      onEvent: onSidecarEvent,
      enableAutostart: true,
    });

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
          <button
            type="button"
            aria-label={t('connectionPanel.reticulumStopStack')}
            disabled={connecting}
            onClick={() => {
              void onStopStack();
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
