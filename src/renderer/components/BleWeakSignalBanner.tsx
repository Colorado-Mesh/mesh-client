import { useTranslation } from 'react-i18next';

import { isWeakBleRssi } from '../lib/signal';

export interface BleWeakSignalBannerProps {
  rssi: number | null | undefined;
  className?: string;
}

/** Amber Connection-panel style warning when BLE RSSI is weak (≤ -80 dBm). */
export function BleWeakSignalBanner({ rssi, className }: BleWeakSignalBannerProps) {
  const { t } = useTranslation();
  if (!isWeakBleRssi(rssi) || rssi == null) return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className={
        className ??
        'border-t border-orange-800/60 bg-orange-900/40 px-4 py-2 text-xs text-orange-200'
      }
    >
      {t('connectionPanel.bleWeakSignalWarning', { rssi: Math.round(rssi) })}
    </p>
  );
}
