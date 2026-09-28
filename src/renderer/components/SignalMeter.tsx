import { useTranslation } from 'react-i18next';

import { rssiToSignalLevel } from '../lib/signal';
import SignalBars from './SignalBars';
import SnrIndicator from './SnrIndicator';

export interface SignalMeterProps {
  rssi?: number | null;
  snr?: number | null;
  className?: string;
}

/**
 * Compact live RSSI/SNR meter for LoRa protocols (Meshtastic / MeshCore).
 * Null values show an empty/no-data state.
 */
export default function SignalMeter({ rssi, snr, className }: SignalMeterProps) {
  const { t } = useTranslation();
  const hasRssi = rssi != null && Number.isFinite(rssi);
  const hasSnr = snr != null && Number.isFinite(snr);
  const level = rssiToSignalLevel(hasRssi ? rssi : null);

  return (
    <div
      className={`border-ink-600/60 bg-ink-800/60 inline-flex items-center gap-3 rounded border px-2 py-1 text-xs ${className ?? ''}`}
      role="status"
      aria-label={t('signalMeter.aria', {
        rssi: hasRssi ? Math.round(rssi) : t('signalMeter.noData'),
        snr: hasSnr ? snr.toFixed(1) : t('signalMeter.noData'),
        level,
      })}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-muted">{t('signalMeter.rssi')}</span>
        <SignalBars rssi={hasRssi ? rssi : null} />
        <span className="text-ink-200 font-mono">
          {hasRssi
            ? t('signalMeter.rssiValue', { value: Math.round(rssi) })
            : t('signalMeter.noData')}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-muted">{t('signalMeter.snr')}</span>
        {hasSnr ? (
          <SnrIndicator snr={snr} />
        ) : (
          <span className="text-muted font-mono">{t('signalMeter.noData')}</span>
        )}
      </div>
    </div>
  );
}
