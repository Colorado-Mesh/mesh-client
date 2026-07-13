/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import { invalidateReticulumInterfacesCache } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { parseReticulumStackSettingsPayload } from '@/renderer/lib/reticulum/reticulumStackSettings';
import {
  type ReticulumIdentityStatus,
  useReticulumSidecarApi,
} from '@/renderer/lib/reticulum/useReticulumSidecarApi';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

import { refreshReticulumPeersFromSidecar } from '../stores/reticulumPeerStore';
import { ConfirmModal } from './ConfirmModal';
import { IdentityVaultPanel } from './IdentityVaultPanel';
import { ReticulumAnnounceControls } from './ReticulumAnnounceControls';
import ReticulumPropagationSection from './ReticulumPropagationSection';
import { ReticulumRmapDiscoveryControls } from './ReticulumRmapDiscoveryControls';

type IdentityReplaceAction = 'generate' | 'importPhrase' | 'importBackup' | 'importPrivate';

function formatIdentityApiError(t: (key: string) => string, error: string | undefined): string {
  switch (error) {
    case 'identity_already_configured':
      return t('connectionPanel.reticulumIdentity.identityAlreadyConfigured');
    case 'invalid seed phrase: expected 12 valid BIP-39 English words':
      return t('connectionPanel.reticulumIdentity.invalidMnemonic');
    case 'identity file missing; re-import or generate identity':
      return t('connectionPanel.reticulumIdentity.identityFileMissing');
    case 'backup_hash_mismatch_with_identity_file':
      return t('connectionPanel.reticulumIdentity.backupHashMismatch');
    case 'identity operations require an rns-stack sidecar build':
      return t('connectionPanel.reticulumIdentity.importPrivateKeyRequiresStack');
    case 'invalid private key length: expected 64, got 0':
    default:
      if (error?.startsWith('invalid private key length')) {
        return t('connectionPanel.reticulumIdentity.invalidPrivateKeyLength');
      }
      if (error?.includes('BIP-39')) {
        return t('connectionPanel.reticulumIdentity.invalidMnemonic');
      }
      return error ?? t('connectionPanel.reticulumIdentity.failed');
  }
}

function ReticulumCollapsibleSection({
  title,
  children,
  defaultOpen = false,
  danger = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  danger?: boolean;
}) {
  return (
    <details
      className={`group bg-deep-black/50 rounded-lg border ${danger ? 'border-red-900/50' : 'border-gray-700'}`}
      open={defaultOpen || undefined}
    >
      <summary
        className={`flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium transition-colors hover:bg-gray-800 ${
          danger ? 'text-red-300' : 'text-gray-200'
        }`}
      >
        <span>{title}</span>
        <DetailsChevron />
      </summary>
      <div className="space-y-4 px-4 pb-4">{children}</div>
    </details>
  );
}

export interface ReticulumNetworkPanelProps {
  connecting: boolean;
  onStartStack: () => Promise<void>;
  onOpenAppGpsSettings?: () => void;
}

/** Network tab: identity, stack settings, propagation, config import. */
export function ReticulumNetworkPanel({
  connecting,
  onStartStack,
  onOpenAppGpsSettings,
}: ReticulumNetworkPanelProps) {
  const { t } = useTranslation();
  const sidecarEventRef = useRef<(evt: ReticulumSidecarEvent) => void>(() => {});

  const { sidecarApiReady, identity, statsSummary, appInfo, refreshIdentity } =
    useReticulumSidecarApi({
      connecting,
      onStartStack,
      onEvent: (evt) => {
        sidecarEventRef.current(evt);
      },
    });

  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [importPhrase, setImportPhrase] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [confirmSaved, setConfirmSaved] = useState(false);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [importBackupJson, setImportBackupJson] = useState('');
  const [importPrivateKey, setImportPrivateKey] = useState('');
  const [showReplaceIdentityConfirm, setShowReplaceIdentityConfirm] = useState(false);
  const [pendingReplaceAction, setPendingReplaceAction] = useState<IdentityReplaceAction | null>(
    null,
  );
  const [configPaste, setConfigPaste] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [pendingImportMode, setPendingImportMode] = useState<'merge' | 'replace'>('merge');
  const [stackSettings, setStackSettings] = useState({
    enable_transport: false,
    share_instance: true,
    loglevel: 4,
  });

  const refreshStackSettings = useCallback(async () => {
    if (!sidecarApiReady) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet(
        '/api/v1/stack/settings',
      )) as typeof stackSettings;
      setStackSettings({
        enable_transport: body.enable_transport,
        share_instance: body.share_instance,
        loglevel: typeof body.loglevel === 'number' ? body.loglevel : 4,
      });
    } catch (e) {
      console.debug('[ReticulumNetworkPanel] stack settings ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  const refreshPeers = useCallback(async () => {
    if (!sidecarApiReady) return;
    try {
      await refreshReticulumPeersFromSidecar();
    } catch (e) {
      console.debug('[ReticulumNetworkPanel] peers ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  useEffect(() => {
    sidecarEventRef.current = (evt: ReticulumSidecarEvent) => {
      if (evt.type === 'interface.state' || evt.type === 'stats_update') {
        invalidateReticulumInterfacesCache();
      }
      if (
        evt.type === 'peers_updated' ||
        evt.type === 'stats_update' ||
        evt.type === 'announce.received'
      ) {
        void refreshPeers();
      }
    };
  }, [refreshPeers]);

  useEffect(() => {
    if (!sidecarApiReady) return;
    void refreshStackSettings();
    void refreshPeers();
  }, [sidecarApiReady, refreshStackSettings, refreshPeers]);

  const handleExportIdentity = async () => {
    const passphrase = exportPassphrase.trim();
    if (!passphrase) {
      setIdentityError(t('connectionPanel.reticulumIdentity.exportPassphraseRequired'));
      return;
    }
    setIdentityError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/export', {
        passphrase,
      })) as { ok?: boolean; backup?: unknown; error?: string };
      if (!res.ok) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumIdentity.failed'));
        return;
      }
      setExportJson(
        typeof res.backup === 'string' ? res.backup : JSON.stringify(res.backup, null, 2),
      );
    } catch (e) {
      // catch-no-log-ok: export failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleGenerate = async (replace = false) => {
    if (!sidecarApiReady) return;
    setIdentityError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/generate', {
        display_name: displayName.trim() || null,
        replace,
      })) as {
        ok?: boolean;
        mnemonic?: string;
        error?: string;
      };
      if (!res.ok) {
        if (res.error === 'identity_already_configured' && !replace) {
          setPendingReplaceAction('generate');
          setShowReplaceIdentityConfirm(true);
          return;
        }
        setIdentityError(formatIdentityApiError(t, res.error));
        return;
      }
      setMnemonic(res.mnemonic ?? null);
      setConfirmSaved(false);
      setImportPrivateKey('');
      setImportBackupJson('');
      await refreshIdentity();
    } catch (e) {
      // catch-no-log-ok: export failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleImportIdentity = async (replace = false) => {
    if (!sidecarApiReady) return;
    setIdentityError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/import', {
        mnemonic: importPhrase.trim(),
        display_name: displayName.trim() || null,
        replace,
      })) as { ok?: boolean; error?: string };
      if (!res.ok) {
        if (res.error === 'identity_already_configured' && !replace) {
          setPendingReplaceAction('importPhrase');
          setShowReplaceIdentityConfirm(true);
          return;
        }
        setIdentityError(formatIdentityApiError(t, res.error));
        return;
      }
      setImportPhrase('');
      setImportPrivateKey('');
      setImportBackupJson('');
      setMnemonic(null);
      await refreshIdentity();
    } catch (e) {
      // catch-no-log-ok: export failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleImportBackup = async (replace = false) => {
    if (!sidecarApiReady) return;
    const raw = importBackupJson.trim();
    if (!raw) return;
    setIdentityError(null);
    let backup: unknown;
    try {
      backup = JSON.parse(raw) as unknown;
    } catch {
      // catch-no-log-ok: invalid JSON shown via setIdentityError
      setIdentityError(t('connectionPanel.reticulumIdentity.failed'));
      return;
    }
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/import-backup', {
        backup,
        display_name: displayName.trim() || null,
        replace,
      })) as { ok?: boolean; error?: string; metadata_only?: boolean };
      if (!res.ok) {
        if (res.error === 'identity_already_configured' && !replace) {
          setPendingReplaceAction('importBackup');
          setShowReplaceIdentityConfirm(true);
          return;
        }
        setIdentityError(formatIdentityApiError(t, res.error));
        return;
      }
      setImportBackupJson('');
      await refreshIdentity();
    } catch (e) {
      // catch-no-log-ok: import failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleImportPrivateKey = async (replace = false, privateKeyValue?: string) => {
    if (!sidecarApiReady) return;
    const privateKey = (privateKeyValue ?? importPrivateKey).trim();
    if (!privateKey) return;
    setIdentityError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/import-private', {
        private_key: privateKey,
        display_name: displayName.trim() || null,
        replace,
      })) as { ok?: boolean; error?: string };
      if (!res.ok) {
        if (res.error === 'identity_already_configured' && !replace) {
          setPendingReplaceAction('importPrivate');
          setShowReplaceIdentityConfirm(true);
          return;
        }
        setIdentityError(formatIdentityApiError(t, res.error));
        return;
      }
      setImportPrivateKey('');
      setImportPhrase('');
      setImportBackupJson('');
      setMnemonic(null);
      await refreshIdentity();
    } catch (e) {
      // catch-no-log-ok: import failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleImportPrivateKeyFromFile = async () => {
    try {
      const result = await window.electronAPI.reticulum.showIdentityImportDialog();
      if (!result.contentBase64) {
        if (result.error === 'invalid_private_key_length') {
          setIdentityError(t('connectionPanel.reticulumIdentity.invalidPrivateKeyLength'));
        }
        return;
      }
      await handleImportPrivateKey(false, result.contentBase64);
    } catch (e) {
      // catch-no-log-ok: file import failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const runPendingReplaceAction = () => {
    setShowReplaceIdentityConfirm(false);
    const action = pendingReplaceAction;
    setPendingReplaceAction(null);
    if (action === 'generate') void handleGenerate(true);
    else if (action === 'importPhrase') void handleImportIdentity(true);
    else if (action === 'importBackup') void handleImportBackup(true);
    else if (action === 'importPrivate') void handleImportPrivateKey(true);
  };

  const runConfigImport = async (mode: 'merge' | 'replace', content: string) => {
    const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/config/import', {
      content,
      mode,
    })) as { ok?: boolean; warnings?: string[]; error?: string };
    if (!res.ok) {
      setIdentityError(res.error ?? t('networkPanel.reticulumConfigImportFailed'));
      return;
    }
    setImportWarnings(res.warnings ?? []);
    setConfigPaste('');
    invalidateReticulumInterfacesCache();
    await refreshStackSettings();
  };

  const handleImportConfig = (mode: 'merge' | 'replace') => {
    const content = configPaste.trim();
    if (!content) return;
    setPendingImportMode(mode);
    setShowImportConfirm(true);
  };

  const handleImportFromSystem = async () => {
    try {
      const result = await window.electronAPI.reticulum.readDefaultConfigFile();
      if (!result.content) {
        setIdentityError(t('networkPanel.reticulumConfigNotFound'));
        return;
      }
      setConfigPaste(result.content);
      setPendingImportMode('merge');
      setShowImportConfirm(true);
    } catch (e) {
      // catch-no-log-ok: export failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleImportFromFile = async () => {
    try {
      const result = await window.electronAPI.reticulum.showConfigImportDialog();
      if (!result.content) return;
      setConfigPaste(result.content);
      setPendingImportMode('merge');
      setShowImportConfirm(true);
    } catch (e) {
      // catch-no-log-ok: export failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const saveStackSettings = async () => {
    try {
      const current = parseReticulumStackSettingsPayload(
        await window.electronAPI.reticulum.proxyGet('/api/v1/stack/settings'),
      );
      const res = (await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', {
        ...stackSettings,
        announce_interval_sec: current.announce_interval_sec,
      })) as { ok?: boolean; error?: string };
      if (res?.ok === false) {
        setIdentityError(res.error ?? t('networkPanel.reticulumStackSettings.saveFailed'));
        return;
      }
      await refreshStackSettings();
    } catch (e) {
      // catch-no-log-ok: stack settings save failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const identityReady = identity?.configured === true;
  const identityActionsDisabled = !sidecarApiReady || connecting;

  return (
    <div className="space-y-4">
      {!sidecarApiReady ? (
        <p className="rounded-lg border border-amber-600/40 bg-amber-950/20 p-3 text-sm text-amber-200">
          {t('connectionPanel.reticulumIdentity.startStackFirst')}
        </p>
      ) : null}

      <ReticulumCollapsibleSection title={t('networkPanel.reticulumStackSettings.title')}>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2 text-gray-300">
            <input
              type="checkbox"
              checked={stackSettings.enable_transport}
              disabled={!sidecarApiReady}
              onChange={(e) => {
                setStackSettings((s) => ({ ...s, enable_transport: e.target.checked }));
              }}
            />
            {t('networkPanel.reticulumStackSettings.enableTransport')}
          </label>
          <label className="flex items-center gap-2 text-gray-300">
            <input
              type="checkbox"
              checked={stackSettings.share_instance}
              disabled={!sidecarApiReady}
              onChange={(e) => {
                setStackSettings((s) => ({ ...s, share_instance: e.target.checked }));
              }}
            />
            {t('networkPanel.reticulumStackSettings.shareInstance')}
          </label>
          <label className="block text-xs text-gray-400">
            {t('networkPanel.reticulumStackSettings.logLevel')}
            <select
              value={stackSettings.loglevel}
              disabled={!sidecarApiReady}
              onChange={(e) => {
                setStackSettings((s) => ({ ...s, loglevel: Number(e.target.value) }));
              }}
              className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
            >
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!sidecarApiReady}
            onClick={() => {
              void saveStackSettings();
            }}
            className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
          >
            {t('networkPanel.reticulumStackSettings.save')}
          </button>
        </div>
      </ReticulumCollapsibleSection>

      <ReticulumCollapsibleSection title={t('connectionPanel.reticulumIdentity.title')}>
        <p className="text-muted text-xs">{t('connectionPanel.reticulumIdentity.hint')}</p>
        {identityError ? (
          <p className="mt-2 text-sm text-red-400" role="alert">
            {identityError}
          </p>
        ) : null}
        {identityReady ? (
          <IdentityConfiguredView
            identity={identity}
            exportPassphrase={exportPassphrase}
            exportJson={exportJson}
            exportDisabled={!sidecarApiReady}
            onExportPassphraseChange={setExportPassphrase}
            onExport={() => {
              void handleExportIdentity();
            }}
          />
        ) : (
          <IdentitySetupView
            displayName={displayName}
            importPhrase={importPhrase}
            mnemonic={mnemonic}
            confirmSaved={confirmSaved}
            disabled={identityActionsDisabled}
            onDisplayNameChange={setDisplayName}
            onImportPhraseChange={setImportPhrase}
            onConfirmSavedChange={setConfirmSaved}
            onGenerate={() => {
              void handleGenerate();
            }}
            onImport={() => {
              void handleImportIdentity();
            }}
          />
        )}
        <IdentityImportExtras
          disabled={identityActionsDisabled}
          importBackupJson={importBackupJson}
          importPrivateKey={importPrivateKey}
          onImportBackupJsonChange={setImportBackupJson}
          onImportPrivateKeyChange={setImportPrivateKey}
          onImportBackup={() => {
            void handleImportBackup();
          }}
          onImportPrivateKey={() => {
            void handleImportPrivateKey();
          }}
          onImportPrivateKeyFromFile={() => {
            void handleImportPrivateKeyFromFile();
          }}
          showReplaceHint={identityReady}
        />
        {identityReady ? (
          <IdentityVaultPanel disabled={identityActionsDisabled} secret={exportJson} />
        ) : null}
        {identityReady && sidecarApiReady ? (
          <ReticulumAnnounceControls disabled={!sidecarApiReady} />
        ) : null}
      </ReticulumCollapsibleSection>

      {identityReady && sidecarApiReady ? (
        <ReticulumCollapsibleSection title={t('reticulumRmapDiscovery.sectionTitle')}>
          <ReticulumRmapDiscoveryControls
            disabled={connecting}
            sidecarApiReady={sidecarApiReady}
            identityDisplayName={identity?.display_name ?? displayName}
            onOpenAppGpsSettings={onOpenAppGpsSettings}
          />
        </ReticulumCollapsibleSection>
      ) : null}

      {sidecarApiReady ? (
        <>
          <ReticulumCollapsibleSection title={t('networkPanel.reticulumConfigImport.title')}>
            <p className="text-muted text-xs">{t('networkPanel.reticulumConfigImport.hint')}</p>
            <textarea
              value={configPaste}
              onChange={(e) => {
                setConfigPaste(e.target.value);
              }}
              rows={4}
              className="mt-2 w-full rounded border border-gray-600 bg-slate-900 p-2 font-mono text-xs text-gray-200"
              aria-label={t('networkPanel.reticulumConfigImport.pasteLabel')}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleImportFromFile();
                }}
                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800"
              >
                {t('networkPanel.reticulumConfigImport.fromFile')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleImportFromSystem();
                }}
                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800"
              >
                {t('networkPanel.reticulumConfigImport.fromSystem')}
              </button>
              <button
                type="button"
                disabled={!configPaste.trim()}
                onClick={() => {
                  handleImportConfig('merge');
                }}
                className="rounded bg-amber-700 px-2 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-40"
              >
                {t('networkPanel.reticulumConfigImport.merge')}
              </button>
              <button
                type="button"
                disabled={!configPaste.trim()}
                onClick={() => {
                  handleImportConfig('replace');
                }}
                className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950/40 disabled:opacity-40"
              >
                {t('networkPanel.reticulumConfigImport.replace')}
              </button>
            </div>
            {importWarnings.length > 0 ? (
              <ul className="mt-2 list-disc pl-4 text-xs text-amber-300">
                {importWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </ReticulumCollapsibleSection>

          <ReticulumCollapsibleSection title={t('connectionPanel.reticulumPropagation.title')}>
            <ReticulumPropagationSection embedded />
          </ReticulumCollapsibleSection>
        </>
      ) : null}

      {(appInfo || statsSummary) && sidecarApiReady ? (
        <p className="text-muted text-xs">
          {appInfo?.sidecar_version ? `sidecar ${appInfo.sidecar_version}` : null}
          {appInfo?.rns_version ? ` · RNS ${appInfo.rns_version}` : null}
          {statsSummary ? ` · ${statsSummary}` : null}
        </p>
      ) : null}

      {showImportConfirm ? (
        <ConfirmModal
          title={t('networkPanel.reticulumConfigImport.confirmTitle')}
          message={t(
            pendingImportMode === 'merge'
              ? 'networkPanel.reticulumConfigImport.confirmMerge'
              : 'networkPanel.reticulumConfigImport.confirmReplace',
          )}
          confirmLabel={t('networkPanel.reticulumConfigImport.confirm')}
          onConfirm={() => {
            setShowImportConfirm(false);
            void runConfigImport(pendingImportMode, configPaste.trim());
          }}
          onCancel={() => {
            setShowImportConfirm(false);
          }}
        />
      ) : null}

      {showReplaceIdentityConfirm ? (
        <ConfirmModal
          title={t('connectionPanel.reticulumIdentity.replaceIdentityConfirmTitle')}
          message={t('connectionPanel.reticulumIdentity.replaceIdentityConfirmMessage')}
          confirmLabel={t('connectionPanel.reticulumIdentity.replaceIdentityConfirmAction')}
          onConfirm={runPendingReplaceAction}
          onCancel={() => {
            setShowReplaceIdentityConfirm(false);
            setPendingReplaceAction(null);
          }}
        />
      ) : null}
    </div>
  );
}

function IdentityImportExtras({
  disabled,
  importBackupJson,
  importPrivateKey,
  onImportBackupJsonChange,
  onImportPrivateKeyChange,
  onImportBackup,
  onImportPrivateKey,
  onImportPrivateKeyFromFile,
  showReplaceHint,
}: {
  disabled: boolean;
  importBackupJson: string;
  importPrivateKey: string;
  onImportBackupJsonChange: (v: string) => void;
  onImportPrivateKeyChange: (v: string) => void;
  onImportBackup: () => void;
  onImportPrivateKey: () => void;
  onImportPrivateKeyFromFile: () => void;
  showReplaceHint: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-gray-700 bg-slate-900/40 p-3">
      {showReplaceHint ? (
        <>
          <h4 className="text-sm font-medium text-gray-200">
            {t('connectionPanel.reticulumIdentity.replaceIdentitySection')}
          </h4>
          <p className="text-muted text-xs">
            {t('connectionPanel.reticulumIdentity.replaceIdentityHint')}
          </p>
        </>
      ) : null}
      <label className="block text-xs text-gray-400">
        {t('connectionPanel.reticulumIdentity.importBackupLabel')}
        <p className="text-muted mt-1 text-[11px]">
          {t('connectionPanel.reticulumIdentity.importBackupHint')}
        </p>
        <textarea
          value={importBackupJson}
          onChange={(e) => {
            onImportBackupJsonChange(e.target.value);
          }}
          disabled={disabled}
          rows={3}
          className="mt-1 w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 font-mono text-xs disabled:opacity-50"
          aria-label={t('connectionPanel.reticulumIdentity.importBackupLabel')}
        />
      </label>
      <button
        type="button"
        disabled={disabled || !importBackupJson.trim()}
        onClick={onImportBackup}
        className="rounded-lg border border-gray-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
      >
        {t('connectionPanel.reticulumIdentity.importBackup')}
      </button>
      <label className="block text-xs text-gray-400">
        {t('connectionPanel.reticulumIdentity.importPrivateKeyLabel')}
        <p className="text-muted mt-1 text-[11px]">
          {t('connectionPanel.reticulumIdentity.importPrivateKeyHint')}
        </p>
        <textarea
          value={importPrivateKey}
          onChange={(e) => {
            onImportPrivateKeyChange(e.target.value);
          }}
          disabled={disabled}
          rows={2}
          className="mt-1 w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 font-mono text-xs disabled:opacity-50"
          aria-label={t('connectionPanel.reticulumIdentity.importPrivateKeyLabel')}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || !importPrivateKey.trim()}
          onClick={onImportPrivateKey}
          className="rounded-lg border border-gray-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
        >
          {t('connectionPanel.reticulumIdentity.importPrivateKey')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onImportPrivateKeyFromFile}
          className="rounded-lg border border-gray-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
        >
          {t('connectionPanel.reticulumIdentity.importPrivateKeyFromFile')}
        </button>
      </div>
    </div>
  );
}

function IdentityConfiguredView({
  identity,
  exportPassphrase,
  exportJson,
  exportDisabled,
  onExportPassphraseChange,
  onExport,
}: {
  identity: ReticulumIdentityStatus | null;
  exportPassphrase: string;
  exportJson: string | null;
  exportDisabled: boolean;
  onExportPassphraseChange: (v: string) => void;
  onExport: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-1 text-sm text-gray-300">
      <div>
        <span className="text-muted">{t('connectionPanel.reticulumIdentity.hashLabel')}</span>{' '}
        <code className="text-amber-300">{identity?.lxmf_hash.slice(0, 24)}…</code>
      </div>
      {identity?.display_name ? (
        <div>
          <span className="text-muted">{t('connectionPanel.reticulumIdentity.nameLabel')}</span>{' '}
          {identity.display_name}
        </div>
      ) : null}
      <label className="mt-2 block text-xs text-gray-400">
        {t('connectionPanel.reticulumIdentity.exportPassphrase')}
        <input
          type="password"
          value={exportPassphrase}
          onChange={(e) => {
            onExportPassphraseChange(e.target.value);
          }}
          autoComplete="new-password"
          className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-200"
        />
      </label>
      <button
        type="button"
        disabled={exportDisabled}
        onClick={onExport}
        className="mt-2 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
      >
        {t('connectionPanel.reticulumIdentity.export')}
      </button>
      {exportJson ? (
        <textarea readOnly value={exportJson} rows={3} className="mt-2 w-full font-mono text-xs" />
      ) : null}
    </div>
  );
}

function IdentitySetupView({
  displayName,
  importPhrase,
  mnemonic,
  confirmSaved,
  disabled,
  onDisplayNameChange,
  onImportPhraseChange,
  onConfirmSavedChange,
  onGenerate,
  onImport,
}: {
  displayName: string;
  importPhrase: string;
  mnemonic: string | null;
  confirmSaved: boolean;
  disabled: boolean;
  onDisplayNameChange: (v: string) => void;
  onImportPhraseChange: (v: string) => void;
  onConfirmSavedChange: (v: boolean) => void;
  onGenerate: () => void;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 space-y-3">
      <label className="block text-xs text-gray-400">
        {t('connectionPanel.reticulumIdentity.displayName')}
        <input
          type="text"
          value={displayName}
          onChange={(e) => {
            onDisplayNameChange(e.target.value);
          }}
          disabled={disabled}
          className="mt-1 w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={onGenerate}
        className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm text-white hover:bg-amber-600 disabled:opacity-40"
      >
        {t('connectionPanel.reticulumIdentity.generate')}
      </button>
      {mnemonic ? (
        <div className="rounded border border-amber-600/40 bg-amber-950/30 p-3 text-sm">
          <p className="text-muted text-xs">{t('connectionPanel.reticulumIdentity.mnemonic')}</p>
          <p className="mt-1 font-mono text-amber-100">{mnemonic}</p>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={confirmSaved}
              onChange={(e) => {
                onConfirmSavedChange(e.target.checked);
              }}
            />
            {t('connectionPanel.reticulumIdentity.confirmSaved')}
          </label>
        </div>
      ) : null}
      <label className="block text-xs text-gray-400">
        {t('connectionPanel.reticulumIdentity.importLabel')}
        <textarea
          value={importPhrase}
          onChange={(e) => {
            onImportPhraseChange(e.target.value);
          }}
          disabled={disabled}
          rows={2}
          className="mt-1 w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={onImport}
        className="rounded-lg border border-gray-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
      >
        {t('connectionPanel.reticulumIdentity.import')}
      </button>
    </div>
  );
}

export default ReticulumNetworkPanel;
