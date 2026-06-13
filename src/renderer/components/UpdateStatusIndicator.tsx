import { useTranslation } from 'react-i18next';

import { SpinnerIcon } from '@/renderer/lib/icons/spinnerIcon';
import {
  IconRestart,
  IconUpdateAvailable,
  IconUpToDate,
  IconWarning,
} from '@/renderer/lib/icons/statusIcons';

import type { UpdateState } from '../App';

interface Props {
  updateState: UpdateState;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onViewRelease: () => void;
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
          <SpinnerIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
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
            <IconUpdateAvailable className="h-3.5 w-3.5 shrink-0 text-amber-400" />
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
          <SpinnerIcon className="text-brand-green h-3.5 w-3.5 shrink-0" />
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
          <IconWarning className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="text-amber-500/90">{t('updateStatus.updateError')}</span>
        </button>
      )}
    </span>
  );
}
