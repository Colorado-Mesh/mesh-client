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
import { INPUT_BOX_CLASS } from './ui/formClasses';

const DEFAULT_REMOTE_SETTINGS: TAKRemoteSettings = {
  host: '',
  port: 8089,
  verifyServer: true,
  allowNameMismatch: false,
  autoConnect: false,
};

const STATUS_DOT: Record<TAKRemoteStatus['state'], string> = {
  connected: 'bg-green-500',
  connecting: 'bg-orange-500',
  disconnected: 'bg-ink-500',
};

function CredentialSummary({ credentials }: { credentials: TAKRemoteCredentialSummary | null }) {
  const { t } = useTranslation();
  if (!credentials) return null;
  return (
    <ul className="text-ink-400 space-y-1 text-xs">
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
  const [allowNameMismatch, setAllowNameMismatch] = useState(initial.allowNameMismatch);
  const [autoConnect, setAutoConnect] = useState(initial.autoConnect);
  const [password, setPassword] = useState('');

  const { status, credentials, isBusy, error } = relay;
  // The name-mismatch opt-out only applies when trust is pinned to an imported CA.
  const hasCa = (credentials?.caSubjects.length ?? 0) > 0;
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
    void relay.connect({
      host: host.trim(),
      port: portNum,
      verifyServer,
      allowNameMismatch: allowNameMismatch && hasCa,
      // An unverified relay is only started by hand, never at launch.
      autoConnect: autoConnect && verifyServer,
    });
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
          <p className="text-ink-200 text-sm font-medium">{statusLabel}</p>
          {status.error && (
            <p className="text-ink-400 text-xs break-words">
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
          <label htmlFor={`${id}-host`} className="text-ink-400 mb-1 block text-xs">
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
            className={`${INPUT_BOX_CLASS} w-full`}
          />
          {host !== '' && !hostValid && (
            <p className="mt-1 text-xs text-red-400">{t('takServerPanel.remoteHostError')}</p>
          )}
        </div>
        <div>
          <label htmlFor={`${id}-port`} className="text-ink-400 mb-1 block text-xs">
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
            className={`${INPUT_BOX_CLASS} w-28`}
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
          <label htmlFor={`${id}-verify`} className="text-ink-300 cursor-pointer text-sm">
            {t('takServerPanel.remoteVerifyServer')}
          </label>
        </div>
        {verifyServer ? (
          <div className="flex items-center gap-2 pl-6">
            <input
              id={`${id}-name-mismatch`}
              aria-label={t('takServerPanel.remoteAllowNameMismatch')}
              type="checkbox"
              checked={allowNameMismatch && hasCa}
              onChange={(e) => {
                setAllowNameMismatch(e.target.checked);
              }}
              disabled={active || isBusy || !hasCa}
              className="accent-brand-green disabled:opacity-50"
            />
            <label htmlFor={`${id}-name-mismatch`} className="text-ink-300 cursor-pointer text-sm">
              {t('takServerPanel.remoteAllowNameMismatch')}
            </label>
          </div>
        ) : (
          <p className="text-xs text-orange-300">
            {t('takServerPanel.remoteVerifyOffWarning')}{' '}
            {t('takServerPanel.remoteAutoConnectNeedsVerify')}
          </p>
        )}
        {verifyServer && !hasCa && (
          <p className="text-ink-400 pl-6 text-xs">
            {t('takServerPanel.remoteNameMismatchNeedsCa')}
          </p>
        )}
        <div className="flex items-center gap-2">
          <input
            id={`${id}-autoconnect`}
            aria-label={t('takServerPanel.remoteAutoConnect')}
            type="checkbox"
            checked={autoConnect && verifyServer}
            onChange={(e) => {
              setAutoConnect(e.target.checked);
            }}
            disabled={active || isBusy || !verifyServer}
            className="accent-brand-green disabled:opacity-50"
          />
          <label htmlFor={`${id}-autoconnect`} className="text-ink-300 cursor-pointer text-sm">
            {t('takServerPanel.remoteAutoConnect')}
          </label>
        </div>
      </div>

      <div className="border-ink-700 space-y-3 border-t pt-4">
        <h4 className="text-ink-300 text-xs font-medium">
          {t('takServerPanel.remoteCertificates')}
        </h4>
        <CredentialSummary credentials={credentials} />
        <p className="text-ink-400 text-xs">{t('takServerPanel.remoteImportHint')}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`${id}-password`} className="text-ink-400 mb-1 block text-xs">
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
              className={`${INPUT_BOX_CLASS} w-48`}
            />
          </div>
          <button
            type="button"
            onClick={handleImport}
            aria-label={t('takServerPanel.remoteImport')}
            disabled={active || isBusy}
            className="bg-secondary-dark border-ink-600 text-ink-200 hover:border-ink-500 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {t('takServerPanel.remoteImport')}
          </button>
          {credentials && (credentials.caSubjects.length > 0 || credentials.clientSubject) && (
            <button
              type="button"
              onClick={relay.clearCredentials}
              aria-label={t('takServerPanel.remoteClear')}
              disabled={active || isBusy}
              className="bg-secondary-dark border-ink-600 text-ink-300 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:border-red-800 hover:text-red-300 disabled:opacity-50"
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
            className="bg-brand-green hover:bg-brand-green/90 text-app-bg rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
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
    <div className="bg-deep-black border-ink-800 space-y-3 rounded-xl border p-4">
      <h3 className="text-ink-300 text-sm font-medium">{t('takServerPanel.remoteTitle')}</h3>
      <p className="text-ink-400 text-xs">{t('takServerPanel.remoteDescription')}</p>
      {/* The form seeds its fields from saved settings, so mount it once they have loaded. */}
      {relay.savedSettings !== undefined && (
        <RemoteRelayForm initial={relay.savedSettings ?? DEFAULT_REMOTE_SETTINGS} relay={relay} />
      )}
    </div>
  );
}
