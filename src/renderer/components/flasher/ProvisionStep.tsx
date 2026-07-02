import { useTranslation } from 'react-i18next';

import { flasherStepButtonClass, type FlasherStepButtonState } from './flasherStepButtonStyles';

export interface ProvisionStepProps {
  state: FlasherStepButtonState;
  onProvision: () => void;
}

export function ProvisionStep({ state, onProvision }: ProvisionStepProps) {
  const { t } = useTranslation();
  const busy = state === 'busy';
  const enabled = state === 'ready' || state === 'busy';

  return (
    <div className="space-y-2 rounded border border-gray-700 bg-slate-900/40 p-3">
      <h4 className="text-sm font-medium text-gray-200">{t('flasher.provisionTitle')}</h4>
      <p className="text-xs text-gray-400">{t('flasher.provisionHint')}</p>
      {state === 'disabled' ? (
        <p className="text-xs text-gray-500">{t('flasher.provisionRequiresFlash')}</p>
      ) : null}
      <button
        type="button"
        disabled={!enabled}
        aria-label={t('flasher.provision')}
        aria-busy={busy}
        onClick={() => {
          if (busy) {
            return;
          }
          onProvision();
        }}
        className={flasherStepButtonClass(state)}
      >
        {busy
          ? t('flasher.provisioning')
          : state === 'done'
            ? t('flasher.provisionDone')
            : t('flasher.provision')}
      </button>
    </div>
  );
}
