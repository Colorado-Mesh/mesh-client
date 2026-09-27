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
    <div className="border-ink-700 bg-ink-900/40 space-y-2 rounded border p-3">
      <h4 className="text-ink-200 text-sm font-medium">{t('flasher.provisionTitle')}</h4>
      <p className="text-ink-400 text-xs">{t('flasher.provisionHint')}</p>
      {state === 'disabled' ? (
        <p className="text-muted text-xs">{t('flasher.provisionRequiresFlash')}</p>
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
