/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isReticulumAutostartEnabled,
  setReticulumAutostartEnabled,
} from '@/renderer/lib/appSettingsStorage';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { ReticulumSidecarEvent, ReticulumSidecarStatus } from '@/shared/reticulum-types';

interface ReticulumIdentityStatus {
  configured: boolean;
  identity_hash: string;
  lxmf_hash: string;
  display_name?: string | null;
}

interface ReticulumInterfaceRow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: string;
  host?: string | null;
  port?: number | null;
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

export interface ReticulumConnectionPanelProps {
  /** True when runtime reports connected/connecting (authoritative for Start/Stop UI). */
  stackRunning: boolean;
  connecting: boolean;
  stackError?: string | null;
  onStartStack: () => Promise<void>;
  onStopStack: () => Promise<void>;
}

export function ReticulumConnectionPanel({
  stackRunning: stackRunningProp,
  connecting,
  stackError,
  onStartStack,
  onStopStack,
}: ReticulumConnectionPanelProps) {
  const { t } = useTranslation();
  const [sidecarStatus, setSidecarStatus] = useState<ReticulumSidecarStatus>({
    running: false,
    port: 0,
    pid: null,
  });
  const [autoStart, setAutoStart] = useState(isReticulumAutostartEnabled);
  const autostartAttemptedRef = useRef(false);
  const [identity, setIdentity] = useState<ReticulumIdentityStatus | null>(null);
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
  const [bleAvailable, setBleAvailable] = useState(false);
  const [exportJson, setExportJson] = useState<string | null>(null);

  const sidecarRunning = stackRunningProp || sidecarStatus.running;

  const refreshSidecarStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.reticulum.getStatus();
      setSidecarStatus(status);
      return status;
    } catch (e) {
      console.debug('[ReticulumConnectionPanel] getStatus ' + errLikeToLogString(e));
      return { running: false, port: 0, pid: null };
    }
  }, []);

  useEffect(() => {
    void refreshSidecarStatus();
    const unsubStatus = window.electronAPI.reticulum.onStatus((status) => {
      setSidecarStatus(status);
    });
    return unsubStatus;
  }, [refreshSidecarStatus]);

  useEffect(() => {
    if (!autoStart || autostartAttemptedRef.current) return;
    autostartAttemptedRef.current = true;
    void refreshSidecarStatus().then((status) => {
      if (!status.running && !connecting) {
        void onStartStack().catch((e: unknown) => {
          console.warn('[ReticulumConnectionPanel] autostart failed ' + errLikeToLogString(e));
        });
      }
    });
  }, [autoStart, connecting, onStartStack, refreshSidecarStatus]);

  const handleAutoStartChange = (enabled: boolean) => {
    setAutoStart(enabled);
    setReticulumAutostartEnabled(enabled);
  };

  const handleExportIdentity = async () => {
    setIdentityError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/export', {})) as {
        ok?: boolean;
        backup?: string;
        error?: string;
      };
      if (!res.ok) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumIdentity.failed'));
        return;
      }
      setExportJson(res.backup ?? null);
    } catch (e) {
      console.warn('[ReticulumConnectionPanel] export identity ' + errLikeToLogString(e));
      setIdentityError(errLikeToLogString(e));
    }
  };

  const refreshIdentity = useCallback(async () => {
    if (!sidecarRunning) {
      setIdentity(null);
      return;
    }
    try {
      const body = (await window.electronAPI.reticulum.proxyGet(
        '/api/v1/identity/status',
      )) as ReticulumIdentityStatus;
      setIdentity(body);
    } catch (e) {
      console.debug('[ReticulumConnectionPanel] identity status ' + errLikeToLogString(e));
    }
  }, [sidecarRunning]);

  const refreshInterfaces = useCallback(async () => {
    if (!sidecarRunning) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
        interfaces?: ReticulumInterfaceRow[];
      };
      setInterfaces(body.interfaces ?? []);
    } catch (e) {
      console.debug('[ReticulumConnectionPanel] interfaces ' + errLikeToLogString(e));
    }
  }, [sidecarRunning]);

  const refreshPeers = useCallback(async () => {
    if (!sidecarRunning) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/peers')) as {
        peers?: ReticulumPeerRow[];
      };
      setPeers(body.peers ?? []);
    } catch (e) {
      console.debug('[ReticulumConnectionPanel] peers ' + errLikeToLogString(e));
    }
  }, [sidecarRunning]);

  const refreshPropagation = useCallback(async () => {
    if (!sidecarRunning) return;
    try {
      const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/propagation')) as {
        propagation?: PropagationRow[];
      };
      setPropagation(body.propagation ?? []);
    } catch (e) {
      console.debug('[ReticulumConnectionPanel] propagation ' + errLikeToLogString(e));
    }
  }, [sidecarRunning]);

  useEffect(() => {
    void refreshIdentity();
  }, [refreshIdentity]);

  useEffect(() => {
    if (!sidecarRunning) {
      setInterfaces([]);
      setPeers([]);
      setPropagation([]);
      return;
    }
    void refreshInterfaces();
    void refreshPeers();
    void refreshPropagation();
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
  }, [sidecarRunning, refreshInterfaces, refreshPeers, refreshPropagation]);

  useEffect(() => {
    if (!sidecarRunning) return;
    void window.electronAPI.reticulum.proxyGet('/api/v1/rnode/presets').then((body) => {
      const presetsBody = body as { presets?: { id: string; label: string }[] };
      setPresets(presetsBody.presets ?? []);
    });
    void window.electronAPI.reticulum.proxyGet('/api/v1/ble/availability').then((body) => {
      const ble = body as { available?: boolean };
      setBleAvailable(Boolean(ble.available));
    });
  }, [sidecarRunning]);

  const handleGenerate = async () => {
    if (!sidecarRunning) return;
    setIdentityError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPost('/api/v1/identity/generate', {
        display_name: displayName.trim() || null,
      })) as { ok?: boolean; mnemonic?: string; error?: string };
      if (!res.ok) {
        setIdentityError(res.error ?? t('connectionPanel.reticulumIdentity.failed'));
        return;
      }
      setMnemonic(res.mnemonic ?? null);
      setConfirmSaved(false);
      await refreshIdentity();
    } catch (e) {
      console.warn('[ReticulumConnectionPanel] generate identity ' + errLikeToLogString(e));
      setIdentityError(errLikeToLogString(e));
    }
  };

  const handleImport = async () => {
    if (!sidecarRunning) return;
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
      console.warn('[ReticulumConnectionPanel] import identity ' + errLikeToLogString(e));
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

  const identityReady = identity?.configured === true;
  const identityActionsDisabled = !sidecarRunning || connecting;

  return (
    <div className="space-y-4">
      <div className="bg-deep-black overflow-hidden rounded-lg border border-gray-700">
        <div className="bg-secondary-dark flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <span className="font-medium text-gray-200">
            {t('connectionPanel.reticulumStackTitle')}
          </span>
          <span
            className={`text-xs font-medium ${
              sidecarRunning
                ? 'text-brand-green'
                : connecting
                  ? 'animate-pulse text-orange-400'
                  : 'text-gray-400'
            }`}
          >
            ●{' '}
            {sidecarRunning
              ? t('connectionPanel.reticulumStackRunning')
              : connecting
                ? t('connectionPanel.connecting')
                : t('connectionPanel.disconnected')}
          </span>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-muted text-xs">{t('connectionPanel.reticulumStackHint')}</p>
          {stackError ? (
            <p className="text-sm text-red-400" role="alert">
              {stackError}
            </p>
          ) : null}
          {sidecarRunning && sidecarStatus.port > 0 ? (
            <p className="text-muted text-xs" role="status">
              127.0.0.1:{sidecarStatus.port}
            </p>
          ) : null}
          {sidecarRunning ? (
            <button
              type="button"
              aria-label={t('connectionPanel.reticulumStopStack')}
              disabled={connecting}
              onClick={() => {
                void onStopStack();
              }}
              className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-40"
            >
              {t('connectionPanel.reticulumStopStack')}
            </button>
          ) : (
            <button
              type="button"
              aria-label={t('connectionPanel.reticulumStartStack')}
              disabled={connecting}
              onClick={() => {
                void onStartStack();
              }}
              className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-40"
            >
              {connecting
                ? t('connectionPanel.connecting')
                : t('connectionPanel.reticulumStartStack')}
            </button>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={autoStart}
              onChange={(e) => {
                handleAutoStartChange(e.target.checked);
              }}
              aria-label={t('connectionPanel.reticulumAutostart')}
            />
            {t('connectionPanel.reticulumAutostart')}
          </label>
        </div>
      </div>

      <div className="bg-deep-black rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-200">
          {t('connectionPanel.reticulumIdentity.title')}
        </h3>
        <p className="text-muted mt-1 text-xs">{t('connectionPanel.reticulumIdentity.hint')}</p>
        {!sidecarRunning ? (
          <p className="mt-2 text-sm text-amber-300/90">
            {t('connectionPanel.reticulumIdentity.startStackFirst')}
          </p>
        ) : null}
        {identityError ? (
          <p className="mt-2 text-sm text-red-400" role="alert">
            {identityError}
          </p>
        ) : null}
        {identityReady ? (
          <div className="mt-3 space-y-1 text-sm text-gray-300">
            <div>
              <span className="text-muted">{t('connectionPanel.reticulumIdentity.hashLabel')}</span>{' '}
              <code className="text-amber-300">{identity?.lxmf_hash.slice(0, 24)}…</code>
            </div>
            {identity?.display_name ? (
              <div>
                <span className="text-muted">
                  {t('connectionPanel.reticulumIdentity.nameLabel')}
                </span>{' '}
                {identity.display_name}
              </div>
            ) : null}
            <button
              type="button"
              aria-label={t('connectionPanel.reticulumIdentity.export')}
              onClick={() => {
                void handleExportIdentity();
              }}
              className="mt-2 rounded border border-gray-600 px-2 py-1 text-xs text-gray-300 hover:bg-slate-800"
            >
              {t('connectionPanel.reticulumIdentity.export')}
            </button>
            {exportJson ? (
              <textarea
                readOnly
                value={exportJson}
                rows={3}
                className="mt-2 w-full rounded border border-gray-700 bg-slate-950 p-2 font-mono text-xs text-gray-300"
                aria-label={t('connectionPanel.reticulumIdentity.export')}
              />
            ) : null}
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <label className="block text-xs text-gray-400">
              {t('connectionPanel.reticulumIdentity.displayName')}
              <input
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                }}
                disabled={identityActionsDisabled}
                className="mt-1 w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={identityActionsDisabled}
                onClick={() => {
                  void handleGenerate();
                }}
                className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm text-white hover:bg-amber-600 disabled:opacity-40"
              >
                {t('connectionPanel.reticulumIdentity.generate')}
              </button>
            </div>
            {mnemonic ? (
              <div className="rounded border border-amber-600/40 bg-amber-950/30 p-3 text-sm">
                <p className="text-muted text-xs">
                  {t('connectionPanel.reticulumIdentity.mnemonic')}
                </p>
                <p className="mt-1 font-mono text-amber-100">{mnemonic}</p>
                <label className="mt-2 flex items-center gap-2 text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={confirmSaved}
                    onChange={(e) => {
                      setConfirmSaved(e.target.checked);
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
                  setImportPhrase(e.target.value);
                }}
                disabled={identityActionsDisabled}
                rows={2}
                className="mt-1 w-full rounded border border-gray-600 bg-slate-900 px-2 py-1.5 text-sm text-gray-200 disabled:opacity-50"
              />
            </label>
            <button
              type="button"
              disabled={identityActionsDisabled}
              onClick={() => {
                void handleImport();
              }}
              className="rounded-lg border border-gray-600 px-3 py-1.5 text-sm text-gray-200 hover:bg-slate-800 disabled:opacity-40"
            >
              {t('connectionPanel.reticulumIdentity.import')}
            </button>
          </div>
        )}
      </div>

      {sidecarRunning ? (
        <>
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
                    setIfaceType(e.target.value as 'tcp' | 'auto' | 'rnode');
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
                    Host
                    <input
                      value={ifaceHost}
                      onChange={(e) => {
                        setIfaceHost(e.target.value);
                      }}
                      className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-400">
                    Port
                    <input
                      value={ifacePort}
                      onChange={(e) => {
                        setIfacePort(e.target.value);
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
                    <input
                      value={serialPort}
                      onChange={(e) => {
                        setSerialPort(e.target.value);
                      }}
                      className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-400">
                    {t('connectionPanel.reticulumInterfaces.preset')}
                    <select
                      value={selectedPreset}
                      onChange={(e) => {
                        setSelectedPreset(e.target.value);
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
                onClick={() => {
                  void handleAddInterface();
                }}
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
                    <button
                      type="button"
                      onClick={() => {
                        void toggleInterface(iface.id, !iface.enabled);
                      }}
                      className="text-xs text-amber-400 hover:underline"
                    >
                      {iface.enabled
                        ? t('connectionPanel.reticulumInterfaces.disable')
                        : t('connectionPanel.reticulumInterfaces.enable')}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>

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
                <p className="text-muted py-2 text-xs">
                  {t('connectionPanel.reticulumNetworkEmpty')}
                </p>
              ) : null}
            </div>
          </div>

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
                        .then(() => refreshPropagation())
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
        </>
      ) : null}
    </div>
  );
}
