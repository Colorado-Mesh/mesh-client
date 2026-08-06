import { useTranslation } from 'react-i18next';

export interface BluetoothConfigProps {
  disabled?: boolean;
  pairingPin: number | null;
  /** True while Start pairing is waiting for CMD_BT_PIN over USB. */
  pairingPending?: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onStartPairing: () => void;
  onClearPairedDevices?: () => void;
}

export function BluetoothConfig({
  disabled,
  pairingPin,
  pairingPending = false,
  onEnable,
  onDisable,
  onStartPairing,
  onClearPairedDevices,
}: BluetoothConfigProps) {
  const { t } = useTranslation();
  const pinLabel = pairingPin !== null ? String(pairingPin).padStart(6, '0') : null;

  return (
    <div className="space-y-2 rounded border border-gray-700 bg-slate-900/40 p-3">
      <h4 className="text-sm font-medium text-gray-200">{t('flasher.bluetoothTitle')}</h4>
      <p className="text-xs text-gray-400">{t('flasher.bluetoothHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.enableBluetooth')}
          onClick={onEnable}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.enableBluetooth')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.disableBluetooth')}
          onClick={onDisable}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.disableBluetooth')}
        </button>
        <button
          type="button"
          disabled={disabled || pairingPending}
          aria-label={t('flasher.startPairing')}
          onClick={onStartPairing}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.startPairing')}
        </button>
        {onClearPairedDevices ? (
          <button
            type="button"
            disabled={disabled || pairingPending}
            aria-label={t('flasher.clearPairedDevices')}
            onClick={onClearPairedDevices}
            className="rounded border border-amber-700/60 px-2 py-1 text-xs text-amber-100 hover:bg-amber-950/40 disabled:opacity-40"
          >
            {t('flasher.clearPairedDevices')}
          </button>
        ) : null}
      </div>
      {pairingPending && pairingPin === null ? (
        <output className="block text-xs text-amber-200/90">{t('flasher.pairingWaiting')}</output>
      ) : null}
      {pinLabel !== null ? (
        <output
          className="block rounded border border-amber-500/40 bg-amber-950/40 px-3 py-2"
          aria-label={t('flasher.pairingPin', { pin: pinLabel })}
        >
          <p className="text-[11px] font-medium tracking-wide text-amber-200/80 uppercase">
            {t('flasher.pairingPinLabel')}
          </p>
          <p className="mt-1 font-mono text-2xl tracking-widest text-amber-300">{pinLabel}</p>
          <p className="mt-1 text-[11px] text-amber-100/70">{t('flasher.pairingPinEnterHint')}</p>
        </output>
      ) : null}
    </div>
  );
}
