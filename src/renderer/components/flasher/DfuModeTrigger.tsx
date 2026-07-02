import { useTranslation } from 'react-i18next';

export interface DfuModeTriggerProps {
  disabled?: boolean;
  busy?: boolean;
  onEnterDfu: () => void;
}

export function DfuModeTrigger({ disabled, busy, onEnterDfu }: DfuModeTriggerProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-400">{t('flasher.enterDfuHint')}</p>
      <button
        type="button"
        disabled={disabled || busy}
        aria-label={t('flasher.enterDfuMode')}
        onClick={onEnterDfu}
        className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
      >
        {t('flasher.enterDfuMode')}
      </button>
    </div>
  );
}
