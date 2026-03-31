import { useId, useState } from 'react';

import type { TAKSettings } from '@/shared/tak-types';

import { useTakServer } from '../hooks/useTakServer';

function formatDuration(connectedAt: number): string {
  const ms = Date.now() - connectedAt;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function TakServerPanel() {
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
  const statusLabel = status.running ? 'Running' : 'Stopped';

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h2 className="text-xl font-semibold text-gray-200">TAK Server</h2>
      <p className="text-sm text-gray-400">
        Built-in TAK server for ATAK / WinTAK / iTAK compatibility. Broadcasts mesh node positions
        as Cursor on Target (CoT) events.
      </p>

      {/* Status */}
      <div className="bg-secondary-dark flex items-center gap-4 rounded-lg p-4">
        <span className={`h-3 w-3 shrink-0 rounded-full ${statusColor}`} />
        <div className="flex-1">
          <span className="text-sm font-medium text-gray-200">{statusLabel}</span>
          {status.running && (
            <span className="ml-2 text-xs text-gray-400">
              port {status.port} · {status.clientCount}{' '}
              {status.clientCount === 1 ? 'client' : 'clients'}
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
        <h3 className="text-sm font-medium text-gray-300">Server Settings</h3>

        <div className="space-y-3">
          <div>
            <label htmlFor={`${id}-port`} className="mb-1 block text-xs text-gray-400">
              Port (1024–65535)
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
              <p className="mt-1 text-xs text-red-400">Port must be 1024–65535</p>
            )}
          </div>

          <div>
            <label htmlFor={`${id}-name`} className="mb-1 block text-xs text-gray-400">
              Server Name
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
              Require client certificate (mTLS)
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
              Auto-start on application launch
            </label>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          {!status.running ? (
            <button
              onClick={handleStart}
              disabled={isLoading || !portValid || localServerName.trim().length === 0}
              className="bg-brand-green hover:bg-brand-green/90 rounded-lg px-4 py-2 text-sm font-medium text-black transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Starting…' : 'Start Server'}
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={isLoading}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
            >
              {isLoading ? 'Stopping…' : 'Stop Server'}
            </button>
          )}
        </div>
      </div>

      {/* Connected clients */}
      {status.running && (
        <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-300">
            Connected Clients ({clients.length})
          </h3>
          {clients.length === 0 ? (
            <p className="text-xs text-gray-500">No clients connected</p>
          ) : (
            <ul className="space-y-1.5">
              {clients.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs text-gray-300">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                  <span className="font-mono">{c.callsign ?? c.address}</span>
                  <span className="text-gray-500">
                    {c.callsign ? `(${c.address})` : ''} · {formatDuration(c.connectedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Data package */}
      <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300">ATAK Data Package</h3>
        <p className="text-xs text-gray-400">
          Generate a .zip file containing TLS certificates and connection settings for import into
          ATAK, WinTAK, or iTAK.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleGeneratePackage}
            disabled={isLoading || !status.running}
            className="bg-secondary-dark rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 disabled:opacity-50"
          >
            {isLoading ? 'Generating…' : 'Generate & Reveal'}
          </button>
          {packageGenerated && (
            <span className="text-xs text-green-400">✓ Package saved — check Finder/Explorer</span>
          )}
          {!status.running && <span className="text-xs text-gray-500">Start the server first</span>}
        </div>
      </div>

      {/* Certificate management */}
      <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-300">Certificates</h3>
        <p className="text-xs text-gray-400">
          Self-signed CA, server, and client certificates are generated automatically on first start
          and stored in the app data directory.
        </p>
        <button
          onClick={handleRegenerateCerts}
          disabled={isLoading}
          className="bg-secondary-dark rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-red-800 hover:text-red-300 disabled:opacity-50"
        >
          Regenerate Certificates
        </button>
        <p className="text-xs text-gray-500">
          Regenerating invalidates existing ATAK data packages — you will need to re-import.
        </p>
      </div>
    </div>
  );
}
