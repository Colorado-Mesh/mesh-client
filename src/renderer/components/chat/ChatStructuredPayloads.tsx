import type { TFunction } from 'i18next';
import { Bot, FileDown, MapPin, Plane, Settings, Signal } from 'lucide-react-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getDistanceUnit } from '@/renderer/lib/appSettingsStorage';
import { buildOsmMapUrl, buildStaticTileUrl } from '@/renderer/lib/chatLocationUtils';
import {
  type DroneReportCoords,
  formatDroneDistance,
  type ParsedDroneReport,
} from '@/renderer/lib/droneReportParse';
import type { ParsedFirmwareBotReply } from '@/renderer/lib/firmwareBotReplyParse';
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

interface BotReplyPart {
  key: string;
  text: string;
  className?: string;
}

function snrPart(key: string, text: string, snr: number): BotReplyPart {
  return { key, text, className: SIGNAL_QUALITY_CLASS[signalQualityFromSnr(snr)] };
}

function firmwareBotReplyParts(
  reply: ParsedFirmwareBotReply,
  t: TFunction,
): { title: string; parts: BotReplyPart[] } {
  switch (reply.kind) {
    case 'status':
      return {
        title: t('chatPayload.firmwareBot.status.title', { name: reply.name }),
        parts: [
          { key: 'up', text: t('chatPayload.firmwareBot.status.uptime', { uptime: reply.uptime }) },
          ...(reply.batteryMv != null
            ? [
                {
                  key: 'batt',
                  text: t('chatPayload.firmwareBot.status.battery', {
                    mv: reply.batteryMv,
                    percent: reply.batteryPercent ?? 0,
                  }),
                },
              ]
            : []),
          {
            key: 'storage',
            text: t('chatPayload.firmwareBot.status.storage', {
              used: reply.storageUsedKb,
              total: reply.storageTotalKb,
            }),
          },
          {
            key: 'counters',
            text: t('chatPayload.firmwareBot.status.counters', {
              seen: reply.seen,
              sent: reply.sent,
              fail: reply.fail,
            }),
            ...(reply.fail > 0 ? { className: 'text-orange-400' } : {}),
          },
        ],
      };
    case 'air':
      return {
        title: t('chatPayload.firmwareBot.air.title'),
        parts: [
          { key: 'tx', text: t('chatPayload.firmwareBot.air.tx', { seconds: reply.txSeconds }) },
          { key: 'rx', text: t('chatPayload.firmwareBot.air.rx', { seconds: reply.rxSeconds }) },
          {
            key: 'rxPackets',
            text: t('chatPayload.firmwareBot.air.rxPackets', {
              flood: reply.rxFlood,
              direct: reply.rxDirect,
            }),
          },
          {
            key: 'txPackets',
            text: t('chatPayload.firmwareBot.air.txPackets', {
              flood: reply.txFlood,
              direct: reply.txDirect,
            }),
          },
        ],
      };
    case 'neighbors':
      return {
        title: t('chatPayload.firmwareBot.neighbors.title', { count: reply.neighbors.length }),
        parts:
          reply.neighbors.length === 0
            ? [{ key: 'none', text: t('chatPayload.firmwareBot.neighbors.none') }]
            : [],
      };
    case 'trace':
      switch (reply.state) {
        case 'result':
          return {
            title: t('chatPayload.firmwareBot.trace.title'),
            parts: [
              {
                key: 'hops',
                text: t('chatPayload.signalReport.hops', { count: reply.hops.length }),
              },
              ...reply.hops.map((hop, i) =>
                snrPart(
                  `hop-${i}`,
                  t('chatPayload.firmwareBot.trace.hop', { hash: hop.hash, snr: hop.snr }),
                  hop.snr,
                ),
              ),
              snrPart(
                'tail',
                t('chatPayload.firmwareBot.trace.tail', { snr: reply.tailSnr }),
                reply.tailSnr,
              ),
            ],
          };
        case 'directZeroHop':
          return {
            title: t('chatPayload.firmwareBot.trace.title'),
            parts: [
              { key: 'direct', text: t('chatPayload.signalReport.direct') },
              snrPart(
                'tail',
                t('chatPayload.firmwareBot.trace.tail', { snr: reply.tailSnr }),
                reply.tailSnr,
              ),
            ],
          };
        case 'directLink':
          return {
            title: t('chatPayload.firmwareBot.trace.title'),
            parts: [
              { key: 'direct', text: t('chatPayload.firmwareBot.trace.directLink') },
              snrPart('snr', t('chatPayload.signalReport.snr', { snr: reply.snr }), reply.snr),
            ],
          };
        case 'timeout':
          return {
            title: t('chatPayload.firmwareBot.trace.title'),
            parts: [
              {
                key: 'timeout',
                text: t('chatPayload.firmwareBot.trace.timeout'),
                className: 'text-orange-400',
              },
              {
                key: 'hops',
                text:
                  reply.hops === 0
                    ? t('chatPayload.signalReport.direct')
                    : t('chatPayload.signalReport.hops', { count: reply.hops }),
              },
            ],
          };
        case 'sent':
          return {
            title: t('chatPayload.firmwareBot.trace.title'),
            parts: [
              { key: 'sent', text: t('chatPayload.firmwareBot.trace.sent') },
              {
                key: 'hops',
                text:
                  reply.hops === 0
                    ? t('chatPayload.signalReport.direct')
                    : t('chatPayload.signalReport.hops', { count: reply.hops }),
              },
            ],
          };
      }
      break;
    case 'lora':
      return {
        title: t('chatPayload.firmwareBot.lora.title'),
        parts: [
          { key: 'freq', text: t('chatPayload.firmwareBot.lora.freq', { freq: reply.freqMhz }) },
          { key: 'sf', text: t('chatPayload.firmwareBot.lora.sf', { sf: reply.sf }) },
          { key: 'bw', text: t('chatPayload.firmwareBot.lora.bw', { bw: reply.bwKhz }) },
          { key: 'cr', text: t('chatPayload.firmwareBot.lora.cr', { cr: reply.cr }) },
          {
            key: 'power',
            text: t('chatPayload.firmwareBot.lora.power', { power: reply.txPowerDbm }),
          },
        ],
      };
    case 'version':
      return {
        title: t('chatPayload.firmwareBot.version.title'),
        parts: [
          { key: 'version', text: reply.version },
          {
            key: 'built',
            text: t('chatPayload.firmwareBot.version.built', { built: reply.built }),
          },
        ],
      };
    case 'channels':
      return {
        title: t('chatPayload.firmwareBot.channels.title'),
        parts: [
          { key: 'bot', text: t('chatPayload.firmwareBot.channels.bot', { name: reply.bot }) },
          {
            key: 'testing',
            text: t('chatPayload.firmwareBot.channels.testing', { name: reply.testing }),
          },
          {
            key: 'emergency',
            text: t('chatPayload.firmwareBot.channels.emergency', { name: reply.emergency }),
          },
          {
            key: 'public',
            text: t('chatPayload.firmwareBot.channels.public', { name: reply.publicChannel }),
          },
        ],
      };
    case 'help':
      return {
        title: reply.diag
          ? t('chatPayload.firmwareBot.help.diagTitle')
          : t('chatPayload.firmwareBot.help.title'),
        parts: reply.commands.map((cmd) => ({ key: `cmd-${cmd}`, text: cmd })),
      };
  }
  return { title: t('chatPayload.firmwareBot.label'), parts: [] };
}

/** Structured readout for a Colorado-Mesh firmware-bot reply (status, air, trace, ...). */
export function FirmwareBotReplyCard({ reply }: Readonly<{ reply: ParsedFirmwareBotReply }>) {
  const { t } = useTranslation();
  const { title, parts } = firmwareBotReplyParts(reply, t);
  return (
    <div
      role="group"
      aria-label={t('chatPayload.firmwareBot.label')}
      className="rounded-badge border-ink-700 bg-ink-900 text-ink-200 mt-1 inline-flex max-w-full flex-col gap-0.5 border px-2 py-1 text-xs"
      data-testid="firmware-bot-reply-card"
      data-kind={reply.kind}
    >
      <div className="flex flex-wrap items-center gap-x-2">
        <Bot aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="text-ink-100 font-medium">{title}</span>
        {parts.map((part) => (
          <span key={part.key} className={part.className}>
            {part.text}
          </span>
        ))}
      </div>
      {reply.kind === 'neighbors' && reply.neighbors.length > 0 && (
        <ul className="space-y-0.5">
          {reply.neighbors.map((n, i) => (
            <li key={`${n.name}-${i}`} className="flex flex-wrap items-center gap-x-2">
              <span className="text-ink-100 truncate">{n.name}</span>
              <span>{t('chatPayload.signalReport.rssi', { rssi: n.rssi })}</span>
              <span className={SIGNAL_QUALITY_CLASS[signalQualityFromSnr(n.snr)]}>
                {t('chatPayload.signalReport.snr', { snr: n.snr })}
              </span>
              <span className="text-ink-400">
                {t('chatPayload.firmwareBot.neighbors.ago', { ago: n.ago })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
