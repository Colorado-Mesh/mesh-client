/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from './Toast';

interface SecurityConfig {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  adminKey: Uint8Array[];
  isManaged: boolean;
  serialEnabled: boolean;
  debugLogApiEnabled: boolean;
  adminChannelEnabled: boolean;
}

interface Props {
  onSetConfig: (config: unknown) => Promise<void>;
  onCommit: () => Promise<void>;
  isConnected: boolean;
  securityConfig: SecurityConfig | null;
  protocol?: 'meshtastic' | 'meshcore';
  onSignData?: (data: Uint8Array) => Promise<Uint8Array | null>;
  onExportPrivateKey?: () => Promise<Uint8Array | null>;
  onImportPrivateKey?: (privateKey: Uint8Array) => Promise<boolean>;
}

const KEY_BACKUP_STORAGE_KEY = 'mesh-client:key-backup';
const MAX_ADMIN_KEYS = 3;

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function isValidBase64Key(b64: string): boolean {
  try {
    const bytes = base64ToBytes(b64);
    return bytes.length === 32;
  } catch {
    return false; // catch-no-log-ok: pure validation helper, invalid input is expected
  }
}

// ─── Reusable UI components ────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="border-b border-gray-700 pb-2 text-sm font-semibold tracking-wide text-gray-200 uppercase">
      {title}
    </h3>
  );
}

function ConfigToggle({
  label,
  checked,
  onChange,
  disabled,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-300">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => {
            onChange(!checked);
          }}
          disabled={disabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
            checked ? 'bg-readable-green' : 'bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
      </div>
      {description && <p className="text-muted text-xs">{description}</p>}
    </div>
  );
}

function ApplyButton({
  label,
  onClick,
  applying,
  disabled,
}: {
  label: string;
  onClick: () => void;
  applying: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || applying}
      className="bg-readable-green hover:bg-readable-green/90 disabled:text-muted w-full rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:bg-gray-600"
    >
      {applying ? t('securityPanel.applying') : label}
    </button>
  );
}

// ─── Confirmation modal ─────────────────────────────────────────

function ConfirmModal({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-deep-black mx-4 w-full max-w-sm space-y-4 rounded-xl border border-gray-700 p-6">
        <p className="text-sm text-gray-200">{message}</p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg bg-gray-700 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-600"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
          >
            {t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────

export default function SecurityPanel({
  onSetConfig,
  onCommit,
  isConnected,
  securityConfig,
  protocol,
  onSignData,
  onExportPrivateKey,
  onImportPrivateKey,
}: Props) {
  const { addToast } = useToast();
  const { t } = useTranslation();
  const disabled = !isConnected;

  // ── Admin keys section state
  const [adminKeys, setAdminKeys] = useState<string[]>([]);
  const [adminKeyErrors, setAdminKeyErrors] = useState<(string | null)[]>([]);
  const [applyingAdmin, setApplyingAdmin] = useState(false);

  // ── Administration toggles state
  const [isManaged, setIsManaged] = useState(false);
  const [serialEnabled, setSerialEnabled] = useState(false);
  const [debugLogApiEnabled, setDebugLogApiEnabled] = useState(false);
  const [adminChannelEnabled, setAdminChannelEnabled] = useState(false);
  const [applyingToggles, setApplyingToggles] = useState(false);

  // ── Private key reveal
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  // ── Confirmation modal
  const [pendingRegenerate, setPendingRegenerate] = useState(false);
  const [applyingRegen, setApplyingRegen] = useState(false);

  // ── Backup status
  const [backupAvailable, setBackupAvailable] = useState(false);
  const [safeStorageAvailable, setSafeStorageAvailable] = useState<boolean | null>(null);
  const [backupInProgress, setBackupInProgress] = useState(false);

  // ── MeshCore crypto state
  const [signDataInput, setSignDataInput] = useState('');
  const [signDataResult, setSignDataResult] = useState<string | null>(null);
  const [signInProgress, setSignInProgress] = useState(false);
  const [exportedPrivateKey, setExportedPrivateKey] = useState<string | null>(null);
  const [exportInProgress, setExportInProgress] = useState(false);
  const [importKeyInput, setImportKeyInput] = useState('');
  const [importInProgress, setImportInProgress] = useState(false);

  // Sync local state from device config when it arrives
  useEffect(() => {
    if (!securityConfig) return;
    setAdminKeys(securityConfig.adminKey.map(bytesToBase64));
    setAdminKeyErrors(securityConfig.adminKey.map(() => null));
    setIsManaged(securityConfig.isManaged);
    setSerialEnabled(securityConfig.serialEnabled);
    setDebugLogApiEnabled(securityConfig.debugLogApiEnabled);
    setAdminChannelEnabled(securityConfig.adminChannelEnabled);
  }, [securityConfig]);

  // Check safeStorage availability and backup presence on mount
  useEffect(() => {
    void window.electronAPI.safeStorage
      .isAvailable()
      .then((available) => {
        setSafeStorageAvailable(available);
      })
      .catch(() => {
        setSafeStorageAvailable(false);
      });
    setBackupAvailable(localStorage.getItem(KEY_BACKUP_STORAGE_KEY) !== null);
  }, []);

  const applyConfig = useCallback(
    async (value: Partial<SecurityConfig>) => {
      if (!securityConfig) return;
      await onSetConfig({
        payloadVariant: {
          case: 'security',
          value: {
            ...securityConfig,
            ...value,
          },
        },
      });
      await onCommit();
    },
    [onSetConfig, onCommit, securityConfig],
  );

  // ── DM Key regeneration
  const handleRegenerate = useCallback(async () => {
    setPendingRegenerate(false);
    setApplyingRegen(true);
    try {
      await applyConfig({
        publicKey: new Uint8Array(32),
        privateKey: new Uint8Array(32),
      });
      addToast(t('securityPanel.keyRegenRequested'), 'success');
    } catch (err) {
      console.warn('[SecurityPanel] handleRegenerate', err);
      addToast(
        t('securityPanel.failed', {
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        'error',
      );
    } finally {
      setApplyingRegen(false);
    }
  }, [applyConfig, addToast, t]);

  // ── Admin keys apply
  const handleApplyAdminKeys = useCallback(async () => {
    const errors = adminKeys.map((k) => {
      if (k.trim() === '') return null;
      return isValidBase64Key(k) ? null : t('securityPanel.invalidAdminKey');
    });
    setAdminKeyErrors(errors);
    if (errors.some((e) => e !== null)) return;

    setApplyingAdmin(true);
    try {
      const parsed = adminKeys.filter((k) => k.trim() !== '').map((k) => base64ToBytes(k.trim()));
      await applyConfig({ adminKey: parsed });
      addToast(t('securityPanel.adminKeysApplied'), 'success');
    } catch (err) {
      console.warn('[SecurityPanel] handleApplyAdminKeys', err);
      addToast(
        t('securityPanel.failed', {
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        'error',
      );
    } finally {
      setApplyingAdmin(false);
    }
  }, [adminKeys, applyConfig, addToast, t]);

  // ── Administration toggles apply
  const handleApplyToggles = useCallback(async () => {
    setApplyingToggles(true);
    try {
      await applyConfig({ isManaged, serialEnabled, debugLogApiEnabled, adminChannelEnabled });
      addToast(t('securityPanel.adminSettingsApplied'), 'success');
    } catch (err) {
      console.warn('[SecurityPanel] handleApplyToggles', err);
      addToast(
        t('securityPanel.failed', {
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        'error',
      );
    } finally {
      setApplyingToggles(false);
    }
  }, [isManaged, serialEnabled, debugLogApiEnabled, adminChannelEnabled, applyConfig, addToast, t]);

  // ── Key backup
  const handleBackup = useCallback(async () => {
    if (!securityConfig || !safeStorageAvailable) return;
    setBackupInProgress(true);
    try {
      const payload = JSON.stringify({
        publicKey: bytesToBase64(securityConfig.publicKey),
        privateKey: bytesToBase64(securityConfig.privateKey),
      });
      const encrypted = await window.electronAPI.safeStorage.encrypt(payload);
      if (!encrypted) throw new Error('Encryption failed');
      localStorage.setItem(KEY_BACKUP_STORAGE_KEY, encrypted);
      setBackupAvailable(true);
      addToast(t('securityPanel.keysBackedUp'), 'success');
    } catch (err) {
      console.warn('[SecurityPanel] handleBackup', err);
      addToast(
        t('securityPanel.backupFailed', {
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        'error',
      );
    } finally {
      setBackupInProgress(false);
    }
  }, [securityConfig, safeStorageAvailable, addToast, t]);

  // ── Key restore
  const handleRestore = useCallback(async () => {
    if (!safeStorageAvailable) return;
    setBackupInProgress(true);
    try {
      const ciphertext = localStorage.getItem(KEY_BACKUP_STORAGE_KEY);
      if (!ciphertext) throw new Error('No backup found');
      const decrypted = await window.electronAPI.safeStorage.decrypt(ciphertext);
      if (!decrypted) throw new Error('Decryption failed');
      const parsed = JSON.parse(decrypted) as { publicKey: string; privateKey: string };
      const publicKey = base64ToBytes(parsed.publicKey);
      const privateKey = base64ToBytes(parsed.privateKey);
      await applyConfig({ publicKey, privateKey });
      addToast(t('securityPanel.keysRestored'), 'success');
    } catch (err) {
      console.warn('[SecurityPanel] handleRestore', err);
      addToast(
        t('securityPanel.restoreFailed', {
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        'error',
      );
    } finally {
      setBackupInProgress(false);
    }
  }, [safeStorageAvailable, applyConfig, addToast, t]);

  // ── MeshCore: Sign data
  const handleSignData = useCallback(async () => {
    if (!onSignData || !signDataInput.trim()) return;
    setSignInProgress(true);
    setSignDataResult(null);
    try {
      const dataBytes = new TextEncoder().encode(signDataInput);
      const signature = await onSignData(dataBytes);
      if (signature) {
        setSignDataResult(bytesToBase64(signature));
        addToast(t('securityPanel.dataSigned'), 'success');
      } else {
        addToast(t('securityPanel.signNoResult'), 'error');
      }
    } catch (err) {
      console.warn('[SecurityPanel] handleSignData', err);
      addToast(
        t('securityPanel.signFailed', {
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        'error',
      );
    } finally {
      setSignInProgress(false);
    }
  }, [onSignData, signDataInput, addToast, t]);

  // ── MeshCore: Export private key
  const handleExportPrivateKey = useCallback(async () => {
    if (!onExportPrivateKey) return;
    setExportInProgress(true);
    try {
      const key = await onExportPrivateKey();
      if (key) {
        setExportedPrivateKey(bytesToBase64(key));
        addToast(t('securityPanel.privateKeyExported'), 'success');
      } else {
        addToast(t('securityPanel.exportNoKey'), 'error');
      }
    } catch (err) {
      console.warn('[SecurityPanel] handleExportPrivateKey', err);
      addToast(
        t('securityPanel.exportFailed', {
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        'error',
      );
    } finally {
      setExportInProgress(false);
    }
  }, [onExportPrivateKey, addToast, t]);

  // ── MeshCore: Import private key
  const handleImportPrivateKey = useCallback(async () => {
    if (!onImportPrivateKey || !importKeyInput.trim()) return;
    setImportInProgress(true);
    try {
      const keyBytes = base64ToBytes(importKeyInput.trim());
      const success = await onImportPrivateKey(keyBytes);
      if (success) {
        addToast(t('securityPanel.privateKeyImported'), 'success');
        setImportKeyInput('');
      } else {
        addToast(t('securityPanel.importFailed'), 'error');
      }
    } catch (err) {
      console.warn('[SecurityPanel] handleImportPrivateKey', err);
      addToast(
        t('securityPanel.importFailedWithMessage', {
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        'error',
      );
    } finally {
      setImportInProgress(false);
    }
  }, [onImportPrivateKey, importKeyInput, addToast, t]);

  const publicKeyB64 = securityConfig ? bytesToBase64(securityConfig.publicKey) : '';
  const privateKeyB64 = securityConfig ? bytesToBase64(securityConfig.privateKey) : '';

  return (
    <div className="w-full max-w-5xl space-y-6 p-4">
      {!isConnected && (
        <p className="text-muted py-4 text-center text-sm">{t('securityPanel.connectToManage')}</p>
      )}

      {/* ── DM Keys ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader title={t('securityPanel.sectionDmKeys')} />
        <div className="space-y-1">
          <label htmlFor="security-public-key" className="text-muted text-sm">
            {t('securityPanel.publicKeyLabel')}
          </label>
          <input
            id="security-public-key"
            type="text"
            value={publicKeyB64}
            readOnly
            className="bg-secondary-dark w-full rounded-lg border border-gray-600 px-3 py-2 font-mono text-xs text-gray-200 disabled:opacity-50"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="security-private-key" className="text-muted text-sm">
            {t('securityPanel.privateKeyLabel')}
          </label>
          <div className="flex items-center gap-2">
            <input
              id="security-private-key"
              type={showPrivateKey ? 'text' : 'password'}
              value={privateKeyB64}
              readOnly
              className="bg-secondary-dark flex-1 rounded-lg border border-gray-600 px-3 py-2 font-mono text-xs text-gray-200 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => {
                setShowPrivateKey((s) => !s);
              }}
              disabled={disabled}
              className="text-muted px-3 py-2 text-xs hover:text-gray-300 disabled:opacity-50"
            >
              {showPrivateKey ? t('common.hide') : t('common.show')}
            </button>
          </div>
          <p className="text-muted text-xs">{t('securityPanel.privateKeyHint')}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setPendingRegenerate(true);
          }}
          disabled={disabled || applyingRegen || !securityConfig}
          className="w-full rounded-lg border border-yellow-700/60 bg-yellow-700/40 px-4 py-2 text-sm font-medium text-yellow-300 transition-colors hover:bg-yellow-700/60 disabled:opacity-50"
        >
          {applyingRegen ? t('securityPanel.regeneratingKeys') : t('securityPanel.regenerateKeys')}
        </button>
      </section>

      {/* ── Admin Keys ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader title={t('securityPanel.sectionAdminKeys')} />
        <p className="text-muted text-xs">
          {t('securityPanel.adminKeysIntro', { max: MAX_ADMIN_KEYS })}
        </p>
        <div className="space-y-3">
          {adminKeys.map((key, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={key}
                  onChange={(e) => {
                    const updated = [...adminKeys];
                    updated[i] = e.target.value;
                    setAdminKeys(updated);
                    const errs = [...adminKeyErrors];
                    errs[i] = null;
                    setAdminKeyErrors(errs);
                  }}
                  disabled={disabled}
                  placeholder={t('securityPanel.adminKeyPlaceholder')}
                  className="bg-secondary-dark focus:border-brand-green flex-1 rounded-lg border border-gray-600 px-3 py-2 font-mono text-xs text-gray-200 focus:outline-none disabled:opacity-50"
                  aria-label={t('securityPanel.adminKeyLabel', { number: i + 1 })}
                />
                <button
                  type="button"
                  onClick={() => {
                    setAdminKeys(adminKeys.filter((_, j) => j !== i));
                    setAdminKeyErrors(adminKeyErrors.filter((_, j) => j !== i));
                  }}
                  disabled={disabled}
                  className="px-2 py-2 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  aria-label={t('securityPanel.removeAdminKey', { number: i + 1 })}
                >
                  {t('securityPanel.removeAdminKeyButton')}
                </button>
              </div>
              {adminKeyErrors[i] && <p className="text-xs text-red-400">{adminKeyErrors[i]}</p>}
            </div>
          ))}
        </div>
        {adminKeys.length < MAX_ADMIN_KEYS && (
          <button
            type="button"
            onClick={() => {
              setAdminKeys([...adminKeys, '']);
              setAdminKeyErrors([...adminKeyErrors, null]);
            }}
            disabled={disabled}
            className="text-muted w-full rounded-lg border border-dashed border-gray-600 px-4 py-2 text-sm transition-colors hover:border-gray-500 hover:text-gray-300 disabled:opacity-50"
          >
            {t('securityPanel.addAdminKey')}
          </button>
        )}
        <ApplyButton
          label={t('securityPanel.applyAdminKeys')}
          onClick={() => {
            void handleApplyAdminKeys();
          }}
          applying={applyingAdmin}
          disabled={disabled || !securityConfig}
        />
      </section>

      {/* ── Administration Settings ──────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader title={t('securityPanel.sectionAdminSettings')} />
        <ConfigToggle
          label={t('securityPanel.managedDevice')}
          checked={isManaged}
          onChange={setIsManaged}
          disabled={disabled}
          description={t('securityPanel.managedDeviceDesc')}
        />
        <ConfigToggle
          label={t('securityPanel.serialConsole')}
          checked={serialEnabled}
          onChange={setSerialEnabled}
          disabled={disabled}
          description={t('securityPanel.serialConsoleDesc')}
        />
        <ConfigToggle
          label={t('securityPanel.debugLogApi')}
          checked={debugLogApiEnabled}
          onChange={setDebugLogApiEnabled}
          disabled={disabled}
          description={t('securityPanel.debugLogApiDesc')}
        />
        <ConfigToggle
          label={t('securityPanel.adminChannel')}
          checked={adminChannelEnabled}
          onChange={setAdminChannelEnabled}
          disabled={disabled}
          description={t('securityPanel.adminChannelDesc')}
        />
        <ApplyButton
          label={t('securityPanel.applySettings')}
          onClick={() => {
            void handleApplyToggles();
          }}
          applying={applyingToggles}
          disabled={disabled || !securityConfig}
        />
      </section>

      {/* ── Key Backup / Restore ─────────────────────────────────── */}
      <section className="space-y-4">
        <SectionHeader title={t('securityPanel.sectionKeyBackup')} />
        {safeStorageAvailable === false && (
          <p className="text-xs text-yellow-400">{t('securityPanel.keyBackupUnavailable')}</p>
        )}
        {safeStorageAvailable !== false && (
          <>
            <p className="text-muted text-xs">{t('securityPanel.keyBackupDesc')}</p>
            <div className="text-muted flex items-center gap-2 text-xs">
              <span
                className={`h-2 w-2 rounded-full ${backupAvailable ? 'bg-readable-green' : 'bg-gray-600'}`}
              />
              {backupAvailable
                ? t('securityPanel.backupAvailable')
                : t('securityPanel.noBackupStored')}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleBackup();
                }}
                disabled={disabled || backupInProgress || !securityConfig}
                className="bg-secondary-dark flex-1 rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                {backupInProgress ? t('securityPanel.working') : t('securityPanel.backupKeys')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleRestore();
                }}
                disabled={disabled || backupInProgress || !backupAvailable}
                className="bg-secondary-dark flex-1 rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                {backupInProgress ? t('securityPanel.working') : t('securityPanel.restoreKeys')}
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── MeshCore Crypto Operations ───────────────────────────────── */}
      {protocol === 'meshcore' && (onSignData || onExportPrivateKey || onImportPrivateKey) && (
        <section className="space-y-4">
          <SectionHeader title={t('securityPanel.sectionMeshcoreCrypto')} />
          <p className="text-muted text-xs">{t('securityPanel.meshcoreCryptoDesc')}</p>

          {/* Sign Data */}
          {onSignData && (
            <div className="space-y-2">
              <label htmlFor="meshcore-sign-input" className="text-muted text-sm">
                {t('securityPanel.signDataLabel')}
              </label>
              <textarea
                id="meshcore-sign-input"
                value={signDataInput}
                onChange={(e) => {
                  setSignDataInput(e.target.value);
                }}
                placeholder={t('securityPanel.signTextPlaceholder')}
                disabled={disabled || signInProgress}
                className="bg-secondary-dark focus:ring-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 font-mono text-xs text-gray-200 focus:ring-1 focus:outline-none disabled:opacity-50"
                rows={2}
              />
              <button
                type="button"
                onClick={() => {
                  void handleSignData();
                }}
                disabled={disabled || signInProgress || !signDataInput.trim()}
                className="bg-secondary-dark w-full rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                {signInProgress ? t('securityPanel.signing') : t('securityPanel.signDataButton')}
              </button>
              {signDataResult && (
                <div className="space-y-1">
                  <span className="text-muted text-xs">
                    {t('securityPanel.signatureBase64Label')}
                  </span>
                  <div className="bg-secondary-dark rounded border border-gray-600 p-2 font-mono text-xs break-all text-gray-200">
                    {signDataResult}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Export Private Key */}
          {onExportPrivateKey && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  void handleExportPrivateKey();
                }}
                disabled={disabled || exportInProgress}
                className="bg-secondary-dark w-full rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                {exportInProgress
                  ? t('securityPanel.exportingPrivateKey')
                  : t('securityPanel.exportPrivateKeyButton')}
              </button>
              {exportedPrivateKey && (
                <div className="space-y-1">
                  <span className="text-muted text-xs">
                    {t('securityPanel.privateKeyBase64Label')}
                  </span>
                  <div className="bg-secondary-dark rounded border border-gray-600 p-2 font-mono text-xs break-all text-gray-200">
                    {exportedPrivateKey}
                  </div>
                  <p className="text-xs text-yellow-400">{t('securityPanel.exportKeyWarning')}</p>
                </div>
              )}
            </div>
          )}

          {/* Import Private Key */}
          {onImportPrivateKey && (
            <div className="space-y-2">
              <label htmlFor="meshcore-import-key" className="text-muted text-sm">
                {t('securityPanel.importPrivateKeyLabel')}
              </label>
              <textarea
                id="meshcore-import-key"
                value={importKeyInput}
                onChange={(e) => {
                  setImportKeyInput(e.target.value);
                }}
                placeholder={t('securityPanel.importKeyPlaceholder')}
                disabled={disabled || importInProgress}
                className="bg-secondary-dark focus:ring-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 font-mono text-xs text-gray-200 focus:ring-1 focus:outline-none disabled:opacity-50"
                rows={2}
              />
              <button
                type="button"
                onClick={() => {
                  void handleImportPrivateKey();
                }}
                disabled={disabled || importInProgress || !importKeyInput.trim()}
                className="bg-secondary-dark w-full rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                {importInProgress
                  ? t('securityPanel.importingPrivateKey')
                  : t('securityPanel.importPrivateKeyButton')}
              </button>
            </div>
          )}
        </section>
      )}

      {pendingRegenerate && (
        <ConfirmModal
          message={t('securityPanel.regenerateKeysConfirm')}
          onConfirm={() => {
            void handleRegenerate();
          }}
          onCancel={() => {
            setPendingRegenerate(false);
          }}
        />
      )}
    </div>
  );
}
