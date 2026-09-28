import { useTranslation } from 'react-i18next';

export interface AdvancedToolsProps {
  disabled?: boolean;
  onDetect: () => void;
  onReboot: () => void;
  onWipeEeprom: () => void;
  onDumpEeprom: () => void;
}

export function AdvancedTools({
  disabled,
  onDetect,
  onReboot,
  onWipeEeprom,
  onDumpEeprom,
}: AdvancedToolsProps) {
  const { t } = useTranslation();

  return (
    <div className="border-ink-700 bg-ink-900/40 space-y-2 rounded border p-3">
      <h4 className="text-ink-200 text-sm font-medium">{t('flasher.advancedTitle')}</h4>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.detectDevice')}
          onClick={onDetect}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.detectDevice')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.reboot')}
          onClick={onReboot}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.reboot')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.dumpEeprom')}
          onClick={onDumpEeprom}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.dumpEeprom')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.wipeEeprom')}
          onClick={onWipeEeprom}
          className="rounded border border-red-700 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40 disabled:opacity-40"
        >
          {t('flasher.wipeEeprom')}
        </button>
      </div>
    </div>
  );
}
