import { Lock, LockOpen } from 'lucide-react-motion';
import { useId, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import {
  getMeshtasticLockdownStatus,
  type MeshtasticLockdownAuthRequest,
  subscribeMeshtasticLockdownStatus,
} from '@/renderer/lib/meshtastic/meshtasticLockdown';

interface Props {
  isConnected: boolean;
  onSendLockdownAuth: (auth: MeshtasticLockdownAuthRequest) => Promise<void>;
}

/**
 * Firmware lockdown (`LockdownStatus` / `AdminMessage.lockdown_auth`).
 *
 * Rendered only when the provider advertises `hasLockdown`; a radio running
 * firmware without lockdown simply never sends a status, so the section stays
 * in its "not reported" state.
 */
export default function LockdownSection({ isConnected, onSendLockdownAuth }: Props) {
  const { t } = useTranslation();
  const id = useId();
  // useSyncExternalStore, not subscribe-in-effect: a status arriving between the first
  // render and the effect would otherwise be dropped.
  const status = useSyncExternalStore(
    subscribeMeshtasticLockdownStatus,
    getMeshtasticLockdownStatus,
  );
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (auth: MeshtasticLockdownAuthRequest): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onSendLockdownAuth(auth);
      setPassphrase('');
    } catch (e) {
      console.warn('[lockdown] auth request failed', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const state = status?.state ?? null;
  const locked = state === 'LOCKED' || state === 'UNLOCK_FAILED';
  const passphraseRequired = passphrase.trim() === '';
  const controlsDisabled = !isConnected || busy;

  return (
    <div className="bg-secondary-dark space-y-3 rounded-lg p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium text-gray-300">
        {locked ? (
          <Lock className="h-4 w-4 text-amber-400" aria-hidden="true" />
        ) : (
          <LockOpen className="h-4 w-4 text-green-400" aria-hidden="true" />
        )}
        {t('radioPanel.lockdown.title')}
      </h3>
      <p className="text-xs text-gray-400">{t('radioPanel.lockdown.description')}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-gray-500">{t('radioPanel.lockdown.stateLabel')}</dt>
        <dd className="text-gray-200">
          {state === null
            ? t('radioPanel.lockdown.stateNotReported')
            : t(`radioPanel.lockdown.states.${state}`)}
        </dd>
        {status?.lockReason !== undefined && (
          <>
            <dt className="text-gray-500">{t('radioPanel.lockdown.reasonLabel')}</dt>
            <dd className="text-gray-200">{status.lockReason}</dd>
          </>
        )}
        {status?.bootsRemaining !== undefined && (
          <>
            <dt className="text-gray-500">{t('radioPanel.lockdown.bootsRemainingLabel')}</dt>
            <dd className="text-gray-200">{status.bootsRemaining}</dd>
          </>
        )}
        {status?.validUntilEpoch !== undefined && (
          <>
            <dt className="text-gray-500">{t('radioPanel.lockdown.validUntilLabel')}</dt>
            <dd className="text-gray-200">
              {new Date(status.validUntilEpoch * 1000).toLocaleString()}
            </dd>
          </>
        )}
        {status?.backoffSeconds !== undefined && (
          <>
            <dt className="text-gray-500">{t('radioPanel.lockdown.backoffLabel')}</dt>
            <dd className="text-amber-300">
              {t('radioPanel.lockdown.backoffValue', { seconds: status.backoffSeconds })}
            </dd>
          </>
        )}
      </dl>

      <div className="space-y-2">
        <label htmlFor={`${id}-passphrase`} className="block text-xs text-gray-400">
          {t('radioPanel.lockdown.passphraseLabel')}
        </label>
        <input
          id={`${id}-passphrase`}
          type="password"
          value={passphrase}
          autoComplete="off"
          onChange={(e) => {
            setPassphrase(e.target.value);
          }}
          disabled={controlsDisabled}
          aria-label={t('radioPanel.lockdown.passphraseLabel')}
          className="bg-deep-black w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={controlsDisabled || passphraseRequired}
          onClick={() => void send({ passphrase: passphrase.trim() })}
          aria-label={t('radioPanel.lockdown.unlockAria')}
          className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-gray-500 disabled:opacity-50"
        >
          {state === 'NEEDS_PROVISION'
            ? t('radioPanel.lockdown.provision')
            : t('radioPanel.lockdown.unlock')}
        </button>
        <button
          type="button"
          disabled={controlsDisabled || passphraseRequired}
          onClick={() => void send({ passphrase: passphrase.trim(), lockNow: true })}
          aria-label={t('radioPanel.lockdown.lockNowAria')}
          className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-gray-500 disabled:opacity-50"
        >
          {t('radioPanel.lockdown.lockNow')}
        </button>
        <button
          type="button"
          disabled={controlsDisabled || passphraseRequired}
          onClick={() => void send({ passphrase: passphrase.trim(), disable: true })}
          aria-label={t('radioPanel.lockdown.disableAria')}
          className="rounded border border-gray-600 px-3 py-1.5 text-xs font-medium text-gray-200 hover:border-gray-500 disabled:opacity-50"
        >
          {t('radioPanel.lockdown.disable')}
        </button>
      </div>

      {error !== null && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
