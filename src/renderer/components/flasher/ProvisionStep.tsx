import { useTranslation } from 'react-i18next';

export interface ProvisionStepProps {
  disabled?: boolean;
  busy?: boolean;
  onProvision: () => void;
}

export function ProvisionStep({ disabled, busy, onProvision }: ProvisionStepProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 rounded border border-gray-700 bg-slate-900/40 p-3">
      <h4 className="text-sm font-medium text-gray-200">{t('flasher.provisionTitle')}</h4>
      <p className="text-xs text-gray-400">{t('flasher.provisionHint')}</p>
      <button
        type="button"
        disabled={disabled || busy}
        aria-label={t('flasher.provision')}
        onClick={onProvision}
        className="rounded bg-amber-700 px-3 py-1.5 text-xs text-white hover:bg-amber-600 disabled:opacity-40"
      >
        {busy ? t('flasher.provisioning') : t('flasher.provision')}
      </button>
    </div>
  );
}
