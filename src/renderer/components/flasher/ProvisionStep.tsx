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
    <div className="space-y-2 rounded border border-zinc-700 bg-zinc-900/40 p-3">
      <h4 className="text-sm font-medium text-zinc-200">{t('flasher.provisionTitle')}</h4>
      <p className="text-xs text-zinc-400">{t('flasher.provisionHint')}</p>
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
