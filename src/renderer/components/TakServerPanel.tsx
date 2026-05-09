import type { TFunction } from 'i18next';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ProtocolCapabilities } from '@/renderer/lib/radio/BaseRadioProvider';
import { MS_PER_MINUTE } from '@/renderer/lib/timeConstants';
import type { TAKSettings } from '@/shared/tak-types';

import { useTakServer } from '../hooks/useTakServer';

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

function formatTimeAgo(ts: number, t: TFunction): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < MS_PER_MINUTE) return t('common.justNow');
  return t('common.minutesAgo', { count: Math.floor(diff / MS_PER_MINUTE) });
}

interface Props {
  atakMessages?: Map<number, AtakMessage[]>;
  capabilities?: ProtocolCapabilities;
}

export default function TakServerPanel({ atakMessages, capabilities }: Props) {
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
      ? 'bg-yellow-500'
      : 'bg-green-500'
    : 'bg-red-500';
  const statusLabel = status.running ? t('takServerPanel.running') : t('takServerPanel.stopped');

  return (
    <div className="w-full space-y-6 p-4">
      <h2 className="text-xl font-semibold text-gray-200">{t('takServerPanel.title')}</h2>
      <p className="text-sm text-gray-400">{t('takServerPanel.description')}</p>

      {/* Status */}
      <div className="bg-secondary-dark flex items-center gap-4 rounded-lg p-4">
        <span className={`h-3 w-3 shrink-0 rounded-full ${statusColor}`} />
        <div className="flex-1">
          <span className="text-sm font-medium text-gray-200">{statusLabel}</span>
          {status.running && (
            <span className="ml-2 text-xs text-gray-400">
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
      <div className="bg-secondary-dark space-y-4 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300">{t('takServerPanel.serverSettings')}</h3>

        <div className="space-y-3">
          <div>
            <label htmlFor={`${id}-port`} className="mb-1 block text-xs text-gray-400">
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
              className="bg-deep-black focus:border-brand-green w-32 rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
            />
            {localPort !== '' && !portValid && (
              <p className="mt-1 text-xs text-red-400">{t('takServerPanel.portError')}</p>
            )}
          </div>

          <div>
            <label htmlFor={`${id}-name`} className="mb-1 block text-xs text-gray-400">
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
              className="bg-deep-black focus:border-brand-green w-full max-w-xs rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id={`${id}-cert`}
              type="checkbox"
              checked={localRequireCert}
              onChange={(e) => {
                setLocalRequireCert(e.target.checked);
              }}
              disabled={status.running || isLoading}
              className="rounded border-gray-600 disabled:opacity-50"
            />
            <label htmlFor={`${id}-cert`} className="cursor-pointer text-sm text-gray-300">
              {t('takServerPanel.requireCert')}
            </label>
          </div>

          <div className="flex items-center gap-2">
            <input
              id={`${id}-autostart`}
              type="checkbox"
              checked={localAutoStart}
              onChange={(e) => {
                setLocalAutoStart(e.target.checked);
              }}
              className="accent-brand-green"
            />
            <label htmlFor={`${id}-autostart`} className="cursor-pointer text-sm text-gray-300">
              {t('takServerPanel.autoStart')}
            </label>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          {!status.running ? (
            <button
              type="button"
              onClick={handleStart}
              disabled={isLoading || !portValid || localServerName.trim().length === 0}
              className="bg-brand-green hover:bg-brand-green/90 rounded-lg px-4 py-2 text-sm font-medium text-black transition-colors disabled:opacity-50"
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
        <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300">
            {t('takServerPanel.connectedClients', { count: clients.length })}
          </h3>
          {clients.length === 0 ? (
            <p className="text-xs text-gray-500">{t('takServerPanel.noClientsConnected')}</p>
          ) : (
            <ul className="space-y-1.5">
              {clients.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs text-gray-300">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                  <span className="font-mono">{c.callsign ?? c.address}</span>
                  <span className="text-gray-500">
                    {c.callsign ? `(${c.address})` : ''} · {formatDuration(c.connectedAt, t)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ATAK Plugin Messages from Mesh */}
      {capabilities?.hasAtakPlugin && (
        <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300">
            {t('takServerPanel.atakPluginMessages')}
            {atakMessages && atakMessages.size > 0 && (
              <span className="ml-2 text-gray-500">
                ({Array.from(atakMessages.values()).reduce((sum, arr) => sum + arr.length, 0)})
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-400">{t('takServerPanel.atakPluginDesc')}</p>
          {atakMessages && atakMessages.size > 0 ? (
            <ul className="space-y-1.5">
              {Array.from(atakMessages.entries()).map(([nodeId, messages]) => (
                <li key={nodeId} className="flex items-center gap-2 text-xs text-gray-300">
                  <span className="font-mono">!{nodeId.toString(16).padStart(8, '0')}</span>
                  <span className="text-gray-500">
                    {t('takServerPanel.packets', { count: messages.length })} ·{' '}
                    {t('takServerPanel.lastText')}{' '}
                    {formatTimeAgo(messages[messages.length - 1]?.timestamp ?? 0, t)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-gray-500">{t('takServerPanel.noAtakMessages')}</p>
          )}
        </div>
      )}

      {/* Data package */}
      <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300">{t('takServerPanel.atakDataPackage')}</h3>
        <p className="text-xs text-gray-400">{t('takServerPanel.atakDataPackageDesc')}</p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleGeneratePackage}
            disabled={isLoading || !status.running}
            className="bg-secondary-dark rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 disabled:opacity-50"
          >
            {isLoading ? t('takServerPanel.generating') : t('takServerPanel.generateReveal')}
          </button>
          {packageGenerated && (
            <span className="text-xs text-green-400">{t('takServerPanel.packageSaved')}</span>
          )}
          {!status.running && (
            <span className="text-xs text-gray-500">{t('takServerPanel.startServerFirst')}</span>
          )}
        </div>
      </div>

      {/* Certificate management */}
      <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300">{t('takServerPanel.certificates')}</h3>
        <p className="text-xs text-gray-400">{t('takServerPanel.certificatesDesc')}</p>
        <button
          type="button"
          onClick={handleRegenerateCerts}
          disabled={isLoading}
          className="bg-secondary-dark rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-red-800 hover:text-red-300 disabled:opacity-50"
        >
          {t('takServerPanel.regenerateCerts')}
        </button>
        <p className="text-xs text-gray-500">{t('takServerPanel.regenerateWarning')}</p>
      </div>
    </div>
  );
}
