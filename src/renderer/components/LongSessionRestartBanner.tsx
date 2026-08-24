import { useTranslation } from 'react-i18next';

export interface LongSessionRestartBannerProps {
  onRestart: () => void;
  onDismiss: () => void;
}

/** Persistent chrome banner for Noble BLE long-session restart nudge. */
export function LongSessionRestartBanner({
  onRestart,
  onDismiss,
}: LongSessionRestartBannerProps): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t('longSession.title')}
      className="flex items-center justify-between gap-3 border-b border-amber-700/60 bg-amber-950/80 px-4 py-2 text-sm"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-amber-100">{t('longSession.title')}</p>
        <p className="text-amber-200/90">{t('longSession.body')}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onRestart}
          aria-label={t('longSession.restart')}
          className="rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400"
        >
          {t('longSession.restart')}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('longSession.dismiss')}
          className="rounded border border-amber-600/80 px-3 py-1.5 text-xs font-medium text-amber-100 transition-colors hover:border-amber-500 hover:text-white"
        >
          {t('longSession.dismiss')}
        </button>
      </div>
    </div>
  );
}
