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
      <p className="text-ink-400 text-xs">{t('flasher.enterDfuHint')}</p>
      <button
        type="button"
        disabled={disabled || busy}
        aria-label={t('flasher.enterDfuMode')}
        onClick={onEnterDfu}
        className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-3 py-1.5 text-xs disabled:opacity-40"
      >
        {t('flasher.enterDfuMode')}
      </button>
    </div>
  );
}
