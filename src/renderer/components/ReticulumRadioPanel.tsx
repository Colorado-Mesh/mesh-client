/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import {
  classifyReticulumLocalInterface,
  reticulumLocalInterfaceTextClass,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { invalidateReticulumInterfacesCache } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import {
  type ReticulumIdentityStatus,
  useReticulumSidecarApi,
} from '@/renderer/lib/reticulum/useReticulumSidecarApi';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

import { refreshReticulumPeersFromSidecar } from '../stores/reticulumPeerStore';
import { ConfirmModal } from './ConfirmModal';
import { IdentityVaultPanel } from './IdentityVaultPanel';
import { ReticulumAnnounceControls } from './ReticulumAnnounceControls';
import { ReticulumIdentitySwitcher } from './ReticulumIdentitySwitcher';
import ReticulumPropagationSection from './ReticulumPropagationSection';

interface ReticulumInterfaceRow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: string;
  host?: string | null;
  port?: number | null;
  serial_port?: string | null;
  frequency?: number | null;
  bandwidth?: number | null;
  txpower?: number | null;
  spreading_factor?: number | null;
  coding_rate?: number | null;
  callsign?: string | null;
  preset?: string | null;
}

type ReticulumIfaceUiType =
  'tcp' | 'auto' | 'rnode' | 'udp' | 'kiss' | 'pipe' | 'i2p' | 'rnode_multi';

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

export interface ReticulumRadioPanelProps {
  connecting: boolean;
  onStartStack: () => Promise<void>;
}

/** Radio tab: identity, interfaces, propagation, config import. */
export function ReticulumRadioPanel({ connecting, onStartStack }: ReticulumRadioPanelProps) {
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
  const [interfaces, setInterfaces] = useState<ReticulumInterfaceRow[]>([]);
  const [ifaceType, setIfaceType] = useState<ReticulumIfaceUiType>('tcp');
  const [ifaceHost, setIfaceHost] = useState('');
  const [ifacePort, setIfacePort] = useState('4242');
  const [serialPort, setSerialPort] = useState('');
  const [pipeCommand, setPipeCommand] = useState('');
  const [presets, setPresets] = useState<{ id: string; label: string }[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [serialPorts, setSerialPorts] = useState<{ path: string; label?: string }[]>([]);
  const [bleAvailable, setBleAvailable] = useState(false);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [configPaste, setConfigPaste] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [pendingDeleteInterface, setPendingDeleteInterface] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingInterface, setEditingInterface] = useState<ReticulumInterfaceRow | null>(null);
  const [restartStackHint, setRestartStackHint] = useState(false);
  const [pendingImportMode, setPendingImportMode] = useState<'merge' | 'replace'>('merge');
  const [stackSettings, setStackSettings] = useState({
    enable_transport: false,
    share_instance: true,
    loglevel: 4,
  });

  const refreshInterfaces = useCallback(async () => {
    if (!sidecarApiReady) return;
    try {
      invalidateReticulumInterfacesCache();
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
        interfaces?: ReticulumInterfaceRow[];
      };
      setInterfaces(body.interfaces ?? []);
    } catch (e) {
      console.debug('[ReticulumRadioPanel] interfaces ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  const refreshSerialPorts = useCallback(async () => {
    if (!sidecarApiReady) {
      setSerialPorts([]);
      return;
    }
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/serial/ports')) as {
        ports?: { path: string; label?: string }[];
      };
      setSerialPorts(body.ports ?? []);
    } catch (e) {
      console.debug('[ReticulumRadioPanel] serial ports ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

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
      console.debug('[ReticulumRadioPanel] stack settings ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  const refreshPeers = useCallback(async () => {
    if (!sidecarApiReady) return;
    try {
      await refreshReticulumPeersFromSidecar();
    } catch (e) {
      console.debug('[ReticulumRadioPanel] peers ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  useEffect(() => {
    sidecarEventRef.current = (evt: ReticulumSidecarEvent) => {
      if (evt.type === 'interface.state' || evt.type === 'stats_update') {
        void refreshInterfaces();
        void refreshSerialPorts();
      }
      if (
        evt.type === 'peers_updated' ||
        evt.type === 'stats_update' ||
        evt.type === 'announce.received'
      ) {
        void refreshPeers();
      }
    };
  }, [refreshInterfaces, refreshPeers, refreshSerialPorts]);

  useEffect(() => {
    if (!sidecarApiReady) {
      setInterfaces([]);
      return;
    }
    void refreshInterfaces();
    void refreshStackSettings();
    void refreshPeers();
    void refreshSerialPorts();
  }, [sidecarApiReady, refreshInterfaces, refreshStackSettings, refreshPeers, refreshSerialPorts]);

  useEffect(() => {
    if (!sidecarApiReady) return;
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/rnode/presets')
      .then((body) => {
        const presetsBody = body as { presets?: { id: string; label: string }[] };
        setPresets(presetsBody.presets ?? []);
      })
      .catch(() => {});
    void refreshSerialPorts();
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/ble/availability')
      .then((body) => {
        const ble = body as { available?: boolean };
        setBleAvailable(Boolean(ble.available));
      })
      .catch(() => {});
  }, [sidecarApiReady, refreshSerialPorts]);

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

  const handleGenerate = async () => {
    if (!sidecarApiReady) return;
    setIdentityError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/generate', {
        display_name: displayName.trim() || null,
      })) as {
        ok?: boolean;
        mnemonic?: string;
        error?: string;
      };
      if (!res.ok) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumIdentity.failed'));
        return;
      }
      setMnemonic(res.mnemonic ?? null);
      setConfirmSaved(false);
      await refreshIdentity();
    } catch (e) {
      // catch-no-log-ok: export failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleImportIdentity = async () => {
    if (!sidecarApiReady) return;
    setIdentityError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/import', {
        mnemonic: importPhrase.trim(),
        display_name: displayName.trim() || null,
      })) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumIdentity.failed'));
        return;
      }
      setImportPhrase('');
      setMnemonic(null);
      await refreshIdentity();
    } catch (e) {
      // catch-no-log-ok: export failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleAddInterface = async () => {
    try {
      const body: Record<string, unknown> = { type: ifaceType };
      if (ifaceType === 'tcp' || ifaceType === 'udp' || ifaceType === 'i2p') {
        body.host = ifaceHost.trim();
        if (ifaceType !== 'i2p') {
          body.port = Number.parseInt(ifacePort, 10) || 4242;
        }
      }
      if (ifaceType === 'rnode' || ifaceType === 'rnode_multi' || ifaceType === 'kiss') {
        body.serial_port = serialPort.trim();
      }
      if (ifaceType === 'rnode' || ifaceType === 'rnode_multi') {
        body.preset = selectedPreset || null;
      }
      if (ifaceType === 'pipe') {
        body.command = pipeCommand.trim();
      }
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/interfaces', body)) as {
        ok?: boolean;
        error?: string;
      };
      if (res?.ok === false) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumInterfaces.addFailed'));
        return;
      }
      if (ifaceType === 'rnode' || ifaceType === 'rnode_multi' || ifaceType === 'kiss') {
        setRestartStackHint(true);
      }
      await refreshInterfaces();
    } catch (e) {
      // catch-no-log-ok: interface add failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const toggleInterface = async (id: string, enabled: boolean) => {
    try {
      const path = enabled ? `/api/v1/interfaces/${id}/enable` : `/api/v1/interfaces/${id}/disable`;
      const res = (await window.electronAPI.reticulum.proxyPost(path, {})) as {
        ok?: boolean;
        error?: string;
      };
      if (res?.ok === false) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumInterfaces.toggleFailed'));
        return;
      }
      await refreshInterfaces();
    } catch (e) {
      // catch-no-log-ok: interface toggle failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const deleteInterface = async (id: string) => {
    try {
      const res = (await window.electronAPI.reticulum.proxyDelete(`/api/v1/interfaces/${id}`)) as {
        ok?: boolean;
        error?: string;
      };
      if (res?.ok === false) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumInterfaces.deleteFailed'));
        return;
      }
      setPendingDeleteInterface(null);
      if (editingInterface?.id === id) {
        setEditingInterface(null);
      }
      await refreshInterfaces();
    } catch (e) {
      // catch-no-log-ok: delete failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const saveEditInterface = async (id: string, patch: Record<string, unknown>) => {
    try {
      const res = (await window.electronAPI.reticulum.proxyPut(
        `/api/v1/interfaces/${id}`,
        patch,
      )) as { ok?: boolean; error?: string };
      if (res?.ok === false) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumInterfaces.editFailed'));
        return;
      }
      if ('serial_port' in patch) {
        setRestartStackHint(true);
      }
      setEditingInterface(null);
      await refreshInterfaces();
    } catch (e) {
      // catch-no-log-ok: edit failure shown via setIdentityError
      setIdentityError(errLikeToLogString(e));
    }
  };

  const runConfigImport = async (mode: 'merge' | 'replace', content: string) => {
    const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/config/import', {
      content,
      mode,
    })) as { ok?: boolean; warnings?: string[]; error?: string };
    if (!res.ok) {
      setIdentityError(res.error ?? t('radioPanel.reticulumConfigImportFailed'));
      return;
    }
    setImportWarnings(res.warnings ?? []);
    setConfigPaste('');
    await refreshInterfaces();
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
        setIdentityError(t('radioPanel.reticulumConfigNotFound'));
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
      const current = (await window.electronAPI.reticulum.proxyGet(
        '/api/v1/stack/settings',
      )) as Record<string, unknown>;
      const announceInterval =
        typeof current.announce_interval_sec === 'number'
          ? current.announce_interval_sec
          : Number(current.announce_interval_sec) || 0;
      const res = (await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', {
        ...stackSettings,
        announce_interval_sec: announceInterval,
      })) as { ok?: boolean; error?: string };
      if (res?.ok === false) {
        setIdentityError(res.error ?? t('radioPanel.reticulumStackSettings.saveFailed'));
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

      <ReticulumCollapsibleSection title={t('radioPanel.reticulumStackSettings.title')}>
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
            {t('radioPanel.reticulumStackSettings.enableTransport')}
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
            {t('radioPanel.reticulumStackSettings.shareInstance')}
          </label>
          <label className="block text-xs text-gray-400">
            {t('radioPanel.reticulumStackSettings.logLevel')}
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
            {t('radioPanel.reticulumStackSettings.save')}
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
        {identityReady && sidecarApiReady ? (
          <ReticulumIdentitySwitcher
            disabled={identityActionsDisabled}
            onSwitched={() => {
              void refreshIdentity();
            }}
          />
        ) : null}
        {identityReady ? (
          <IdentityVaultPanel disabled={identityActionsDisabled} secret={exportJson} />
        ) : null}
        {identityReady && sidecarApiReady ? (
          <ReticulumAnnounceControls disabled={!sidecarApiReady} />
        ) : null}
      </ReticulumCollapsibleSection>

      {sidecarApiReady ? (
        <>
          <ReticulumCollapsibleSection title={t('radioPanel.reticulumConfigImport.title')}>
            <p className="text-muted text-xs">{t('radioPanel.reticulumConfigImport.hint')}</p>
            <textarea
              value={configPaste}
              onChange={(e) => {
                setConfigPaste(e.target.value);
              }}
              rows={4}
              className="mt-2 w-full rounded border border-gray-600 bg-slate-900 p-2 font-mono text-xs text-gray-200"
              aria-label={t('radioPanel.reticulumConfigImport.pasteLabel')}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void handleImportFromFile();
                }}
                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800"
              >
                {t('radioPanel.reticulumConfigImport.fromFile')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleImportFromSystem();
                }}
                className="rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800"
              >
                {t('radioPanel.reticulumConfigImport.fromSystem')}
              </button>
              <button
                type="button"
                disabled={!configPaste.trim()}
                onClick={() => {
                  handleImportConfig('merge');
                }}
                className="rounded bg-amber-700 px-2 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-40"
              >
                {t('radioPanel.reticulumConfigImport.merge')}
              </button>
              <button
                type="button"
                disabled={!configPaste.trim()}
                onClick={() => {
                  handleImportConfig('replace');
                }}
                className="rounded border border-amber-600 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950/40 disabled:opacity-40"
              >
                {t('radioPanel.reticulumConfigImport.replace')}
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

          <ReticulumCollapsibleSection title={t('connectionPanel.reticulumInterfaces.title')}>
            {restartStackHint ? (
              <p className="mb-3 text-xs text-amber-300" role="status">
                {t('connectionPanel.reticulumInterfaces.restartStackHint')}
              </p>
            ) : null}
            <InterfacesSection
              interfaces={interfaces}
              osSerialPortPaths={serialPorts.map((p) => p.path)}
              ifaceType={ifaceType}
              ifaceHost={ifaceHost}
              ifacePort={ifacePort}
              serialPort={serialPort}
              pipeCommand={pipeCommand}
              selectedPreset={selectedPreset}
              presets={presets}
              serialPorts={serialPorts}
              bleAvailable={bleAvailable}
              onRefreshPorts={() => {
                void refreshSerialPorts();
              }}
              onIfaceTypeChange={setIfaceType}
              onIfaceHostChange={setIfaceHost}
              onIfacePortChange={setIfacePort}
              onSerialPortChange={setSerialPort}
              onPipeCommandChange={setPipeCommand}
              onSelectedPresetChange={setSelectedPreset}
              onAdd={() => {
                void handleAddInterface();
              }}
              onToggle={(id, enabled) => {
                void toggleInterface(id, enabled);
              }}
              onDelete={(id, name) => {
                setPendingDeleteInterface({ id, name });
              }}
              editingInterface={editingInterface}
              onStartEdit={setEditingInterface}
              onCancelEdit={() => {
                setEditingInterface(null);
              }}
              onSaveEdit={(id, patch) => {
                void saveEditInterface(id, patch);
              }}
            />
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

      {pendingDeleteInterface ? (
        <ConfirmModal
          title={t('connectionPanel.reticulumInterfaces.deleteConfirmTitle')}
          message={t('connectionPanel.reticulumInterfaces.deleteConfirmBody', {
            name: pendingDeleteInterface.name,
          })}
          confirmLabel={t('connectionPanel.reticulumInterfaces.deleteConfirm')}
          onConfirm={() => {
            void deleteInterface(pendingDeleteInterface.id);
          }}
          onCancel={() => {
            setPendingDeleteInterface(null);
          }}
        />
      ) : null}

      {showImportConfirm ? (
        <ConfirmModal
          title={t('radioPanel.reticulumConfigImport.confirmTitle')}
          message={t(
            pendingImportMode === 'merge'
              ? 'radioPanel.reticulumConfigImport.confirmMerge'
              : 'radioPanel.reticulumConfigImport.confirmReplace',
          )}
          confirmLabel={t('radioPanel.reticulumConfigImport.confirm')}
          onConfirm={() => {
            setShowImportConfirm(false);
            void runConfigImport(pendingImportMode, configPaste.trim());
          }}
          onCancel={() => {
            setShowImportConfirm(false);
          }}
        />
      ) : null}
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

function uiTypeFromRow(type: string): ReticulumIfaceUiType {
  const normalized = type.toLowerCase();
  if (normalized === 'udp' || normalized.includes('udpinterface')) return 'udp';
  if (normalized === 'kiss' || normalized.includes('kiss')) return 'kiss';
  if (normalized === 'pipe' || normalized.includes('pipe')) return 'pipe';
  if (normalized === 'i2p' || normalized.includes('i2p')) return 'i2p';
  if (normalized === 'rnode_multi' || normalized.includes('rnodemulti')) return 'rnode_multi';
  if (normalized.includes('tcp') || normalized === 'tcpclient') return 'tcp';
  if (normalized.includes('rnode')) return 'rnode';
  return 'auto';
}

function buildInterfaceEditPatch(draft: {
  name: string;
  type: ReticulumIfaceUiType;
  host: string;
  port: string;
  serialPort: string;
  preset: string;
  callsign: string;
  pipeCommand: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { name: draft.name.trim(), type: draft.type };
  if (draft.type === 'tcp' || draft.type === 'udp' || draft.type === 'i2p') {
    body.host = draft.host.trim();
    if (draft.type !== 'i2p') {
      body.port = Number.parseInt(draft.port, 10) || 4242;
    }
  }
  if (draft.type === 'rnode' || draft.type === 'rnode_multi' || draft.type === 'kiss') {
    body.serial_port = draft.serialPort.trim() || null;
  }
  if (draft.type === 'rnode' || draft.type === 'rnode_multi') {
    body.preset = draft.preset || null;
    body.callsign = draft.callsign.trim() || null;
  }
  if (draft.type === 'pipe') {
    body.command = draft.pipeCommand.trim() || null;
  }
  return body;
}

function InterfaceEditPanel({
  iface,
  presets,
  serialPorts,
  onSave,
  onCancel,
}: {
  iface: ReticulumInterfaceRow;
  presets: { id: string; label: string }[];
  serialPorts: { path: string; label?: string }[];
  onSave: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const uiType = uiTypeFromRow(iface.type);
  const [name, setName] = useState(iface.name);
  const [host, setHost] = useState(iface.host ?? '');
  const [port, setPort] = useState(iface.port != null ? String(iface.port) : '4242');
  const [serialPort, setSerialPort] = useState(iface.serial_port ?? '');
  const [preset, setPreset] = useState(iface.preset ?? '');
  const [callsign, setCallsign] = useState(iface.callsign ?? '');
  const osSerialPaths = serialPorts.map((p) => p.path);
  const serialPortStale =
    serialPort.trim().length > 0 &&
    osSerialPaths.length > 0 &&
    !osSerialPaths.includes(serialPort.trim());

  return (
    <div className="mt-3 rounded border border-amber-700/50 bg-amber-950/10 p-3">
      <h4 className="text-sm font-medium text-amber-200">
        {t('connectionPanel.reticulumInterfaces.editTitle')}: {iface.name}
      </h4>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-400">
          {t('connectionPanel.reticulumInterfaces.name')}
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
          />
        </label>
        {uiType === 'tcp' || uiType === 'udp' ? (
          <>
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.host')}
              <input
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                }}
                className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.port')}
              <input
                value={port}
                onChange={(e) => {
                  setPort(e.target.value);
                }}
                className="mt-1 block w-20 rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
              />
            </label>
          </>
        ) : null}
        {uiType === 'rnode' || uiType === 'rnode_multi' || uiType === 'kiss' ? (
          <>
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.serialPort')}
              {serialPorts.length > 0 ? (
                <select
                  value={serialPort}
                  onChange={(e) => {
                    setSerialPort(e.target.value);
                  }}
                  className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                >
                  <option value="">—</option>
                  {serialPorts.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.label ?? p.path}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={serialPort}
                  onChange={(e) => {
                    setSerialPort(e.target.value);
                  }}
                  className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                />
              )}
            </label>
            {serialPortStale ? (
              <p className="text-xs text-amber-300" role="alert">
                {t('connectionPanel.reticulumLocalInterfaces.stalePortHint')}
              </p>
            ) : null}
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.preset')}
              <select
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                }}
                className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.callsign')}
              <input
                value={callsign}
                onChange={(e) => {
                  setCallsign(e.target.value);
                }}
                className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
              />
            </label>
          </>
        ) : null}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => {
            onSave(
              buildInterfaceEditPatch({
                name,
                type: uiType,
                host,
                port,
                serialPort,
                preset,
                callsign,
                pipeCommand: '',
              }),
            );
          }}
          className="rounded bg-amber-700 px-3 py-1.5 text-sm text-white hover:bg-amber-600 disabled:opacity-40"
        >
          {t('connectionPanel.reticulumInterfaces.saveEdit')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-gray-600 px-3 py-1.5 text-sm text-gray-300 hover:bg-slate-800"
        >
          {t('connectionPanel.reticulumInterfaces.cancelEdit')}
        </button>
      </div>
    </div>
  );
}

function InterfacesSection({
  interfaces,
  osSerialPortPaths,
  ifaceType,
  ifaceHost,
  ifacePort,
  serialPort,
  pipeCommand,
  selectedPreset,
  presets,
  serialPorts,
  bleAvailable,
  onRefreshPorts,
  onIfaceTypeChange,
  onIfaceHostChange,
  onIfacePortChange,
  onSerialPortChange,
  onPipeCommandChange,
  onSelectedPresetChange,
  onAdd,
  onToggle,
  onDelete,
  editingInterface,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: {
  interfaces: ReticulumInterfaceRow[];
  osSerialPortPaths: string[];
  ifaceType: ReticulumIfaceUiType;
  ifaceHost: string;
  ifacePort: string;
  serialPort: string;
  pipeCommand: string;
  selectedPreset: string;
  presets: { id: string; label: string }[];
  serialPorts: { path: string; label?: string }[];
  bleAvailable: boolean;
  onRefreshPorts: () => void;
  onIfaceTypeChange: (v: ReticulumIfaceUiType) => void;
  onIfaceHostChange: (v: string) => void;
  onIfacePortChange: (v: string) => void;
  onSerialPortChange: (v: string) => void;
  onPipeCommandChange: (v: string) => void;
  onSelectedPresetChange: (v: string) => void;
  onAdd: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string, name: string) => void;
  editingInterface: ReticulumInterfaceRow | null;
  onStartEdit: (iface: ReticulumInterfaceRow) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, patch: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const showHostPort = ifaceType === 'tcp' || ifaceType === 'udp' || ifaceType === 'i2p';
  const showSerial = ifaceType === 'rnode' || ifaceType === 'rnode_multi' || ifaceType === 'kiss';
  const showRnodePreset = ifaceType === 'rnode' || ifaceType === 'rnode_multi';

  const localRowReason = (iface: ReticulumInterfaceRow): string | null => {
    const health = classifyReticulumLocalInterface(iface, osSerialPortPaths);
    if (health === 'stale_port') {
      return t('connectionPanel.reticulumInterfaces.localOfflineRowStale', {
        port: iface.serial_port ?? '',
      });
    }
    if (health === 'enabled_down') {
      return t('connectionPanel.reticulumInterfaces.localOfflineRow');
    }
    return null;
  };

  return (
    <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
      <h3 className="text-sm font-medium text-gray-200">
        {t('connectionPanel.reticulumInterfaces.title')}
      </h3>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-400">
          {t('connectionPanel.reticulumInterfaces.type')}
          <select
            value={ifaceType}
            onChange={(e) => {
              onIfaceTypeChange(e.target.value as ReticulumIfaceUiType);
            }}
            className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
          >
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
            <option value="auto">Auto</option>
            <option value="rnode">RNode</option>
            <option value="rnode_multi">RNode Multi</option>
            <option value="kiss">KISS</option>
            <option value="pipe">Pipe</option>
            <option value="i2p">I2P</option>
          </select>
        </label>
        {showHostPort ? (
          <>
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.host')}
              <input
                value={ifaceHost}
                onChange={(e) => {
                  onIfaceHostChange(e.target.value);
                }}
                className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
              />
            </label>
            {ifaceType !== 'i2p' ? (
              <label className="text-xs text-gray-400">
                {t('connectionPanel.reticulumInterfaces.port')}
                <input
                  value={ifacePort}
                  onChange={(e) => {
                    onIfacePortChange(e.target.value);
                  }}
                  className="mt-1 block w-20 rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                />
              </label>
            ) : null}
          </>
        ) : null}
        {ifaceType === 'pipe' ? (
          <label className="text-xs text-gray-400">
            {t('connectionPanel.reticulumInterfaces.pipeCommand')}
            <input
              value={pipeCommand}
              onChange={(e) => {
                onPipeCommandChange(e.target.value);
              }}
              className="mt-1 block min-w-[12rem] rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
            />
          </label>
        ) : null}
        {showSerial ? (
          <>
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.serialPort')}
              {serialPorts.length > 0 ? (
                <select
                  value={serialPort}
                  onChange={(e) => {
                    onSerialPortChange(e.target.value);
                  }}
                  className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                >
                  <option value="">—</option>
                  {serialPorts.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.label ?? p.path}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={serialPort}
                  onChange={(e) => {
                    onSerialPortChange(e.target.value);
                  }}
                  className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                />
              )}
            </label>
            {showRnodePreset ? (
              <label className="text-xs text-gray-400">
                {t('connectionPanel.reticulumInterfaces.preset')}
                <select
                  value={selectedPreset}
                  onChange={(e) => {
                    onSelectedPresetChange(e.target.value);
                  }}
                  className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                >
                  <option value="">—</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : null}
        {showSerial && serialPorts.length > 0 ? (
          <button
            type="button"
            onClick={onRefreshPorts}
            className="rounded border border-gray-600 px-2 py-1.5 text-xs text-gray-300 hover:bg-slate-800"
            aria-label={t('connectionPanel.reticulumLocalInterfaces.refreshPorts')}
          >
            {t('connectionPanel.reticulumLocalInterfaces.refreshPorts')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onAdd}
          className="rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600"
        >
          {t('connectionPanel.reticulumInterfaces.add')}
        </button>
      </div>
      {bleAvailable ? (
        <p className="text-muted mt-2 text-xs">
          {t('connectionPanel.reticulumInterfaces.bleAvailable')}
        </p>
      ) : null}
      <ul className="mt-3 space-y-2 text-sm">
        {interfaces.length === 0 ? (
          <li className="text-muted">{t('connectionPanel.reticulumNetworkEmpty')}</li>
        ) : (
          interfaces.map((iface) => {
            const rowReason = localRowReason(iface);
            const rowBorder = rowReason != null ? 'border-red-800/60' : 'border-gray-700/60';
            return (
              <li
                key={iface.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5 ${rowBorder}`}
              >
                <span>
                  <span className={reticulumLocalInterfaceTextClass(iface, osSerialPortPaths)}>
                    {iface.name} ({iface.type}) — {iface.status}
                  </span>
                  {rowReason ? (
                    <span className="mt-0.5 block text-xs text-red-300/90">{rowReason}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      onStartEdit(iface);
                    }}
                    className="text-xs text-sky-400 hover:underline"
                    aria-label={t('connectionPanel.reticulumInterfaces.edit', { name: iface.name })}
                  >
                    {t('connectionPanel.reticulumInterfaces.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onToggle(iface.id, !iface.enabled);
                    }}
                    className="text-xs text-amber-400 hover:underline"
                  >
                    {iface.enabled
                      ? t('connectionPanel.reticulumInterfaces.disable')
                      : t('connectionPanel.reticulumInterfaces.enable')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(iface.id, iface.name);
                    }}
                    className="text-xs text-red-400 hover:underline"
                    aria-label={t('connectionPanel.reticulumInterfaces.delete', {
                      name: iface.name,
                    })}
                  >
                    {t('connectionPanel.reticulumInterfaces.delete')}
                  </button>
                </span>
              </li>
            );
          })
        )}
      </ul>
      {editingInterface ? (
        <InterfaceEditPanel
          key={editingInterface.id}
          iface={editingInterface}
          presets={presets}
          serialPorts={serialPorts}
          onSave={(patch) => {
            onSaveEdit(editingInterface.id, patch);
          }}
          onCancel={onCancelEdit}
        />
      ) : null}
    </div>
  );
}

export default ReticulumRadioPanel;
