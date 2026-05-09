import { useTranslation } from 'react-i18next';

import type { UpdateState } from '../App';

interface Props {
  updateState: UpdateState;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onViewRelease: () => void;
}

function IconSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={`shrink-0 animate-spin ${className ?? ''}`}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function IconUpToDate() {
  return (
    <svg
      className="text-brand-green h-3.5 w-3.5 shrink-0"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function IconUpdateAvailable() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 text-amber-400"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
      />
    </svg>
  );
}

function IconRestart() {
  return (
    <svg
      className="text-brand-green h-3.5 w-3.5 shrink-0"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0013.803-3.7l3.181 3.182m0-4.991v4.99"
      />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0 text-amber-500"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

const linkBtn =
  'text-bright-green underline hover:opacity-80 cursor-pointer bg-transparent border-0 p-0 font-inherit text-[11px]';

export default function UpdateStatusIndicator({
  updateState,
  onCheck,
  onDownload,
  onInstall,
  onViewRelease,
}: Props) {
  const { t } = useTranslation();
  const { phase, version, isPackaged, isMac, percent } = updateState;
  const useReleasePage = !isPackaged || isMac || window.electronAPI.getPlatform() === 'darwin';

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex max-w-full min-w-0 flex-wrap items-center justify-end gap-x-1 gap-y-0.5 font-sans text-gray-300"
    >
      {phase === 'idle' && (
        <>
          <IconSpinner className="h-3.5 w-3.5 text-gray-400" />
          <span aria-busy="true">{t('updateStatus.checking')}</span>
        </>
      )}

      {phase === 'up-to-date' && (
        <button
          type="button"
          onClick={onCheck}
          className="font-inherit inline-flex min-w-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-gray-300 transition-colors hover:text-gray-100"
          title={t('updateStatus.checkForUpdates')}
        >
          <IconUpToDate />
          <span>{t('updateStatus.upToDate')}</span>
        </button>
      )}

      {phase === 'available' && (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="relative flex h-3.5 w-3.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-50" />
            <IconUpdateAvailable />
          </span>
          {version != null ? (
            <span className="text-amber-300 tabular-nums">v{version}</span>
          ) : (
            <span className="text-amber-300">{t('updateStatus.update')}</span>
          )}
          <button
            type="button"
            onClick={useReleasePage ? onViewRelease : onDownload}
            title={
              useReleasePage ? t('updateStatus.viewReleaseTitle') : t('updateStatus.downloadTitle')
            }
            className="rounded border border-amber-600 bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-200 transition-colors hover:border-amber-500 hover:text-amber-100"
          >
            {useReleasePage ? t('updateStatus.viewRelease') : t('updateStatus.download')}
          </button>
        </span>
      )}

      {phase === 'downloading' && (
        <span className="inline-flex max-w-[140px] min-w-0 items-center gap-1.5">
          <IconSpinner className="text-brand-green h-3.5 w-3.5" />
          <span className="h-1 min-w-[48px] flex-1 overflow-hidden rounded-full bg-gray-700">
            <span
              className="bg-brand-green block h-full transition-all duration-300"
              style={{ width: `${percent ?? 0}%` }}
            />
          </span>
          <span className="shrink-0 tabular-nums">{percent ?? 0}%</span>
        </span>
      )}

      {phase === 'ready' && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <IconRestart />
          <button
            type="button"
            onClick={onInstall}
            className={linkBtn}
            title={t('updateStatus.restartTitle')}
          >
            {t('updateStatus.restart')}
          </button>
        </span>
      )}

      {phase === 'error' && (
        <button
          type="button"
          onClick={onCheck}
          className="font-inherit inline-flex min-w-0 cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-gray-300 transition-colors hover:text-gray-100"
          title={t('updateStatus.retryCheck')}
        >
          <IconWarning />
          <span className="text-amber-500/90">{t('updateStatus.updateError')}</span>
        </button>
      )}
    </span>
  );
}
