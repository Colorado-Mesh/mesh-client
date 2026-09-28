import { useTranslation } from 'react-i18next';

export interface TncConfigProps {
  disabled?: boolean;
  onEnable: () => void;
  onDisable: () => void;
}

export function TncConfig({ disabled, onEnable, onDisable }: TncConfigProps) {
  const { t } = useTranslation();

  return (
    <div className="border-ink-700 bg-ink-900/40 space-y-2 rounded border p-3">
      <h4 className="text-ink-200 text-sm font-medium">{t('flasher.tncTitle')}</h4>
      <p className="text-ink-400 text-xs">{t('flasher.tncHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.enableTnc')}
          onClick={onEnable}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.enableTnc')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.disableTnc')}
          onClick={onDisable}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.disableTnc')}
        </button>
      </div>
    </div>
  );
}
