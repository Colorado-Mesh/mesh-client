/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  type ReticulumIdentityStatus,
  useReticulumSidecarApi,
} from '@/renderer/lib/reticulum/useReticulumSidecarApi';
import type { ReticulumSidecarEvent } from '@/shared/reticulum-types';

import { ConfirmModal } from './ConfirmModal';

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

interface ReticulumPeerRow {
  destination_hash: string;
  display_name?: string | null;
  hops?: number | null;
  last_seen?: number | null;
  interface?: string | null;
}

interface PropagationRow {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
}

export interface ReticulumRadioPanelProps {
  stackRunning: boolean;
  connecting: boolean;
  onSidecarEvent?: (evt: ReticulumSidecarEvent) => void;
  onStartStack: () => Promise<void>;
}

/** Radio tab: identity, interfaces, network peers, propagation, config import. */
export function ReticulumRadioPanel({
  stackRunning,
  connecting,
  onSidecarEvent,
  onStartStack,
}: ReticulumRadioPanelProps) {
  const { t } = useTranslation();
  const { sidecarApiReady, identity, statsSummary, appInfo, refreshIdentity } =
    useReticulumSidecarApi({
      stackRunning,
      connecting,
      onStartStack,
      onEvent: onSidecarEvent,
    });

  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [importPhrase, setImportPhrase] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [confirmSaved, setConfirmSaved] = useState(false);
  const [interfaces, setInterfaces] = useState<ReticulumInterfaceRow[]>([]);
  const [peers, setPeers] = useState<ReticulumPeerRow[]>([]);
  const [propagation, setPropagation] = useState<PropagationRow[]>([]);
  const [ifaceType, setIfaceType] = useState<'tcp' | 'auto' | 'rnode'>('tcp');
  const [ifaceHost, setIfaceHost] = useState('');
  const [ifacePort, setIfacePort] = useState('4242');
  const [serialPort, setSerialPort] = useState('');
  const [presets, setPresets] = useState<{ id: string; label: string }[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [serialPorts, setSerialPorts] = useState<{ path: string; label?: string }[]>([]);
  const [bleAvailable, setBleAvailable] = useState(false);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [configPaste, setConfigPaste] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
  const [pendingDeleteInterface, setPendingDeleteInterface] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingInterface, setEditingInterface] = useState<ReticulumInterfaceRow | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [gamesStatus, setGamesStatus] = useState<string | null>(null);
  const [pendingImportMode, setPendingImportMode] = useState<'merge' | 'replace'>('merge');
  const [stackSettings, setStackSettings] = useState({
    enable_transport: false,
    share_instance: true,
    loglevel: 4,
  });

  const refreshInterfaces = useCallback(async () => {
    if (!sidecarApiReady) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
        interfaces?: ReticulumInterfaceRow[];
      };
      setInterfaces(body.interfaces ?? []);
    } catch (e) {
      console.debug('[ReticulumRadioPanel] interfaces ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  const refreshPeers = useCallback(async () => {
    if (!sidecarApiReady) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/peers')) as {
        peers?: ReticulumPeerRow[];
      };
      setPeers(body.peers ?? []);
    } catch (e) {
      console.debug('[ReticulumRadioPanel] peers ' + errLikeToLogString(e));
    }
  }, [sidecarApiReady]);

  const refreshPropagation = useCallback(async () => {
    if (!sidecarApiReady) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/propagation')) as {
        propagation?: PropagationRow[];
      };
      setPropagation(body.propagation ?? []);
    } catch (e) {
      console.debug('[ReticulumRadioPanel] propagation ' + errLikeToLogString(e));
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

  useEffect(() => {
    if (!sidecarApiReady) {
      setInterfaces([]);
      setPeers([]);
      setPropagation([]);
      return;
    }
    void refreshInterfaces();
    void refreshPeers();
    void refreshPropagation();
    void refreshStackSettings();
    const unsub = window.electronAPI.reticulum.onEvent((evt: ReticulumSidecarEvent) => {
      if (
        evt.type === 'interface.state' ||
        evt.type === 'peers_updated' ||
        evt.type === 'stats_update'
      ) {
        void refreshInterfaces();
        void refreshPeers();
        void refreshPropagation();
      }
    });
    return unsub;
  }, [sidecarApiReady, refreshInterfaces, refreshPeers, refreshPropagation, refreshStackSettings]);

  useEffect(() => {
    if (!sidecarApiReady) return;
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/rnode/presets')
      .then((body) => {
        const presetsBody = body as { presets?: { id: string; label: string }[] };
        setPresets(presetsBody.presets ?? []);
      })
      .catch(() => {});
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/serial/ports')
      .then((body) => {
        const portsBody = body as { ports?: { path: string; label?: string }[] };
        setSerialPorts(portsBody.ports ?? []);
      })
      .catch(() => {});
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/ble/availability')
      .then((body) => {
        const ble = body as { available?: boolean };
        setBleAvailable(Boolean(ble.available));
      })
      .catch(() => {});
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/voice/status')
      .then((body) => {
        const status = body as { enabled?: boolean; reason?: string };
        setVoiceStatus(status.enabled ? 'enabled' : (status.reason ?? 'disabled'));
      })
      .catch(() => {
        setVoiceStatus(null);
      });
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/games/status')
      .then((body) => {
        const status = body as { enabled?: boolean; reason?: string };
        setGamesStatus(status.enabled ? 'enabled' : (status.reason ?? 'disabled'));
      })
      .catch(() => {
        setGamesStatus(null);
      });
  }, [sidecarApiReady]);

  const handleFactoryReset = async () => {
    try {
      await window.electronAPI.reticulum.proxyPost('/api/v1/system/factory-reset', {});
      setShowFactoryResetConfirm(false);
      await refreshIdentity();
      void refreshInterfaces();
      void refreshPeers();
    } catch (e) {
      console.warn('[ReticulumRadioPanel] factory reset ' + errLikeToLogString(e));
    }
  };

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
    const body: Record<string, unknown> = { type: ifaceType };
    if (ifaceType === 'tcp') {
      body.host = ifaceHost.trim();
      body.port = Number.parseInt(ifacePort, 10) || 4242;
    }
    if (ifaceType === 'rnode') {
      body.serial_port = serialPort.trim();
      body.preset = selectedPreset || null;
    }
    await window.electronAPI.reticulum.proxyPost('/api/v1/interfaces', body);
    await refreshInterfaces();
  };

  const toggleInterface = async (id: string, enabled: boolean) => {
    const path = enabled ? `/api/v1/interfaces/${id}/enable` : `/api/v1/interfaces/${id}/disable`;
    await window.electronAPI.reticulum.proxyPost(path, {});
    await refreshInterfaces();
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
    await window.electronAPI.reticulum.proxyPut('/api/v1/stack/settings', stackSettings);
    await refreshStackSettings();
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

      <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-200">
          {t('radioPanel.reticulumStackSettings.title')}
        </h3>
        <div className="mt-3 space-y-2 text-sm">
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
      </div>

      <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-200">
          {t('connectionPanel.reticulumIdentity.title')}
        </h3>
        <p className="text-muted mt-1 text-xs">{t('connectionPanel.reticulumIdentity.hint')}</p>
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
      </div>

      {sidecarApiReady ? (
        <>
          <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
            <h3 className="text-sm font-medium text-gray-200">
              {t('radioPanel.reticulumConfigImport.title')}
            </h3>
            <p className="text-muted mt-1 text-xs">{t('radioPanel.reticulumConfigImport.hint')}</p>
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
          </div>

          <InterfacesSection
            interfaces={interfaces}
            ifaceType={ifaceType}
            ifaceHost={ifaceHost}
            ifacePort={ifacePort}
            serialPort={serialPort}
            selectedPreset={selectedPreset}
            presets={presets}
            serialPorts={serialPorts}
            bleAvailable={bleAvailable}
            onIfaceTypeChange={setIfaceType}
            onIfaceHostChange={setIfaceHost}
            onIfacePortChange={setIfacePort}
            onSerialPortChange={setSerialPort}
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

          <PeersSection peers={peers} />
          <PropagationSection
            propagation={propagation}
            onRefresh={() => {
              void refreshPropagation();
            }}
          />
          <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
            <h3 className="text-sm font-medium text-gray-200">
              {t('radioPanel.reticulumVoiceGames.title')}
            </h3>
            <p className="text-muted mt-1 text-xs">
              {t('radioPanel.reticulumVoiceGames.voiceStatus', {
                status: voiceStatus ?? t('radioPanel.reticulumVoiceGames.unavailable'),
              })}
            </p>
            <p className="text-muted text-xs">
              {t('radioPanel.reticulumVoiceGames.gamesStatus', {
                status: gamesStatus ?? t('radioPanel.reticulumVoiceGames.unavailable'),
              })}
            </p>
          </div>
          <div className="bg-deep-black rounded-lg border border-red-900/50 p-4">
            <h3 className="text-sm font-medium text-red-300">
              {t('radioPanel.reticulumFactoryReset.title')}
            </h3>
            <p className="text-muted mt-1 text-xs">{t('radioPanel.reticulumFactoryReset.hint')}</p>
            <button
              type="button"
              onClick={() => {
                setShowFactoryResetConfirm(true);
              }}
              className="mt-2 rounded border border-red-700 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
            >
              {t('radioPanel.reticulumFactoryReset.button')}
            </button>
          </div>
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

      {showFactoryResetConfirm ? (
        <ConfirmModal
          title={t('radioPanel.reticulumFactoryReset.confirmTitle')}
          message={t('radioPanel.reticulumFactoryReset.confirmBody')}
          confirmLabel={t('radioPanel.reticulumFactoryReset.confirm')}
          onConfirm={() => {
            void handleFactoryReset();
          }}
          onCancel={() => {
            setShowFactoryResetConfirm(false);
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

function uiTypeFromRow(type: string): 'tcp' | 'auto' | 'rnode' {
  const normalized = type.toLowerCase();
  if (normalized.includes('tcp') || normalized === 'tcpclient') return 'tcp';
  if (normalized.includes('rnode')) return 'rnode';
  return 'auto';
}

function buildInterfaceEditPatch(draft: {
  name: string;
  type: 'tcp' | 'auto' | 'rnode';
  host: string;
  port: string;
  serialPort: string;
  preset: string;
  callsign: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { name: draft.name.trim(), type: draft.type };
  if (draft.type === 'tcp') {
    body.host = draft.host.trim();
    body.port = Number.parseInt(draft.port, 10) || 4242;
  }
  if (draft.type === 'rnode') {
    body.serial_port = draft.serialPort.trim() || null;
    body.preset = draft.preset || null;
    body.callsign = draft.callsign.trim() || null;
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
        {uiType === 'tcp' ? (
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
        {uiType === 'rnode' ? (
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
  ifaceType,
  ifaceHost,
  ifacePort,
  serialPort,
  selectedPreset,
  presets,
  serialPorts,
  bleAvailable,
  onIfaceTypeChange,
  onIfaceHostChange,
  onIfacePortChange,
  onSerialPortChange,
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
  ifaceType: 'tcp' | 'auto' | 'rnode';
  ifaceHost: string;
  ifacePort: string;
  serialPort: string;
  selectedPreset: string;
  presets: { id: string; label: string }[];
  serialPorts: { path: string; label?: string }[];
  bleAvailable: boolean;
  onIfaceTypeChange: (v: 'tcp' | 'auto' | 'rnode') => void;
  onIfaceHostChange: (v: string) => void;
  onIfacePortChange: (v: string) => void;
  onSerialPortChange: (v: string) => void;
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
              onIfaceTypeChange(e.target.value as 'tcp' | 'auto' | 'rnode');
            }}
            className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
          >
            <option value="tcp">TCP</option>
            <option value="auto">Auto</option>
            <option value="rnode">RNode</option>
          </select>
        </label>
        {ifaceType === 'tcp' ? (
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
          </>
        ) : null}
        {ifaceType === 'rnode' ? (
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
          </>
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
          interfaces.map((iface) => (
            <li
              key={iface.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-700/60 px-2 py-1.5"
            >
              <span>
                {iface.name} ({iface.type}) — {iface.status}
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
                  aria-label={t('connectionPanel.reticulumInterfaces.delete', { name: iface.name })}
                >
                  {t('connectionPanel.reticulumInterfaces.delete')}
                </button>
              </span>
            </li>
          ))
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

function PeersSection({ peers }: { peers: ReticulumPeerRow[] }) {
  const { t } = useTranslation();
  return (
    <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
      <h3 className="text-sm font-medium text-gray-200">
        {t('connectionPanel.reticulumNetworkTitle')}
      </h3>
      <div className="mt-2 max-h-48 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted border-b border-gray-700">
              <th className="py-1 pr-2">{t('connectionPanel.reticulumPeers.name')}</th>
              <th className="py-1 pr-2">{t('connectionPanel.reticulumPeers.hops')}</th>
              <th className="py-1">{t('connectionPanel.reticulumPeers.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {peers.map((peer) => (
              <tr key={peer.destination_hash} className="border-b border-gray-800">
                <td className="py-1 pr-2 font-mono">
                  {peer.display_name ?? peer.destination_hash.slice(0, 12)}
                </td>
                <td className="py-1 pr-2">{peer.hops ?? '—'}</td>
                <td className="py-1">
                  <button
                    type="button"
                    className="text-amber-400 hover:underline"
                    onClick={() =>
                      void window.electronAPI.reticulum.proxyPost(
                        `/api/v1/peers/${peer.destination_hash}/path`,
                        {},
                      )
                    }
                  >
                    {t('connectionPanel.reticulumPeers.path')}
                  </button>
                  <button
                    type="button"
                    className="ml-2 text-amber-400 hover:underline"
                    onClick={() =>
                      void window.electronAPI.reticulum.proxyPost(
                        `/api/v1/peers/${peer.destination_hash}/probe`,
                        {},
                      )
                    }
                  >
                    {t('connectionPanel.reticulumPeers.probe')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {peers.length === 0 ? (
          <p className="text-muted py-2 text-xs">{t('connectionPanel.reticulumNetworkEmpty')}</p>
        ) : null}
      </div>
    </div>
  );
}

function PropagationSection({
  propagation,
  onRefresh,
}: {
  propagation: PropagationRow[];
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
      <h3 className="text-sm font-medium text-gray-200">
        {t('connectionPanel.reticulumPropagation.title')}
      </h3>
      <ul className="mt-2 space-y-2 text-sm">
        {propagation.map((node) => (
          <li
            key={node.id}
            className="flex items-center justify-between rounded border border-gray-700/60 px-2 py-1.5"
          >
            <span>
              {node.name} ({node.status})
            </span>
            <button
              type="button"
              onClick={() =>
                void window.electronAPI.reticulum
                  .proxyPost(
                    `/api/v1/propagation/${node.id}/${node.enabled ? 'disable' : 'enable'}`,
                    {},
                  )
                  .then(onRefresh)
              }
              className="text-xs text-amber-400 hover:underline"
            >
              {node.enabled
                ? t('connectionPanel.reticulumPropagation.disable')
                : t('connectionPanel.reticulumPropagation.enable')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ReticulumRadioPanel;
