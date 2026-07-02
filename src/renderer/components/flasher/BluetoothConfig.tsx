import { useTranslation } from 'react-i18next';

export interface BluetoothConfigProps {
  disabled?: boolean;
  pairingPin: number | null;
  onEnable: () => void;
  onDisable: () => void;
  onStartPairing: () => void;
}

export function BluetoothConfig({
  disabled,
  pairingPin,
  onEnable,
  onDisable,
  onStartPairing,
}: BluetoothConfigProps) {
  const { t } = useTranslation();

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
          disabled={disabled}
          aria-label={t('flasher.startPairing')}
          onClick={onStartPairing}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-200 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('flasher.startPairing')}
        </button>
      </div>
      {pairingPin !== null ? (
        <p className="text-xs text-amber-300">{t('flasher.pairingPin', { pin: pairingPin })}</p>
      ) : null}
    </div>
  );
}
