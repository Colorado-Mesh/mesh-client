import { useTranslation } from 'react-i18next';

import type { ConnectionLinkMeterKind, SignalBarLevel } from '../lib/hostLinkQuality';
import SignalBars from './SignalBars';

export type { ConnectionLinkMeterKind };

export interface ConnectionLinkMeterProps {
  kind: ConnectionLinkMeterKind;
  /** BLE host RSSI in dBm when kind is ble-rssi. */
  rssi?: number | null;
  /** IP RTT in ms when kind is ip-rtt. */
  rttMs?: number | null;
  /** Precomputed bar level for ip-rtt (from rttToSignalLevel). */
  level?: SignalBarLevel | null;
  className?: string;
}

/**
 * Host↔radio link meter for the Connection panel (not LoRa Telemetry SignalMeter).
 * BLE = RSSI dBm; HTTP/TCP = RTT ms; Linux BLE = Web Bluetooth unavailable phrase.
 */
export default function ConnectionLinkMeter({
  kind,
  rssi,
  rttMs,
  level,
  className,
}: ConnectionLinkMeterProps) {
  const { t } = useTranslation();

  if (kind === 'unavailable') {
    return (
      <div
        className={`flex items-center justify-between text-sm ${className ?? ''}`}
        role="group"
        aria-label={t('connectionPanel.hostSignal')}
      >
        <span className="text-muted">{t('connectionPanel.hostSignal')}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
          <SignalBars noData className="h-3 w-4" />
          {t('connectionPanel.signalUnavailableWebBluetooth')}
        </span>
      </div>
    );
  }

  if (kind === 'ip-rtt') {
    const hasRtt = rttMs != null && Number.isFinite(rttMs);
    return (
      <div
        className={`flex items-center justify-between text-sm ${className ?? ''}`}
        role="group"
        aria-label={t('connectionPanel.linkQuality')}
      >
        <span className="text-muted">{t('connectionPanel.linkQuality')}</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-300">
          <SignalBars level={hasRtt ? (level ?? 0) : null} noData={!hasRtt} className="h-3 w-4" />
          {hasRtt
            ? t('connectionPanel.linkQualityMs', { ms: Math.round(rttMs) })
            : t('connectionPanel.linkQualityUnavailable')}
        </span>
      </div>
    );
  }

  const hasRssi = rssi != null && Number.isFinite(rssi);
  return (
    <div
      className={`flex items-center justify-between text-sm ${className ?? ''}`}
      role="group"
      aria-label={t('connectionPanel.hostSignal')}
    >
      <span className="text-muted">{t('connectionPanel.hostSignal')}</span>
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-300">
        <SignalBars rssi={hasRssi ? rssi : null} className="h-3 w-4" />
        {hasRssi
          ? t('connectionPanel.bleRssiDbm', { rssi: Math.round(rssi) })
          : t('connectionPanel.hostSignalUnavailable')}
      </span>
    </div>
  );
}
