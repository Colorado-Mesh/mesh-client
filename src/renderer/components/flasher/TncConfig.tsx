import { useTranslation } from 'react-i18next';

export interface TncConfigProps {
  disabled?: boolean;
  onEnable: () => void;
  onDisable: () => void;
}

export function TncConfig({ disabled, onEnable, onDisable }: TncConfigProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 rounded border border-gray-700 bg-slate-900/40 p-3">
      <h4 className="text-sm font-medium text-gray-200">{t('flasher.tncTitle')}</h4>
      <p className="text-xs text-gray-400">{t('flasher.tncHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.enableTnc')}
          onClick={onEnable}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.enableTnc')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.disableTnc')}
          onClick={onDisable}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.disableTnc')}
        </button>
      </div>
    </div>
  );
}
