/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { IdentityVaultStatus } from '@/shared/electron-api.types';

import { INPUT_BOX_CLASS } from './ui/formClasses';

export interface IdentityVaultPanelProps {
  disabled?: boolean;
  /** Optional identity backup JSON to encrypt when enabling the vault. */
  secret?: string | null;
}

export function IdentityVaultPanel({ disabled = false, secret = null }: IdentityVaultPanelProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<IdentityVaultStatus>({ configured: false, unlocked: false });
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await window.electronAPI.vault.status());
    } catch (e) {
      console.warn('[IdentityVaultPanel] status ' + errLikeToLogString(e));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleSetPasscode = async () => {
    if (passcode.length < 8) {
      setError(t('identityVault.passcodeTooShort'));
      return;
    }
    if (passcode !== confirmPasscode) {
      setError(t('identityVault.passcodeMismatch'));
      return;
    }
    const vaultSecret = secret?.trim() || 'mesh-client-reticulum-vault';
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await window.electronAPI.vault.setPasscode(passcode, vaultSecret);
      if (!res.ok) {
        setError(res.error ?? t('identityVault.setFailed'));
        return;
      }
      setPasscode('');
      setConfirmPasscode('');
      setMessage(t('identityVault.setSuccess'));
      await refreshStatus();
    } catch (e) {
      // catch-no-log-ok surfaced inline via setError
      setError(errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await window.electronAPI.vault.unlock(passcode);
      if (!res.ok) {
        setError(res.error ?? t('identityVault.unlockFailed'));
        return;
      }
      setPasscode('');
      setMessage(t('identityVault.unlockSuccess'));
      await refreshStatus();
    } catch (e) {
      // catch-no-log-ok surfaced inline via setError
      setError(errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await window.electronAPI.vault.lock();
      setMessage(t('identityVault.lockSuccess'));
      await refreshStatus();
    } catch (e) {
      // catch-no-log-ok surfaced inline via setError
      setError(errLikeToLogString(e));
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = status.unlocked
    ? t('identityVault.statusUnlocked')
    : status.configured
      ? t('identityVault.statusLocked')
      : t('identityVault.statusNotConfigured');

  return (
    <div
      data-setting-anchor="radio.reticulumIdentity.vaultPasscode"
      className="border-ink-700 bg-ink-900/40 mt-3 space-y-2 rounded-lg border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-ink-200 text-sm font-medium">{t('identityVault.title')}</h4>
        <span
          className={
            status.unlocked
              ? 'text-xs text-green-400'
              : status.configured
                ? 'text-xs text-orange-300'
                : 'text-ink-400 text-xs'
          }
        >
          {statusLabel}
        </span>
      </div>
      <p className="text-muted text-xs">{t('identityVault.hint')}</p>

      {!status.configured ? (
        <div className="space-y-2">
          <label className="text-ink-400 block text-xs">
            {t('identityVault.passcode')}
            <input
              type="password"
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
              }}
              autoComplete="new-password"
              disabled={disabled || busy}
              className={`${INPUT_BOX_CLASS} mt-1 block w-full`}
            />
          </label>
          <label className="text-ink-400 block text-xs">
            {t('identityVault.confirmPasscode')}
            <input
              type="password"
              value={confirmPasscode}
              onChange={(e) => {
                setConfirmPasscode(e.target.value);
              }}
              autoComplete="new-password"
              disabled={disabled || busy}
              className={`${INPUT_BOX_CLASS} mt-1 block w-full`}
            />
          </label>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              void handleSetPasscode();
            }}
            className="border-ink-600 text-ink-300 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
          >
            {t('identityVault.setPasscode')}
          </button>
        </div>
      ) : status.unlocked ? (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => {
            void handleLock();
          }}
          className="border-ink-600 text-ink-300 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
          aria-label={t('identityVault.lock')}
        >
          {t('identityVault.lock')}
        </button>
      ) : (
        <div className="space-y-2">
          <label className="text-ink-400 block text-xs">
            {t('identityVault.passcode')}
            <input
              type="password"
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
              }}
              autoComplete="current-password"
              disabled={disabled || busy}
              className={`${INPUT_BOX_CLASS} mt-1 block w-full`}
            />
          </label>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              void handleUnlock();
            }}
            className="border-ink-600 text-ink-300 hover:bg-ink-800 rounded border px-2 py-1 text-xs disabled:opacity-40"
          >
            {t('identityVault.unlock')}
          </button>
        </div>
      )}

      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="text-xs text-green-400">{message}</p> : null}
    </div>
  );
}

export default IdentityVaultPanel;
