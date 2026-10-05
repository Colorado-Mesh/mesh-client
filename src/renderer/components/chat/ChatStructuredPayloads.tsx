import { FileDown, MapPin, Plane, Settings, Signal } from 'lucide-react-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getDistanceUnit } from '@/renderer/lib/appSettingsStorage';
import { buildOsmMapUrl, buildStaticTileUrl } from '@/renderer/lib/chatLocationUtils';
import {
  type DroneReportCoords,
  formatDroneDistance,
  type ParsedDroneReport,
} from '@/renderer/lib/droneReportParse';
import { meshTilesAvailable } from '@/renderer/lib/mapBasemapUtils';
import { haversineDistanceKm } from '@/renderer/lib/nodeStatus';
import { requestOpenSetting } from '@/renderer/lib/openSettingRequest';
import {
  type ParsedSignalReport,
  type SignalQuality,
  signalQualityFromSnr,
} from '@/renderer/lib/signalReportParse';
import type { RncpControlKind } from '@/shared/rncpRequestEnable';

const SIGNAL_QUALITY_CLASS: Record<SignalQuality, string> = {
  good: 'text-green-400',
  fair: 'text-orange-400',
  poor: 'text-red-400',
};

/** Compact hop / SNR / RSSI readout for a recognized ping-bot reply. */
export function SignalReportChip({ report }: Readonly<{ report: ParsedSignalReport }>) {
  const { t } = useTranslation();
  const parts: { key: string; text: string; className?: string }[] = [];
  if (report.direct) {
    parts.push({ key: 'hops', text: t('chatPayload.signalReport.direct') });
  } else if (report.hops != null) {
    parts.push({ key: 'hops', text: t('chatPayload.signalReport.hops', { count: report.hops }) });
  }
  if (report.snr != null) {
    parts.push({
      key: 'snr',
      text: t('chatPayload.signalReport.snr', { snr: report.snr }),
      className: SIGNAL_QUALITY_CLASS[signalQualityFromSnr(report.snr)],
    });
  }
  if (report.rssi != null) {
    parts.push({ key: 'rssi', text: t('chatPayload.signalReport.rssi', { rssi: report.rssi }) });
  }
  if (report.noise != null) {
    parts.push({
      key: 'noise',
      text: t('chatPayload.signalReport.noise', { noise: report.noise }),
    });
  }
  if (parts.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={t('chatPayload.signalReport.label')}
      title={report.path ? t('chatPayload.signalReport.path', { path: report.path }) : undefined}
      className="rounded-badge border-ink-700 bg-ink-900 text-ink-200 mt-1 inline-flex max-w-full flex-wrap items-center gap-x-2 border px-2 py-0.5 text-xs"
      data-testid="signal-report-chip"
    >
      <Signal aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {parts.map((part) => (
        <span key={part.key} className={part.className}>
          {part.text}
        </span>
      ))}
    </div>
  );
}

/** Settings-search anchor for Remote → Settings → Inbound file offers. */
const RNCP_INBOUND_SETTING = { slot: 'Remote', id: 'remote.inbound.mode' } as const;

export function RncpControlChip({ kind }: Readonly<{ kind: RncpControlKind }>) {
  const { t } = useTranslation();
  const label =
    kind === 'requestEnable'
      ? t('chatPayload.rncpControl.requestEnable')
      : t('chatPayload.rncpControl.receiveDestShare');
  return (
    <div
      className="rounded-badge mb-1 inline-flex max-w-full items-center gap-1.5 border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-100"
      data-testid="rncp-control-chip"
    >
      <FileDown aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      <button
        type="button"
        className="ml-1 inline-flex shrink-0 items-center gap-1 rounded text-cyan-300 underline hover:text-cyan-200"
        aria-label={t('chatPayload.rncpControl.openSettings')}
        onClick={() => {
          requestOpenSetting(RNCP_INBOUND_SETTING);
        }}
      >
        <Settings aria-hidden className="h-3 w-3" />
        {t('chatPayload.rncpControl.openSettingsShort')}
      </button>
    </div>
  );
}

function formatCoords({ lat, lon }: DroneReportCoords): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

function DroneCoordRow({
  label,
  coords,
  openLabel,
}: Readonly<{ label: string; coords: DroneReportCoords; openLabel: string }>) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-cyan-100/90">
      <MapPin aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span className="font-medium">{label}</span>
      <span>{formatCoords(coords)}</span>
      <a
        href={buildOsmMapUrl(coords.lat, coords.lon)}
        target="_blank"
        rel="noreferrer"
        aria-label={openLabel}
        className="text-cyan-400 underline hover:text-cyan-300"
      >
        {openLabel}
      </a>
    </div>
  );
}

/** Mesh-Mapper Remote ID detection: drone + pilot positions without remote link previews. */
export function DroneReportCard({
  report,
  onContentResize,
}: Readonly<{ report: ParsedDroneReport; onContentResize?: () => void }>) {
  const { t, i18n } = useTranslation();
  const [tileFailed, setTileFailed] = useState(() => !meshTilesAvailable());
  const center = report.drone ?? report.pilot;
  const distanceKm =
    report.drone && report.pilot
      ? haversineDistanceKm(report.drone.lat, report.drone.lon, report.pilot.lat, report.pilot.lon)
      : NaN;

  return (
    <div
      className="space-y-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2"
      data-testid="drone-report-card"
    >
      {center && !tileFailed && (
        <img
          src={buildStaticTileUrl(center.lat, center.lon)}
          alt={t('chatPayload.droneReport.tileAlt')}
          className="h-32 w-full rounded object-cover"
          onLoad={() => {
            onContentResize?.();
          }}
          onError={() => {
            setTileFailed(true);
          }}
        />
      )}
      <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-cyan-100">
        <Plane aria-hidden className="h-4 w-4 shrink-0" />
        <span>{t('chatPayload.droneReport.title')}</span>
        {report.rssi != null && (
          <span className="text-xs font-normal text-cyan-100/80">
            {t('chatPayload.droneReport.rssi', { rssi: report.rssi })}
          </span>
        )}
      </div>
      {report.mac && (
        <div className="text-xs text-cyan-100/80">
          {t('chatPayload.droneReport.mac', { mac: report.mac })}
        </div>
      )}
      {report.drone && (
        <DroneCoordRow
          label={t('chatPayload.droneReport.drone')}
          coords={report.drone}
          openLabel={t('chatPayload.droneReport.openDrone')}
        />
      )}
      {report.pilot && (
        <DroneCoordRow
          label={t('chatPayload.droneReport.pilot')}
          coords={report.pilot}
          openLabel={t('chatPayload.droneReport.openPilot')}
        />
      )}
      {Number.isFinite(distanceKm) && (
        <div className="text-xs text-cyan-100/80">
          {t('chatPayload.droneReport.pilotDistance', {
            distance: formatDroneDistance(distanceKm, getDistanceUnit(), i18n.language),
          })}
        </div>
      )}
      {!report.drone && !report.pilot && (
        <div className="text-xs text-cyan-100/80">{t('chatPayload.droneReport.noPosition')}</div>
      )}
    </div>
  );
}
