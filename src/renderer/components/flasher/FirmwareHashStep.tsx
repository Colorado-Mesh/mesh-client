import { useTranslation } from 'react-i18next';

import { flasherStepButtonClass, type FlasherStepButtonState } from './flasherStepButtonStyles';

export interface FirmwareHashStepProps {
  state: FlasherStepButtonState;
  onSetHash: () => void;
}

export function FirmwareHashStep({ state, onSetHash }: FirmwareHashStepProps) {
  const { t } = useTranslation();
  const busy = state === 'busy';
  const enabled = state === 'ready' || state === 'busy';

  return (
    <div className="space-y-2 rounded border border-gray-700 bg-slate-900/40 p-3">
      <h4 className="text-sm font-medium text-gray-200">{t('flasher.firmwareHashTitle')}</h4>
      <p className="text-xs text-gray-400">{t('flasher.firmwareHashHint')}</p>
      {state === 'disabled' ? (
        <p className="text-xs text-gray-500">{t('flasher.firmwareHashRequiresProvision')}</p>
      ) : null}
      <button
        type="button"
        disabled={!enabled}
        aria-label={t('flasher.setFirmwareHash')}
        aria-busy={busy}
        onClick={() => {
          if (busy) {
            return;
          }
          onSetHash();
        }}
        className={flasherStepButtonClass(state)}
      >
        {busy
          ? t('flasher.settingFirmwareHash')
          : state === 'done'
            ? t('flasher.firmwareHashDone')
            : t('flasher.setFirmwareHash')}
      </button>
    </div>
  );
}
