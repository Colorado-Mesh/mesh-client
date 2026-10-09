import type { TFunction } from 'i18next';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { decodeTakPacket, type TakPacketSummary } from '@/renderer/lib/meshtastic/takPacketDecode';
import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import { MS_PER_MINUTE } from '@/renderer/lib/timeConstants';
import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';
import type { TAKSettings } from '@/shared/tak-types';

import { useTakServer } from '../hooks/useTakServer';
import type { IdentityId } from '../lib/types';
import TakChannelRelaySection from './TakChannelRelaySection';
import TakRemoteRelaySection from './TakRemoteRelaySection';
import TakUnitFiltersSection from './TakUnitFiltersSection';
import { INPUT_BOX_CLASS } from './ui/formClasses';

interface AtakMessage {
  from: number;
  data: Uint8Array;
  timestamp: number;
}

function formatDuration(connectedAt: number, t: TFunction): string {
  const ms = Date.now() - connectedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return t('takServerPanel.durationSec', { s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('takServerPanel.durationMin', { m });
  const h = Math.floor(m / 60);
  return t('takServerPanel.durationHourMin', { h, m: m % 60 });
}

/** One-line description of the newest ATAK packet from a node. */
function formatTakSummary(summary: TakPacketSummary, t: TFunction): string {
  const parts: string[] = [];
  if (summary.callsign !== undefined) parts.push(summary.callsign);
  if (summary.cotType !== undefined) parts.push(summary.cotType);
  if (summary.team !== undefined) parts.push(summary.team);
  if (summary.latitude !== undefined && summary.longitude !== undefined) {
    parts.push(`${summary.latitude.toFixed(5)}, ${summary.longitude.toFixed(5)}`);
  }
  if (summary.battery !== undefined) parts.push(`${summary.battery}%`);
  if (summary.temperatureC !== undefined) parts.push(`${summary.temperatureC.toFixed(1)}°C`);
  if (summary.chatMessage !== undefined) parts.push(`“${summary.chatMessage}”`);
  else if (summary.payloadKind !== undefined) parts.push(summary.payloadKind);
  return parts.length > 0 ? parts.join(' · ') : t('takServerPanel.atakUndecodable');
}

function formatTimeAgo(ts: number, t: TFunction): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < MS_PER_MINUTE) return t('common.justNow');
  return t('common.minutesAgo', { count: Math.floor(diff / MS_PER_MINUTE) });
}

interface Props {
  atakMessages?: Map<number, AtakMessage[]>;
  capabilities?: ProtocolCapabilities;
  /** MeshCore identity whose channels may feed tracker fixes and GeoChat into TAK. */
  meshcoreIdentityId?: IdentityId | null;
}

export default function TakServerPanel({ atakMessages, capabilities, meshcoreIdentityId }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const {
    status,
    clients,
    settings,
    isLoading,
    error,
    start,
    stop,
    generateDataPackage,
    regenerateCertificates,
  } = useTakServer();

  const [localPort, setLocalPort] = useState(String(settings.port));
  const [localServerName, setLocalServerName] = useState(settings.serverName);
  const [localRequireCert, setLocalRequireCert] = useState(settings.requireClientCert);
  const [localAutoStart, setLocalAutoStart] = useState(settings.autoStart);
  const [packageGenerated, setPackageGenerated] = useState(false);

  /** Decode only the newest packet per node; the buffer holds up to 100 per sender. */
  const latestTakSummaries = useMemo(() => {
    const out = new Map<number, TakPacketSummary | null>();
    for (const [nodeId, messages] of atakMessages ?? []) {
      const newest = messages[messages.length - 1];
      out.set(nodeId, newest ? decodeTakPacket(newest.data) : null);
    }
    return out;
  }, [atakMessages]);

  const portNum = parseInt(localPort, 10);
  const portValid = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535;

  const buildSettings = (): TAKSettings => ({
    enabled: true,
    port: portNum,
    serverName: localServerName.trim() || 'mesh-client',
    requireClientCert: localRequireCert,
    autoStart: localAutoStart,
  });

  const handleStart = async () => {
    if (!portValid) return;
    await start(buildSettings());
  };

  const handleStop = async () => {
    await stop();
  };

  const handleGeneratePackage = async () => {
    setPackageGenerated(false);
    await generateDataPackage();
    setPackageGenerated(true);
    setTimeout(() => {
      setPackageGenerated(false);
    }, 3000);
  };

  const handleRegenerateCerts = async () => {
    await regenerateCertificates();
  };

  const statusColor = status.running
    ? status.error
      ? 'bg-orange-500'
      : 'bg-green-500'
    : 'bg-red-500';
  const statusLabel = status.running ? t('takServerPanel.running') : t('takServerPanel.stopped');

  return (
    <div className="w-full space-y-6 p-4">
      <h2 className="text-ink-200 text-xl font-semibold">{t('takServerPanel.title')}</h2>
      <p className="text-ink-400 text-sm">{t('takServerPanel.description')}</p>

      {/* Status */}
      <div className="bg-deep-black border-ink-800 flex items-center gap-4 rounded-xl border p-4">
        <span className={`h-3 w-3 shrink-0 rounded-full ${statusColor}`} />
        <div className="flex-1">
          <span className="text-ink-200 text-sm font-medium">{statusLabel}</span>
          {status.running && (
            <span className="text-ink-400 ml-2 text-xs">
              {status.clientCount === 1
                ? t('takServerPanel.portClientsInfo', {
                    port: status.port,
                    count: status.clientCount,
                  })
                : t('takServerPanel.portClientsInfoPlural', {
                    port: status.port,
                    count: status.clientCount,
                  })}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Settings form */}
      <div className="bg-deep-black border-ink-800 space-y-4 rounded-xl border p-4">
        <h3 className="text-ink-300 text-sm font-medium">{t('takServerPanel.serverSettings')}</h3>

        <div className="space-y-3">
          <div data-setting-anchor="tak.server.port">
            <label htmlFor={`${id}-port`} className="text-ink-400 mb-1 block text-xs">
              {t('takServerPanel.portLabel')}
            </label>
            <input
              id={`${id}-port`}
              type="number"
              min={1024}
              max={65535}
              value={localPort}
              onChange={(e) => {
                setLocalPort(e.target.value);
              }}
              disabled={status.running || isLoading}
              className={`${INPUT_BOX_CLASS} w-32`}
            />
            {localPort !== '' && !portValid && (
              <p className="mt-1 text-xs text-red-400">{t('takServerPanel.portError')}</p>
            )}
          </div>

          <div data-setting-anchor="tak.server.serverName">
            <label htmlFor={`${id}-name`} className="text-ink-400 mb-1 block text-xs">
              {t('takServerPanel.serverNameLabel')}
            </label>
            <input
              id={`${id}-name`}
              type="text"
              maxLength={256}
              value={localServerName}
              onChange={(e) => {
                setLocalServerName(e.target.value);
              }}
              disabled={status.running || isLoading}
              className={`${INPUT_BOX_CLASS} w-full max-w-xs`}
            />
          </div>

          <div data-setting-anchor="tak.server.requireCert" className="flex items-center gap-2">
            <input
              id={`${id}-cert`}
              type="checkbox"
              checked={localRequireCert}
              onChange={(e) => {
                setLocalRequireCert(e.target.checked);
              }}
              disabled={status.running || isLoading}
              className="border-ink-600 rounded disabled:opacity-50"
            />
            <label htmlFor={`${id}-cert`} className="text-ink-300 cursor-pointer text-sm">
              {t('takServerPanel.requireCert')}
            </label>
          </div>

          <div data-setting-anchor="tak.server.autoStart" className="flex items-center gap-2">
            <input
              id={`${id}-autostart`}
              type="checkbox"
              checked={localAutoStart}
              onChange={(e) => {
                setLocalAutoStart(e.target.checked);
              }}
              className="accent-brand-green"
            />
            <label htmlFor={`${id}-autostart`} className="text-ink-300 cursor-pointer text-sm">
              {t('takServerPanel.autoStart')}
            </label>
          </div>
        </div>

        <div data-setting-anchor="tak.server.startStop" className="flex gap-2 pt-2">
          {!status.running ? (
            <button
              type="button"
              onClick={handleStart}
              disabled={isLoading || !portValid || localServerName.trim().length === 0}
              className="bg-brand-green hover:bg-brand-green/90 text-app-bg rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isLoading ? t('takServerPanel.starting') : t('takServerPanel.startServer')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStop}
              disabled={isLoading}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
            >
              {isLoading ? t('takServerPanel.stopping') : t('takServerPanel.stopServer')}
            </button>
          )}
        </div>
      </div>

      {/* Connected clients */}
      {status.running && (
        <div className="bg-deep-black border-ink-800 space-y-3 rounded-xl border p-4">
          <h3 className="text-ink-300 text-sm font-medium">
            {t('takServerPanel.connectedClients', { count: clients.length })}
          </h3>
          {clients.length === 0 ? (
            <p className="text-muted text-xs">{t('takServerPanel.noClientsConnected')}</p>
          ) : (
            <ul className="space-y-1.5">
              {clients.map((c) => (
                <li key={c.id} className="text-ink-300 flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                  <span className="font-mono">{c.callsign ?? c.address}</span>
                  <span className="text-muted">
                    {c.callsign ? `(${c.address})` : ''} · {formatDuration(c.connectedAt, t)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <TakRemoteRelaySection />

      <TakUnitFiltersSection />

      <TakChannelRelaySection identityId={meshcoreIdentityId ?? null} />

      {/* ATAK Plugin Messages from Mesh */}
      {capabilities?.hasAtakPlugin && (
        <div className="bg-deep-black border-ink-800 space-y-3 rounded-xl border p-4">
          <h3 className="text-ink-300 text-sm font-medium">
            {t('takServerPanel.atakPluginMessages')}
            {atakMessages && atakMessages.size > 0 && (
              <span className="text-muted ml-2">
                ({Array.from(atakMessages.values()).reduce((sum, arr) => sum + arr.length, 0)})
              </span>
            )}
          </h3>
          <p className="text-ink-400 text-xs">{t('takServerPanel.atakPluginDesc')}</p>
          {atakMessages && atakMessages.size > 0 ? (
            <ul className="space-y-1.5">
              {Array.from(atakMessages.entries()).map(([nodeId, messages]) => {
                const summary = latestTakSummaries.get(nodeId) ?? null;
                return (
                  <li key={nodeId} className="text-ink-300 flex flex-col gap-0.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{formatMeshtasticNodeId(nodeId)}</span>
                      <span className="text-muted">
                        {t('takServerPanel.packets', { count: messages.length })} ·{' '}
                        {t('takServerPanel.lastText')}{' '}
                        {formatTimeAgo(messages[messages.length - 1]?.timestamp ?? 0, t)}
                      </span>
                    </div>
                    <span className="text-ink-400">
                      {summary ? formatTakSummary(summary, t) : t('takServerPanel.atakUndecodable')}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted text-xs">{t('takServerPanel.noAtakMessages')}</p>
          )}
        </div>
      )}

      {/* Data package */}
      <div className="bg-deep-black border-ink-800 space-y-3 rounded-xl border p-4">
        <h3 className="text-ink-300 text-sm font-medium">{t('takServerPanel.atakDataPackage')}</h3>
        <p className="text-ink-400 text-xs">{t('takServerPanel.atakDataPackageDesc')}</p>
        <div data-setting-anchor="tak.dataPackage.generate" className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleGeneratePackage}
            disabled={isLoading || !status.running}
            className="bg-secondary-dark border-ink-600 text-ink-200 hover:border-ink-500 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isLoading ? t('takServerPanel.generating') : t('takServerPanel.generateReveal')}
          </button>
          {packageGenerated && (
            <span className="text-xs text-green-400">{t('takServerPanel.packageSaved')}</span>
          )}
          {!status.running && (
            <span className="text-muted text-xs">{t('takServerPanel.startServerFirst')}</span>
          )}
        </div>
      </div>

      {/* Certificate management */}
      <div className="bg-deep-black border-ink-800 space-y-3 rounded-xl border p-4">
        <h3 className="text-ink-300 text-sm font-medium">{t('takServerPanel.certificates')}</h3>
        <p className="text-ink-400 text-xs">{t('takServerPanel.certificatesDesc')}</p>
        <button
          data-setting-anchor="tak.certificates.regenerate"
          type="button"
          onClick={handleRegenerateCerts}
          disabled={isLoading}
          className="bg-secondary-dark border-ink-600 text-ink-300 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:border-red-800 hover:text-red-300 disabled:opacity-50"
        >
          {t('takServerPanel.regenerateCerts')}
        </button>
        <p className="text-muted text-xs">{t('takServerPanel.regenerateWarning')}</p>
      </div>
    </div>
  );
}
