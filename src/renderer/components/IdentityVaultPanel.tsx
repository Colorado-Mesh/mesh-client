/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { IdentityVaultStatus } from '@/shared/electron-api.types';

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
    if (passcode.length < 4) {
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
    <div className="mt-3 space-y-2 rounded-lg border border-gray-700 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-gray-200">{t('identityVault.title')}</h4>
        <span
          className={
            status.unlocked
              ? 'text-xs text-green-400'
              : status.configured
                ? 'text-xs text-amber-300'
                : 'text-xs text-gray-400'
          }
        >
          {statusLabel}
        </span>
      </div>
      <p className="text-muted text-xs">{t('identityVault.hint')}</p>

      {!status.configured ? (
        <div className="space-y-2">
          <label className="block text-xs text-gray-400">
            {t('identityVault.passcode')}
            <input
              type="password"
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
              }}
              autoComplete="new-password"
              disabled={disabled || busy}
              className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-200"
            />
          </label>
          <label className="block text-xs text-gray-400">
            {t('identityVault.confirmPasscode')}
            <input
              type="password"
              value={confirmPasscode}
              onChange={(e) => {
                setConfirmPasscode(e.target.value);
              }}
              autoComplete="new-password"
              disabled={disabled || busy}
              className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-200"
            />
          </label>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              void handleSetPasscode();
            }}
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
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
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
          aria-label={t('identityVault.lock')}
        >
          {t('identityVault.lock')}
        </button>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs text-gray-400">
            {t('identityVault.passcode')}
            <input
              type="password"
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value);
              }}
              autoComplete="current-password"
              disabled={disabled || busy}
              className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-200"
            />
          </label>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => {
              void handleUnlock();
            }}
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
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
