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
    <div className="border-ink-700 bg-ink-900/40 space-y-2 rounded border p-3">
      <h4 className="text-ink-200 text-sm font-medium">{t('flasher.bluetoothTitle')}</h4>
      <p className="text-ink-400 text-xs">{t('flasher.bluetoothHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.enableBluetooth')}
          onClick={onEnable}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.enableBluetooth')}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label={t('flasher.disableBluetooth')}
          onClick={onDisable}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.disableBluetooth')}
        </button>
        <button
          type="button"
          disabled={disabled || pairingPending}
          aria-label={t('flasher.startPairing')}
          onClick={onStartPairing}
          className="border-ink-600 text-ink-200 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('flasher.startPairing')}
        </button>
        {onClearPairedDevices ? (
          <button
            type="button"
            disabled={disabled || pairingPending}
            aria-label={t('flasher.clearPairedDevices')}
            onClick={onClearPairedDevices}
            className="rounded border border-orange-700/60 px-2 py-1 text-xs text-orange-100 hover:bg-orange-950/40 disabled:opacity-40"
          >
            {t('flasher.clearPairedDevices')}
          </button>
        ) : null}
      </div>
      {pairingPending && pairingPin === null ? (
        <output className="block text-xs text-orange-200/90">{t('flasher.pairingWaiting')}</output>
      ) : null}
      {pinLabel !== null ? (
        <output
          className="block rounded border border-orange-500/40 bg-orange-950/40 px-3 py-2"
          aria-label={t('flasher.pairingPin', { pin: pinLabel })}
        >
          <p className="text-label font-medium text-orange-200/80">
            {t('flasher.pairingPinLabel')}
          </p>
          <p className="mt-1 font-mono text-2xl tracking-widest text-orange-300">{pinLabel}</p>
          <p className="text-label mt-1 text-orange-100/70">{t('flasher.pairingPinEnterHint')}</p>
        </output>
      ) : null}
    </div>
  );
}
