import { useTranslation } from 'react-i18next';

export interface TncConfigProps {
  disabled?: boolean;
  onEnable: () => void;
  onDisable: () => void;
}

export function TncConfig({ disabled, onEnable, onDisable }: TncConfigProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 rounded border border-zinc-700 bg-zinc-900/40 p-3">
      <h4 className="text-sm font-medium text-zinc-200">{t('flasher.tncTitle')}</h4>
      <p className="text-xs text-zinc-400">{t('flasher.tncHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.enableTnc')}
          onClick={onEnable}
          className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
        >
          {t('flasher.enableTnc')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.disableTnc')}
          onClick={onDisable}
          className="rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-40"
        >
          {t('flasher.disableTnc')}
        </button>
      </div>
    </div>
  );
}
