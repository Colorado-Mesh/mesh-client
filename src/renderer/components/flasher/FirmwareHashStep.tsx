import { useTranslation } from 'react-i18next';

export interface FirmwareHashStepProps {
  disabled?: boolean;
  busy?: boolean;
  onSetHash: () => void;
}

export function FirmwareHashStep({ disabled, busy, onSetHash }: FirmwareHashStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 rounded border border-gray-700 bg-slate-900/40 p-3">
      <h4 className="text-sm font-medium text-gray-200">{t('flasher.firmwareHashTitle')}</h4>
      <p className="text-xs text-gray-400">{t('flasher.firmwareHashHint')}</p>
      <button
        type="button"
        disabled={disabled || busy}
        aria-label={t('flasher.setFirmwareHash')}
        onClick={onSetHash}
        className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
      >
        {busy ? t('flasher.settingFirmwareHash') : t('flasher.setFirmwareHash')}
      </button>
    </div>
  );
}
