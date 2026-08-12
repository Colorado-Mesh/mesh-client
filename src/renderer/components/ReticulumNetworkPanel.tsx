/* eslint-disable react-hooks/set-state-in-effect */
import { Copy } from 'lucide-react-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import { handleReticulumQrIngest } from '@/renderer/lib/reticulum/handleReticulumQrIngest';
import { translateReticulumAuditIssue } from '@/renderer/lib/reticulum/reticulumConfigAudit';
import {
  fetchPathMediumPreference,
  type PathMediumPreference,
  setPathMediumPreference,
} from '@/renderer/lib/reticulum/reticulumPathMedium';
import { reticulumSidecarEventRefreshActions } from '@/renderer/lib/reticulum/reticulumSidecarPeerRefreshEvents';
import {
  createReticulumIdentitySlot,
  deleteReticulumIdentitySlot,
  invalidateReticulumInterfacesCache,
  listReticulumIdentities,
  type ReticulumSidecarIdentityRow,
  switchReticulumIdentity,
} from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { parseReticulumStackSettingsPayload } from '@/renderer/lib/reticulum/reticulumStackSettings';
import { showReticulumQrIngestToast } from '@/renderer/lib/reticulum/showReticulumQrIngestToast';
import {
  type ReticulumIdentityStatus,
  useReticulumSidecarApi,
} from '@/renderer/lib/reticulum/useReticulumSidecarApi';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';
import { buildLxmaContactUri, buildLxmIdentityUri } from '@/shared/meshClientDeepLink';
import type {
  ReticulumConfigValidateResult,
  ReticulumSidecarEvent,
} from '@/shared/reticulum-types';

import { refreshReticulumPeersFromSidecar } from '../stores/reticulumPeerStore';
import { ConfirmModal } from './ConfirmModal';
import { IdentityVaultPanel } from './IdentityVaultPanel';
import QrCodeImage from './QrCodeImage';
import QrIngestControl from './QrIngestControl';
import { ReticulumAnnounceControls } from './ReticulumAnnounceControls';
import ReticulumPnHostingDangerZone from './ReticulumPnHostingDangerZone';
import ReticulumPropagationSection from './ReticulumPropagationSection';
import { ReticulumRmapDiscoveryControls } from './ReticulumRmapDiscoveryControls';
import { useToast } from './Toast';

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
  /** When incremented, opens the propagation collapsible section. */
  propagationSectionOpenKey?: number;
}

/** Network tab: identity, stack settings, propagation, config import. */
export function ReticulumNetworkPanel({
  connecting,
  onStartStack,
  onOpenAppGpsSettings,
  propagationSectionOpenKey = 0,
}: ReticulumNetworkPanelProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const sidecarEventRef = useRef<(evt: ReticulumSidecarEvent) => void>(() => {});

  const { sidecarApiReady, sidecarUiRunning, identity, statsSummary, appInfo, refreshIdentity } =
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
  const [identityNotice, setIdentityNotice] = useState<string | null>(null);
  const [confirmSaved, setConfirmSaved] = useState(false);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState('');
  const [importBackupJson, setImportBackupJson] = useState('');
  const [importBackupPin, setImportBackupPin] = useState('');
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
    share_instance: false,
    loglevel: 4,
  });
  const [pathMediumPreference, setPathMediumPreferenceState] =
    useState<PathMediumPreference>('lowest');
  const [pathMediumBusy, setPathMediumBusy] = useState(false);
  const [configValidateBusy, setConfigValidateBusy] = useState(false);
  const [configValidateResult, setConfigValidateResult] =
    useState<ReticulumConfigValidateResult | null>(null);

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
      const pref = await fetchPathMediumPreference();
      if (pref.ok) setPathMediumPreferenceState(pref.preference);
    } catch (e) {
      console.debug('[ReticulumNetworkPanel] stack settings ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  const savePathMediumPreference = async (preference: PathMediumPreference) => {
    setPathMediumBusy(true);
    try {
      const res = await setPathMediumPreference(preference);
      if (!res.ok) {
        addToast(t('networkPanel.reticulumStackSettings.pathMediumPreferenceSaveFailed'), 'error');
        return;
      }
      setPathMediumPreferenceState(preference);
      addToast(t('networkPanel.reticulumStackSettings.pathMediumPreferenceSaved'), 'success');
    } catch (e) {
      console.warn('[ReticulumNetworkPanel] path medium ' + errLikeToLogString(e));
      addToast(t('networkPanel.reticulumStackSettings.pathMediumPreferenceSaveFailed'), 'error');
    } finally {
      setPathMediumBusy(false);
    }
  };

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
      // Match runtime policy: do not path-table reload peers on stats_update.
      if (reticulumSidecarEventRefreshActions(evt.type).peers) {
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
    const confirm = exportPassphraseConfirm.trim();
    if (passphrase.length < 6) {
      setIdentityError(t('connectionPanel.reticulumIdentity.exportPassphraseRequired'));
      return;
    }
    if (passphrase !== confirm) {
      setIdentityError(t('connectionPanel.reticulumIdentity.exportPassphraseMismatch'));
      return;
    }
    setIdentityError(null);
    setIdentityNotice(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/export', {
        passphrase,
      })) as { ok?: boolean; backup?: unknown; file_name?: string; error?: string };
      if (!res.ok || res.backup == null) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumIdentity.failed'));
        return;
      }
      const json =
        typeof res.backup === 'string' ? res.backup : JSON.stringify(res.backup, null, 2);
      setExportJson(json);
      const fileName =
        res.file_name ||
        (typeof res.backup === 'object' &&
        res.backup &&
        'file_name' in res.backup &&
        typeof (res.backup as { file_name?: unknown }).file_name === 'string'
          ? (res.backup as { file_name: string }).file_name
          : 'ratspeak-identity.rsi');
      const utf8Bytes = new TextEncoder().encode(json);
      let binary = '';
      for (const byte of utf8Bytes) {
        binary += String.fromCharCode(byte);
      }
      const saved = await window.electronAPI.reticulum.saveIdentityExportDialog({
        defaultPath: fileName,
        contentBase64: btoa(binary),
      });
      if (saved.error) {
        setIdentityError(t('connectionPanel.reticulumIdentity.exportSaveFailed'));
        return;
      }
      if (saved.path) {
        setIdentityNotice(t('connectionPanel.reticulumIdentity.exportSaved'));
      }
    } catch (e) {
      // catch-no-log-ok: export failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleExportRawIdentity = async () => {
    setIdentityError(null);
    setIdentityNotice(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost(
        '/api/v1/identity/export-raw',
        {},
      )) as {
        ok?: boolean;
        raw?: { data_base64?: string; file_name?: string };
        error?: string;
      };
      if (!res.ok || !res.raw?.data_base64) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumIdentity.failed'));
        return;
      }
      const saved = await window.electronAPI.reticulum.saveIdentityExportDialog({
        defaultPath: res.raw.file_name ?? 'reticulum-identity.identity',
        contentBase64: res.raw.data_base64,
      });
      if (saved.error) {
        setIdentityError(t('connectionPanel.reticulumIdentity.exportSaveFailed'));
        return;
      }
      if (saved.path) {
        setIdentityNotice(t('connectionPanel.reticulumIdentity.exportSaved'));
      }
    } catch (e) {
      // catch-no-log-ok: export failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleSaveDisplayName = async (name: string): Promise<boolean> => {
    if (!sidecarApiReady) return false;
    setIdentityError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/display-name', {
        display_name: name.trim(),
      })) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumIdentity.saveDisplayNameFailed'));
        return false;
      }
      await refreshIdentity();
      return true;
    } catch (e) {
      // catch-no-log-ok: save failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
      return false;
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
    const pin = importBackupPin.trim();
    if (pin.length < 6 && raw.includes('ratspeak.identity.v2')) {
      setIdentityError(t('connectionPanel.reticulumIdentity.importBackupPinRequired'));
      return;
    }
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
        passphrase: pin,
        display_name: displayName.trim() || null,
        replace,
      })) as { ok?: boolean; error?: string };
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
      setImportBackupPin('');
      await refreshIdentity();
    } catch (e) {
      // catch-no-log-ok: import failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleImportBackupFromFile = async () => {
    try {
      const result = await window.electronAPI.reticulum.showIdentityBackupImportDialog();
      if (!result.contentText) {
        if (result.error === 'read_failed') {
          setIdentityError(t('connectionPanel.reticulumIdentity.failed'));
        }
        return;
      }
      setImportBackupJson(result.contentText);
    } catch (e) {
      // catch-no-log-ok: dialog failure shown via setIdentityError
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

  const handleValidateConfig = async () => {
    setConfigValidateBusy(true);
    setConfigValidateResult(null);
    try {
      const result = await window.electronAPI.reticulum.validateConfig();
      setConfigValidateResult(result);
    } catch (e) {
      // catch-no-log-ok: validate failure shown in panel
      setConfigValidateResult({
        ok: false,
        issues: [],
        error: errLikeToLogString(e),
      });
    } finally {
      setConfigValidateBusy(false);
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

  const identityReady = Boolean(identity?.lxmf_hash?.trim());
  const identityActionsDisabled = !sidecarApiReady || connecting;

  return (
    <div className="space-y-4">
      {!sidecarUiRunning && !connecting ? (
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
          <label className="block text-xs text-gray-400">
            {t('networkPanel.reticulumStackSettings.pathMediumPreference')}
            <select
              value={pathMediumPreference}
              disabled={!sidecarApiReady || pathMediumBusy}
              aria-label={t('networkPanel.reticulumStackSettings.pathMediumPreferenceAria')}
              onChange={(e) => {
                void savePathMediumPreference(e.target.value as PathMediumPreference);
              }}
              className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm text-gray-100"
            >
              <option value="lowest">
                {t('networkPanel.reticulumStackSettings.pathMediumLowest')}
              </option>
              <option value="network">
                {t('networkPanel.reticulumStackSettings.pathMediumNetwork')}
              </option>
              <option value="rf">{t('networkPanel.reticulumStackSettings.pathMediumRf')}</option>
            </select>
            <span className="mt-1 block text-[11px] text-gray-500">
              {t('networkPanel.reticulumStackSettings.pathMediumPreferenceHint')}
            </span>
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

      <ReticulumCollapsibleSection title={t('networkPanel.reticulumScanImport.title')}>
        <p className="text-muted text-xs">{t('networkPanel.reticulumScanImport.hint')}</p>
        <div className="mt-2">
          <p className="text-muted mb-1 text-[11px]">{t('qrIngest.pasteImageHint')}</p>
          <QrIngestControl
            disabled={!sidecarApiReady}
            onDecoded={(text) => {
              void (async () => {
                const outcome = await handleReticulumQrIngest(text);
                showReticulumQrIngestToast(outcome, { t, addToast });
              })().catch((err: unknown) => {
                console.error(
                  '[ReticulumNetworkPanel] QR ingest failed: ' + errLikeToLogString(err),
                );
                addToast(t('qrIngest.unknownLink'), 'error');
              });
            }}
          />
        </div>
      </ReticulumCollapsibleSection>

      <ReticulumCollapsibleSection title={t('connectionPanel.reticulumIdentity.title')}>
        <p className="text-muted text-xs">{t('connectionPanel.reticulumIdentity.hint')}</p>
        {identityError ? (
          <p className="mt-2 text-sm text-red-400" role="alert">
            {identityError}
          </p>
        ) : null}
        {identityNotice ? (
          <p className="text-readable-green mt-2 text-sm" role="status">
            {identityNotice}
          </p>
        ) : null}
        {identityReady ? (
          <>
            <IdentitySlotsSection
              disabled={!sidecarApiReady}
              onError={setIdentityError}
              onChanged={async () => {
                await refreshIdentity();
                void refreshReticulumPeersFromSidecar({ forceRefresh: true }).catch(
                  (err: unknown) => {
                    console.warn(
                      '[ReticulumNetworkPanel] peer refresh after identity change failed: ' +
                        errLikeToLogString(err),
                    );
                  },
                );
              }}
            />
            <IdentityConfiguredView
              identity={identity}
              exportPassphrase={exportPassphrase}
              exportPassphraseConfirm={exportPassphraseConfirm}
              exportJson={exportJson}
              exportDisabled={!sidecarApiReady}
              saveDisabled={!sidecarApiReady}
              onExportPassphraseChange={setExportPassphrase}
              onExportPassphraseConfirmChange={setExportPassphraseConfirm}
              onExport={() => {
                void handleExportIdentity();
              }}
              onExportRaw={() => {
                void handleExportRawIdentity();
              }}
              onSaveDisplayName={(name) => handleSaveDisplayName(name)}
            />
          </>
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
          importBackupPin={importBackupPin}
          importPrivateKey={importPrivateKey}
          onImportBackupJsonChange={setImportBackupJson}
          onImportBackupPinChange={setImportBackupPin}
          onImportPrivateKeyChange={setImportPrivateKey}
          onImportBackup={() => {
            void handleImportBackup();
          }}
          onImportBackupFromFile={() => {
            void handleImportBackupFromFile();
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
              <button
                type="button"
                disabled={configValidateBusy}
                onClick={() => {
                  void handleValidateConfig();
                }}
                className="rounded border border-cyan-700 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-950/40 disabled:opacity-40"
                aria-label={t('networkPanel.reticulumConfigValidate.aria')}
              >
                {configValidateBusy
                  ? t('networkPanel.reticulumConfigValidate.running')
                  : t('networkPanel.reticulumConfigValidate.button')}
              </button>
            </div>
            {importWarnings.length > 0 ? (
              <ul className="mt-2 list-disc pl-4 text-xs text-amber-300">
                {importWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
            {configValidateResult ? (
              <div
                className="mt-2 rounded border border-gray-700 bg-slate-900/50 p-2 text-xs"
                role="status"
              >
                {configValidateResult.error || configValidateResult.parseError ? (
                  <p className="text-red-300">
                    {t('networkPanel.reticulumConfigValidate.failed', {
                      message: configValidateResult.parseError ?? configValidateResult.error ?? '',
                    })}
                  </p>
                ) : configValidateResult.ok && configValidateResult.issues.length === 0 ? (
                  <p className="text-brand-green">{t('networkPanel.reticulumConfigValidate.ok')}</p>
                ) : (
                  <>
                    <p className="mb-1 font-medium text-amber-200">
                      {t('networkPanel.reticulumConfigValidate.issuesHeading', {
                        count: configValidateResult.issues.length,
                      })}
                    </p>
                    <ul className="list-disc space-y-1 pl-4 text-amber-100/90">
                      {configValidateResult.issues.map((issue) => {
                        const severity =
                          issue.severity === 'error' ||
                          issue.severity === 'warning' ||
                          issue.severity === 'info'
                            ? issue.severity
                            : 'warning';
                        const translated = translateReticulumAuditIssue(t, {
                          kind: issue.kind,
                          severity,
                          interface_name: issue.interface_name,
                          message: issue.message,
                        });
                        return (
                          <li key={`${issue.kind}-${issue.interface_id ?? ''}-${issue.message}`}>
                            <span className="text-amber-300">[{translated.severityLabel}]</span>{' '}
                            {translated.message}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            ) : null}
          </ReticulumCollapsibleSection>

          <ReticulumCollapsibleSection
            key={`propagation-${propagationSectionOpenKey}`}
            title={t('connectionPanel.reticulumPropagation.title')}
            defaultOpen={propagationSectionOpenKey > 0}
          >
            <ReticulumPropagationSection embedded />
          </ReticulumCollapsibleSection>

          <ReticulumPnHostingDangerZone disabled={!sidecarApiReady} />
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
  importBackupPin,
  importPrivateKey,
  onImportBackupJsonChange,
  onImportBackupPinChange,
  onImportPrivateKeyChange,
  onImportBackup,
  onImportBackupFromFile,
  onImportPrivateKey,
  onImportPrivateKeyFromFile,
  showReplaceHint,
}: {
  disabled: boolean;
  importBackupJson: string;
  importBackupPin: string;
  importPrivateKey: string;
  onImportBackupJsonChange: (v: string) => void;
  onImportBackupPinChange: (v: string) => void;
  onImportPrivateKeyChange: (v: string) => void;
  onImportBackup: () => void;
  onImportBackupFromFile: () => void;
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
      <label className="block text-xs text-gray-400">
        {t('connectionPanel.reticulumIdentity.importBackupPin')}
        <input
          type="password"
          value={importBackupPin}
          onChange={(e) => {
            onImportBackupPinChange(e.target.value);
          }}
          disabled={disabled}
          autoComplete="off"
          className="mt-1 w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm disabled:opacity-50"
          aria-label={t('connectionPanel.reticulumIdentity.importBackupPin')}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled || !importBackupJson.trim()}
          onClick={onImportBackup}
          className="rounded-lg border border-gray-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
        >
          {t('connectionPanel.reticulumIdentity.importBackup')}
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onImportBackupFromFile}
          className="rounded-lg border border-gray-600 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
        >
          {t('connectionPanel.reticulumIdentity.importBackupFromFile')}
        </button>
      </div>
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

function IdentitySlotsSection({
  disabled,
  onError,
  onChanged,
}: {
  disabled: boolean;
  onError: (msg: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<ReticulumSidecarIdentityRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSlots(await listReticulumIdentities());
    } catch (err) {
      console.warn('[IdentitySlotsSection] list failed: ' + errLikeToLogString(err));
      onError(
        t('connectionPanel.reticulumIdentity.slotActionFailed', {
          error: errLikeToLogString(err),
        }),
      );
    }
  }, [onError, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runCreate = useCallback(async () => {
    setBusy(true);
    onError(null);
    try {
      await createReticulumIdentitySlot();
      setNotice(t('connectionPanel.reticulumIdentity.slotCreated'));
      await onChanged();
      await reload();
    } catch (err) {
      console.warn('[IdentitySlotsSection] create failed: ' + errLikeToLogString(err));
      onError(
        t('connectionPanel.reticulumIdentity.slotActionFailed', {
          error: errLikeToLogString(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [onChanged, onError, reload, t]);

  const runSwitch = useCallback(async () => {
    if (!switchTarget) return;
    setBusy(true);
    onError(null);
    try {
      await switchReticulumIdentity(switchTarget);
      setNotice(t('connectionPanel.reticulumIdentity.slotSwitched'));
      setSwitchTarget(null);
      await onChanged();
      await reload();
    } catch (err) {
      console.warn('[IdentitySlotsSection] switch failed: ' + errLikeToLogString(err));
      onError(
        t('connectionPanel.reticulumIdentity.slotActionFailed', {
          error: errLikeToLogString(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [onChanged, onError, reload, switchTarget, t]);

  const runDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setBusy(true);
    onError(null);
    try {
      await deleteReticulumIdentitySlot(deleteTarget);
      setNotice(t('connectionPanel.reticulumIdentity.slotDeleted'));
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      console.warn('[IdentitySlotsSection] delete failed: ' + errLikeToLogString(err));
      onError(
        t('connectionPanel.reticulumIdentity.slotActionFailed', {
          error: errLikeToLogString(err),
        }),
      );
    } finally {
      setBusy(false);
    }
  }, [deleteTarget, onError, reload, t]);

  return (
    <div className="mb-3 space-y-2 rounded border border-gray-700/70 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-gray-300">
            {t('connectionPanel.reticulumIdentity.slotsTitle')}
          </p>
          <p className="text-muted text-[11px]">
            {t('connectionPanel.reticulumIdentity.slotsHint')}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled || busy}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
          aria-label={t('connectionPanel.reticulumIdentity.slotCreateAria')}
          onClick={() => {
            void runCreate();
          }}
        >
          {t('connectionPanel.reticulumIdentity.slotCreate')}
        </button>
      </div>
      <ul className="space-y-1">
        {slots.map((slot) => {
          const label =
            slot.display_name?.trim() ||
            slot.lxmf_hash?.slice(0, 8) ||
            t('connectionPanel.reticulumIdentity.slotUnnamed');
          return (
            <li
              key={slot.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-900/50 px-2 py-1.5 text-xs"
            >
              <div className="min-w-0">
                <span className="font-medium text-gray-200">{label}</span>
                {slot.active ? (
                  <span className="text-readable-green ml-2 text-[10px]">
                    {t('connectionPanel.reticulumIdentity.slotActive')}
                  </span>
                ) : null}
                <p className="text-muted truncate font-mono text-[10px]">{slot.id}</p>
              </div>
              <div className="flex gap-1">
                {!slot.active && slot.configured ? (
                  <button
                    type="button"
                    disabled={disabled || busy}
                    className="rounded border border-gray-600 px-2 py-0.5 text-[11px] text-gray-300 hover:bg-slate-800 disabled:opacity-40"
                    aria-label={t('connectionPanel.reticulumIdentity.slotSwitchAria', {
                      id: slot.id,
                    })}
                    onClick={() => {
                      setSwitchTarget(slot.id);
                    }}
                  >
                    {t('connectionPanel.reticulumIdentity.slotSwitch')}
                  </button>
                ) : null}
                {!slot.active ? (
                  <button
                    type="button"
                    disabled={disabled || busy}
                    className="rounded border border-red-900/60 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-950/40 disabled:opacity-40"
                    aria-label={t('connectionPanel.reticulumIdentity.slotDeleteAria', {
                      id: slot.id,
                    })}
                    onClick={() => {
                      setDeleteTarget(slot.id);
                    }}
                  >
                    {t('connectionPanel.reticulumIdentity.slotDelete')}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {notice ? (
        <p className="text-readable-green text-[11px]" role="status">
          {notice}
        </p>
      ) : null}
      {switchTarget ? (
        <ConfirmModal
          title={t('connectionPanel.reticulumIdentity.slotSwitchConfirmTitle')}
          message={t('connectionPanel.reticulumIdentity.slotSwitchConfirmMessage')}
          confirmLabel={t('connectionPanel.reticulumIdentity.slotSwitchConfirmAction')}
          onConfirm={() => {
            void runSwitch();
          }}
          onCancel={() => {
            setSwitchTarget(null);
          }}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmModal
          title={t('connectionPanel.reticulumIdentity.slotDeleteConfirmTitle')}
          message={t('connectionPanel.reticulumIdentity.slotDeleteConfirmMessage')}
          confirmLabel={t('connectionPanel.reticulumIdentity.slotDeleteConfirmAction')}
          danger
          onConfirm={() => {
            void runDelete();
          }}
          onCancel={() => {
            setDeleteTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function IdentityConfiguredView({
  identity,
  exportPassphrase,
  exportPassphraseConfirm,
  exportJson,
  exportDisabled,
  saveDisabled,
  onExportPassphraseChange,
  onExportPassphraseConfirmChange,
  onExport,
  onExportRaw,
  onSaveDisplayName,
}: {
  identity: ReticulumIdentityStatus | null;
  exportPassphrase: string;
  exportPassphraseConfirm: string;
  exportJson: string | null;
  exportDisabled: boolean;
  saveDisabled: boolean;
  onExportPassphraseChange: (v: string) => void;
  onExportPassphraseConfirmChange: (v: string) => void;
  onExport: () => void;
  onExportRaw: () => void;
  onSaveDisplayName: (name: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [nameDraft, setNameDraft] = useState(identity?.display_name?.trim() ?? '');
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    setNameDraft(identity?.display_name?.trim() ?? '');
  }, [identity?.display_name]);

  const lxmfHash = identity?.lxmf_hash?.trim() ?? '';
  const [showIdentityQr, setShowIdentityQr] = useState(false);
  const identityQrUri = useMemo(() => {
    const pub = identity?.public_key?.trim();
    if (lxmfHash && pub && /^[0-9a-f]{128}$/i.test(pub)) {
      try {
        return buildLxmaContactUri(lxmfHash, pub);
      } catch {
        // catch-no-log-ok fall through to mesh-client identity URI
      }
    }
    const idHash = identity?.identity_hash?.trim();
    if (!idHash) return null;
    try {
      return buildLxmIdentityUri({
        identityHash: idHash,
        lxmfHash: lxmfHash || null,
        name: identity?.display_name ?? null,
      });
    } catch {
      // catch-no-log-ok Invalid or incomplete identity hashes simply hide the optional QR.
      return null;
    }
  }, [identity, lxmfHash]);

  const copyLxmfHash = useCallback(async () => {
    if (!lxmfHash) return;
    try {
      await writeClipboardText(lxmfHash);
    } catch (e) {
      console.warn('[ReticulumNetworkPanel] copy LXMF hash ' + errLikeToLogString(e));
    }
  }, [lxmfHash]);

  const handleSave = async () => {
    setSaving(true);
    setSaveNotice(null);
    try {
      const ok = await onSaveDisplayName(nameDraft);
      if (ok) {
        setSaveNotice(t('connectionPanel.reticulumIdentity.displayNameSaved'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-1 text-sm text-gray-300">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted">{t('connectionPanel.reticulumIdentity.hashLabel')}</span>
        <code className="text-amber-300" title={lxmfHash || undefined}>
          {lxmfHash ? `${lxmfHash.slice(0, 24)}…` : '—'}
        </code>
        {lxmfHash ? (
          <button
            type="button"
            className="shrink-0 text-amber-400 hover:text-amber-300"
            aria-label={t('connectionPanel.reticulumIdentity.copyLxmfHash')}
            onClick={() => {
              void copyLxmfHash();
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {identityQrUri ? (
          <button
            type="button"
            className="rounded border border-gray-600 px-2 py-0.5 text-xs text-gray-300 hover:bg-slate-800"
            aria-label={t('qrIngest.showIdentityQrAria')}
            onClick={() => {
              setShowIdentityQr((v) => !v);
            }}
          >
            {t('qrIngest.showIdentityQr')}
          </button>
        ) : null}
      </div>
      {showIdentityQr && identityQrUri ? (
        <div className="mt-2">
          <QrCodeImage
            value={identityQrUri}
            size={160}
            ariaLabel={t('qrIngest.showIdentityQrAria')}
          />
        </div>
      ) : null}
      <label className="mt-2 block text-xs text-gray-400">
        {t('connectionPanel.reticulumIdentity.displayName')}
        <input
          type="text"
          value={nameDraft}
          disabled={saveDisabled || saving}
          onChange={(e) => {
            setNameDraft(e.target.value);
            setSaveNotice(null);
          }}
          aria-label={t('connectionPanel.reticulumIdentity.displayName')}
          className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
        />
      </label>
      <button
        type="button"
        disabled={saveDisabled || saving}
        onClick={() => {
          void handleSave();
        }}
        className="mt-2 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
      >
        {t('connectionPanel.reticulumIdentity.saveDisplayName')}
      </button>
      {saveNotice ? (
        <p className="text-readable-green mt-1 text-xs" role="status">
          {saveNotice}
        </p>
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
          aria-label={t('connectionPanel.reticulumIdentity.exportPassphrase')}
        />
      </label>
      <label className="mt-2 block text-xs text-gray-400">
        {t('connectionPanel.reticulumIdentity.exportPassphraseConfirm')}
        <input
          type="password"
          value={exportPassphraseConfirm}
          onChange={(e) => {
            onExportPassphraseConfirmChange(e.target.value);
          }}
          autoComplete="new-password"
          className="mt-1 block w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-200"
          aria-label={t('connectionPanel.reticulumIdentity.exportPassphraseConfirm')}
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={exportDisabled}
          onClick={onExport}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('connectionPanel.reticulumIdentity.export')}
        </button>
        <button
          type="button"
          disabled={exportDisabled}
          onClick={onExportRaw}
          className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800 disabled:opacity-40"
        >
          {t('connectionPanel.reticulumIdentity.exportRaw')}
        </button>
      </div>
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
