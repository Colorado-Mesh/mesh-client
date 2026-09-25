import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isValidConnectHost } from '@/shared/connectHost';
import type {
  TAKRemoteCredentialSummary,
  TAKRemoteSettings,
  TAKRemoteStatus,
} from '@/shared/tak-types';
import { TCP_PORT_MAX, TCP_PORT_MIN } from '@/shared/tcpPort';

import { useTakRemoteRelay } from '../hooks/useTakRemoteRelay';

const DEFAULT_REMOTE_SETTINGS: TAKRemoteSettings = {
  host: '',
  port: 8089,
  verifyServer: true,
  autoConnect: false,
};

const STATUS_DOT: Record<TAKRemoteStatus['state'], string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500',
  disconnected: 'bg-gray-500',
};

const INPUT_CLASS =
  'bg-deep-black focus:border-brand-green rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none disabled:opacity-50';

function CredentialSummary({ credentials }: { credentials: TAKRemoteCredentialSummary | null }) {
  const { t } = useTranslation();
  if (!credentials) return null;
  return (
    <ul className="space-y-1 text-xs text-gray-400">
      <li>
        {credentials.caSubjects.length > 0
          ? t('takServerPanel.remoteCaSummary', { names: credentials.caSubjects.join(', ') })
          : t('takServerPanel.remoteNoCa')}
      </li>
      <li>
        {credentials.clientSubject
          ? t('takServerPanel.remoteClientSummary', {
              subject: credentials.clientSubject,
              date:
                credentials.clientExpiresAt != null
                  ? new Date(credentials.clientExpiresAt).toLocaleDateString()
                  : '',
            })
          : t('takServerPanel.remoteNoClient')}
      </li>
    </ul>
  );
}

interface FormProps {
  initial: TAKRemoteSettings;
  relay: ReturnType<typeof useTakRemoteRelay>;
}

function RemoteRelayForm({ initial, relay }: FormProps) {
  const { t } = useTranslation();
  const id = useId();
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port));
  const [verifyServer, setVerifyServer] = useState(initial.verifyServer);
  const [autoConnect, setAutoConnect] = useState(initial.autoConnect);
  const [password, setPassword] = useState('');

  const { status, credentials, isBusy, error } = relay;
  const active = status.state !== 'disconnected';
  const portNum = Number(port);
  const portValid = Number.isInteger(portNum) && portNum >= TCP_PORT_MIN && portNum <= TCP_PORT_MAX;
  const hostValid = isValidConnectHost(host);

  const statusLabel =
    status.state === 'connected'
      ? t('takServerPanel.remoteConnected', { host: status.host, port: status.port })
      : status.state === 'connecting'
        ? t('takServerPanel.remoteConnecting', { host: status.host, port: status.port })
        : t('takServerPanel.remoteDisconnected');

  const handleConnect = () => {
    if (!hostValid || !portValid) return;
    void relay.connect({ host: host.trim(), port: portNum, verifyServer, autoConnect });
  };

  const handleImport = async () => {
    await relay.importCredentials(password);
    setPassword('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`h-3 w-3 shrink-0 rounded-full ${STATUS_DOT[status.state]}`} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-200">{statusLabel}</p>
          {status.error && (
            <p className="text-xs break-words text-gray-400">
              {t('takServerPanel.remoteLastError', { error: status.error })}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor={`${id}-host`} className="mb-1 block text-xs text-gray-400">
            {t('takServerPanel.remoteHostLabel')}
          </label>
          <input
            id={`${id}-host`}
            aria-label={t('takServerPanel.remoteHostLabel')}
            type="text"
            maxLength={253}
            autoComplete="off"
            spellCheck={false}
            value={host}
            onChange={(e) => {
              setHost(e.target.value);
            }}
            disabled={active || isBusy}
            className={`${INPUT_CLASS} w-full`}
          />
          {host !== '' && !hostValid && (
            <p className="mt-1 text-xs text-red-400">{t('takServerPanel.remoteHostError')}</p>
          )}
        </div>
        <div>
          <label htmlFor={`${id}-port`} className="mb-1 block text-xs text-gray-400">
            {t('takServerPanel.remotePortLabel')}
          </label>
          <input
            id={`${id}-port`}
            aria-label={t('takServerPanel.remotePortLabel')}
            type="number"
            min={TCP_PORT_MIN}
            max={TCP_PORT_MAX}
            value={port}
            onChange={(e) => {
              setPort(e.target.value);
            }}
            disabled={active || isBusy}
            className={`${INPUT_CLASS} w-28`}
          />
          {port !== '' && !portValid && (
            <p className="mt-1 text-xs text-red-400">{t('takServerPanel.remotePortError')}</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            id={`${id}-verify`}
            aria-label={t('takServerPanel.remoteVerifyServer')}
            type="checkbox"
            checked={verifyServer}
            onChange={(e) => {
              setVerifyServer(e.target.checked);
            }}
            disabled={active || isBusy}
            className="accent-brand-green disabled:opacity-50"
          />
          <label htmlFor={`${id}-verify`} className="cursor-pointer text-sm text-gray-300">
            {t('takServerPanel.remoteVerifyServer')}
          </label>
        </div>
        {!verifyServer && (
          <p className="text-xs text-amber-300">{t('takServerPanel.remoteVerifyOffWarning')}</p>
        )}
        <div className="flex items-center gap-2">
          <input
            id={`${id}-autoconnect`}
            aria-label={t('takServerPanel.remoteAutoConnect')}
            type="checkbox"
            checked={autoConnect}
            onChange={(e) => {
              setAutoConnect(e.target.checked);
            }}
            disabled={active || isBusy}
            className="accent-brand-green disabled:opacity-50"
          />
          <label htmlFor={`${id}-autoconnect`} className="cursor-pointer text-sm text-gray-300">
            {t('takServerPanel.remoteAutoConnect')}
          </label>
        </div>
      </div>

      <div className="space-y-3 border-t border-gray-700 pt-4">
        <h4 className="text-xs font-medium text-gray-300">
          {t('takServerPanel.remoteCertificates')}
        </h4>
        <CredentialSummary credentials={credentials} />
        <p className="text-xs text-gray-400">{t('takServerPanel.remoteImportHint')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`${id}-password`} className="mb-1 block text-xs text-gray-400">
              {t('takServerPanel.remotePasswordLabel')}
            </label>
            <input
              id={`${id}-password`}
              aria-label={t('takServerPanel.remotePasswordLabel')}
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              disabled={active || isBusy}
              className={`${INPUT_CLASS} w-48`}
            />
          </div>
          <button
            type="button"
            onClick={handleImport}
            aria-label={t('takServerPanel.remoteImport')}
            disabled={active || isBusy}
            className="bg-secondary-dark rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 disabled:opacity-50"
          >
            {t('takServerPanel.remoteImport')}
          </button>
          {credentials && (credentials.caSubjects.length > 0 || credentials.clientSubject) && (
            <button
              type="button"
              onClick={relay.clearCredentials}
              aria-label={t('takServerPanel.remoteClear')}
              disabled={active || isBusy}
              className="bg-secondary-dark rounded-lg border border-gray-600 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:border-red-800 hover:text-red-300 disabled:opacity-50"
            >
              {t('takServerPanel.remoteClear')}
            </button>
          )}
        </div>
      </div>

      <div className="pt-1">
        {active ? (
          <button
            type="button"
            onClick={relay.disconnect}
            aria-label={t('takServerPanel.remoteDisconnect')}
            disabled={isBusy}
            className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
          >
            {t('takServerPanel.remoteDisconnect')}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            aria-label={t('takServerPanel.remoteConnect')}
            disabled={isBusy || !hostValid || !portValid}
            className="bg-readable-green hover:bg-readable-green/90 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
          >
            {t('takServerPanel.remoteConnect')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Relay to a remote TAK server; sits in the TAK panel beside the local server controls. */
export default function TakRemoteRelaySection() {
  const { t } = useTranslation();
  const relay = useTakRemoteRelay();
  return (
    <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-300">{t('takServerPanel.remoteTitle')}</h3>
      <p className="text-xs text-gray-400">{t('takServerPanel.remoteDescription')}</p>
      {/* The form seeds its fields from saved settings, so mount it once they have loaded. */}
      {relay.savedSettings !== undefined && (
        <RemoteRelayForm initial={relay.savedSettings ?? DEFAULT_REMOTE_SETTINGS} relay={relay} />
      )}
    </div>
  );
}
