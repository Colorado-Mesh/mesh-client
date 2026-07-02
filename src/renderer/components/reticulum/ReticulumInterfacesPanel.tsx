/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useReticulumInterfaceDevicePicker } from '@/renderer/hooks/useReticulumInterfaceDevicePicker';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import { reticulumInterfaceChangeRequiresStackRestart } from '@/renderer/lib/reticulum/reticulumInterfaceStackRestart';
import {
  classifyReticulumLocalInterface,
  isReticulumBleRnodeSerialPort,
  reticulumLocalInterfaceTextClass,
  reticulumLocalOfflineDisplayKind,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import type {
  ReticulumInterfaceRow,
  ReticulumSerialPortOption,
} from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { tryGetReticulumSession } from '@/renderer/lib/sessions/reticulumSession';

import { ConfirmModal } from '../ConfirmModal';
import { ReticulumInterfaceDevicePickerModal } from './ReticulumInterfaceDevicePickerModal';

type ReticulumRnodeTransport = 'serial' | 'ble';

type ReticulumIfaceUiType =
  'tcp' | 'auto' | 'rnode' | 'udp' | 'kiss' | 'pipe' | 'i2p' | 'rnode_multi' | 'ble_peer';

export interface ReticulumInterfacesPanelProps {
  sidecarApiReady: boolean;
  connecting: boolean;
  interfaces: ReticulumInterfaceRow[];
  serialPorts: ReticulumSerialPortOption[];
  serialPortPaths: string[];
  onRefresh: () => Promise<unknown>;
  onBeginBleConnectGrace: () => void;
}

/** Connection tab: Reticulum interface list, add/edit/delete, device picker. */
export function ReticulumInterfacesPanel({
  sidecarApiReady,
  connecting,
  interfaces,
  serialPorts,
  serialPortPaths,
  onRefresh,
  onBeginBleConnectGrace,
}: ReticulumInterfacesPanelProps) {
  const { t } = useTranslation();
  const [ifaceType, setIfaceType] = useState<ReticulumIfaceUiType>('tcp');
  const [ifaceHost, setIfaceHost] = useState('');
  const [ifacePort, setIfacePort] = useState('4242');
  const [serialPort, setSerialPort] = useState('');
  const [pipeCommand, setPipeCommand] = useState('');
  const [presets, setPresets] = useState<{ id: string; label: string }[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [bleAvailable, setBleAvailable] = useState(false);
  const [rnodeTransport, setRnodeTransport] = useState<ReticulumRnodeTransport>('serial');
  const [seedAddresses, setSeedAddresses] = useState('');
  const devicePicker = useReticulumInterfaceDevicePicker();
  const [interfaceError, setInterfaceError] = useState<string | null>(null);
  const [pendingDeleteInterface, setPendingDeleteInterface] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingInterface, setEditingInterface] = useState<ReticulumInterfaceRow | null>(null);
  const [restartStackHint, setRestartStackHint] = useState(false);

  useEffect(() => {
    if (!sidecarApiReady) {
      setBleAvailable(false);
      return;
    }
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/rnode/presets')
      .then((body) => {
        const presetsBody = body as { presets?: { id: string; label: string }[] };
        setPresets(presetsBody.presets ?? []);
      })
      .catch(() => {}); // catch-no-log-ok optional RNode presets prefetch; empty presets is safe default
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/ble/availability')
      .then((body) => {
        const ble = body as { available?: boolean };
        setBleAvailable(Boolean(ble.available));
      })
      .catch(() => {}); // catch-no-log-ok optional BLE availability probe; false default is safe
  }, [sidecarApiReady]);

  const restartStackForInterfaceChange = useCallback(async () => {
    const session = tryGetReticulumSession();
    if (!session?.restartStack) {
      setRestartStackHint(true);
      return;
    }
    try {
      await session.restartStack();
      onBeginBleConnectGrace();
      setRestartStackHint(false);
      await onRefresh();
    } catch (e) {
      console.error('[ReticulumInterfacesPanel] restart stack failed ' + errLikeToLogString(e));
      setInterfaceError(
        t('connectionPanel.reticulumInterfaces.restartStackFailed', {
          message: errLikeToLogString(e),
        }),
      );
      setRestartStackHint(true);
    }
  }, [onBeginBleConnectGrace, onRefresh, t]);

  const handleAddInterface = async () => {
    setInterfaceError(null);
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
      if (ifaceType === 'ble_peer') {
        const seeds = seedAddresses
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        body.seed_addresses = seeds;
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
        setInterfaceError(res.error ?? t('connectionPanel.reticulumInterfaces.addFailed'));
        return;
      }
      await onRefresh();
      if (reticulumInterfaceChangeRequiresStackRestart(ifaceType)) {
        await restartStackForInterfaceChange();
      }
    } catch (e) {
      // catch-no-log-ok: interface add failure shown via interfaceError
      setInterfaceError(errLikeToLogString(e));
    }
  };

  const toggleInterface = async (id: string, enabled: boolean, ifaceTypeName?: string) => {
    setInterfaceError(null);
    try {
      const path = enabled ? `/api/v1/interfaces/${id}/enable` : `/api/v1/interfaces/${id}/disable`;
      const res = (await window.electronAPI.reticulum.proxyPost(path, {})) as {
        ok?: boolean;
        error?: string;
      };
      if (res?.ok === false) {
        setInterfaceError(res.error ?? t('connectionPanel.reticulumInterfaces.toggleFailed'));
        return;
      }
      await onRefresh();
      if (enabled && ifaceTypeName && reticulumInterfaceChangeRequiresStackRestart(ifaceTypeName)) {
        await restartStackForInterfaceChange();
      }
    } catch (e) {
      // catch-no-log-ok: interface toggle failure shown via interfaceError
      setInterfaceError(errLikeToLogString(e));
    }
  };

  const deleteInterface = async (id: string) => {
    setInterfaceError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyDelete(`/api/v1/interfaces/${id}`)) as {
        ok?: boolean;
        error?: string;
      };
      if (res?.ok === false) {
        setInterfaceError(res.error ?? t('connectionPanel.reticulumInterfaces.deleteFailed'));
        return;
      }
      setPendingDeleteInterface(null);
      if (editingInterface?.id === id) {
        setEditingInterface(null);
      }
      await onRefresh();
    } catch (e) {
      // catch-no-log-ok: delete failure shown via interfaceError
      setInterfaceError(errLikeToLogString(e));
    }
  };

  const saveEditInterface = async (id: string, patch: Record<string, unknown>) => {
    setInterfaceError(null);
    try {
      const res = (await window.electronAPI.reticulum.proxyPut(
        `/api/v1/interfaces/${id}`,
        patch,
      )) as { ok?: boolean; error?: string };
      if (res?.ok === false) {
        setInterfaceError(res.error ?? t('connectionPanel.reticulumInterfaces.editFailed'));
        return;
      }
      setEditingInterface(null);
      await onRefresh();
      if (reticulumInterfaceChangeRequiresStackRestart(undefined, patch)) {
        await restartStackForInterfaceChange();
      }
    } catch (e) {
      // catch-no-log-ok: edit failure shown via interfaceError
      setInterfaceError(errLikeToLogString(e));
    }
  };

  const actionsDisabled = !sidecarApiReady || connecting;

  return (
    <div className="space-y-2">
      {interfaceError ? (
        <p className="text-sm text-red-400" role="alert">
          {interfaceError}
        </p>
      ) : null}
      {restartStackHint ? (
        <p className="text-xs text-amber-300" role="status">
          {t('connectionPanel.reticulumInterfaces.restartStackHint')}
        </p>
      ) : null}
      <InterfacesSection
        interfaces={interfaces}
        osSerialPortPaths={serialPortPaths}
        sidecarReady={sidecarApiReady}
        actionsDisabled={actionsDisabled}
        ifaceType={ifaceType}
        ifaceHost={ifaceHost}
        ifacePort={ifacePort}
        serialPort={serialPort}
        pipeCommand={pipeCommand}
        selectedPreset={selectedPreset}
        presets={presets}
        serialPorts={serialPorts}
        bleAvailable={bleAvailable}
        rnodeTransport={rnodeTransport}
        seedAddresses={seedAddresses}
        onIfaceTypeChange={setIfaceType}
        onIfaceHostChange={setIfaceHost}
        onIfacePortChange={setIfacePort}
        onSerialPortChange={setSerialPort}
        onPipeCommandChange={setPipeCommand}
        onSelectedPresetChange={setSelectedPreset}
        onRnodeTransportChange={setRnodeTransport}
        onSeedAddressesChange={setSeedAddresses}
        onPickDevice={(mode, onSelect) => {
          void devicePicker.openPicker({
            mode,
            sidecarReady: sidecarApiReady,
            onSelect,
          });
        }}
        onAdd={() => {
          void handleAddInterface();
        }}
        onToggle={(id, enabled, typeName) => {
          void toggleInterface(id, enabled, typeName);
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
      <ReticulumInterfaceDevicePickerModal
        open={devicePicker.open}
        mode={devicePicker.mode}
        devices={devicePicker.devices}
        serialPorts={devicePicker.serialPorts}
        scanning={devicePicker.scanning}
        scanError={devicePicker.scanError}
        manualPath={devicePicker.manualPath}
        onManualPathChange={devicePicker.setManualPath}
        onSelect={devicePicker.selectDevice}
        onCancel={devicePicker.close}
        onRefreshSerial={() => {
          void devicePicker.refreshSerial();
        }}
        onRescanBle={devicePicker.rescanBle}
      />
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
  if (normalized === 'ble_peer' || normalized.includes('blepeer')) return 'ble_peer';
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
  seedAddresses: string;
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
  if (draft.type === 'ble_peer') {
    body.seed_addresses = draft.seedAddresses
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
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
  onPickDevice,
  onSave,
  onCancel,
}: {
  iface: ReticulumInterfaceRow;
  presets: { id: string; label: string }[];
  serialPorts: ReticulumSerialPortOption[];
  onPickDevice: (
    mode: 'serial' | 'ble-peer' | 'ble-rnode',
    onSelect: (value: string) => void,
  ) => void;
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
  const [seedAddresses, setSeedAddresses] = useState((iface.seed_addresses ?? []).join(', '));
  const editUsesBleRnode = uiType === 'rnode' && isReticulumBleRnodeSerialPort(serialPort);
  const osSerialPaths = serialPorts.map((p) => p.path);
  const serialPortStale =
    serialPort.trim().length > 0 &&
    !isReticulumBleRnodeSerialPort(serialPort) &&
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
            {editUsesBleRnode ? (
              <label className="text-xs text-gray-400">
                {t('connectionPanel.reticulumInterfaces.rnodeTransportBle')}
                <input
                  value={serialPort}
                  readOnly
                  className="mt-1 block min-w-[12rem] rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                />
              </label>
            ) : (
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
            )}
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
        {uiType === 'ble_peer' ? (
          <label className="text-xs text-gray-400">
            {t('connectionPanel.reticulumInterfaces.seedAddresses')}
            <input
              value={seedAddresses}
              onChange={(e) => {
                setSeedAddresses(e.target.value);
              }}
              className="mt-1 block min-w-[12rem] rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
            />
          </label>
        ) : null}
        {uiType === 'rnode' ||
        uiType === 'rnode_multi' ||
        uiType === 'kiss' ||
        uiType === 'ble_peer' ? (
          <button
            type="button"
            onClick={() => {
              const mode =
                uiType === 'ble_peer' ? 'ble-peer' : editUsesBleRnode ? 'ble-rnode' : 'serial';
              onPickDevice(mode, (value) => {
                if (uiType === 'ble_peer') {
                  setSeedAddresses((prev) => (prev.trim() ? `${prev},${value}` : value));
                } else {
                  setSerialPort(value);
                }
              });
            }}
            className="rounded border border-amber-600 px-2 py-1.5 text-xs text-amber-200 hover:bg-amber-950/40"
            aria-label={t('connectionPanel.reticulumInterfaces.pickDevice')}
          >
            {t('connectionPanel.reticulumInterfaces.pickDevice')}
          </button>
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
                seedAddresses,
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
  sidecarReady,
  actionsDisabled,
  ifaceType,
  ifaceHost,
  ifacePort,
  serialPort,
  pipeCommand,
  selectedPreset,
  presets,
  serialPorts,
  bleAvailable,
  rnodeTransport,
  seedAddresses,
  onIfaceTypeChange,
  onIfaceHostChange,
  onIfacePortChange,
  onSerialPortChange,
  onPipeCommandChange,
  onSelectedPresetChange,
  onRnodeTransportChange,
  onSeedAddressesChange,
  onPickDevice,
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
  sidecarReady: boolean;
  actionsDisabled: boolean;
  ifaceType: ReticulumIfaceUiType;
  ifaceHost: string;
  ifacePort: string;
  serialPort: string;
  pipeCommand: string;
  selectedPreset: string;
  presets: { id: string; label: string }[];
  serialPorts: ReticulumSerialPortOption[];
  bleAvailable: boolean;
  rnodeTransport: ReticulumRnodeTransport;
  seedAddresses: string;
  onIfaceTypeChange: (v: ReticulumIfaceUiType) => void;
  onIfaceHostChange: (v: string) => void;
  onIfacePortChange: (v: string) => void;
  onSerialPortChange: (v: string) => void;
  onPipeCommandChange: (v: string) => void;
  onSelectedPresetChange: (v: string) => void;
  onRnodeTransportChange: (v: ReticulumRnodeTransport) => void;
  onSeedAddressesChange: (v: string) => void;
  onPickDevice: (
    mode: 'serial' | 'ble-peer' | 'ble-rnode',
    onSelect: (value: string) => void,
  ) => void;
  onAdd: () => void;
  onToggle: (id: string, enabled: boolean, ifaceType: string) => void;
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
  const showBlePeer = ifaceType === 'ble_peer';
  const showRnodeBle = ifaceType === 'rnode' && rnodeTransport === 'ble';
  const needsDevicePicker = showSerial || showBlePeer || showRnodeBle;
  const pickerMode =
    ifaceType === 'ble_peer'
      ? ('ble-peer' as const)
      : showRnodeBle
        ? ('ble-rnode' as const)
        : ('serial' as const);

  const localRowReason = (iface: ReticulumInterfaceRow): string | null => {
    const health = classifyReticulumLocalInterface(iface, osSerialPortPaths);
    if (health === 'stale_port') {
      return t('connectionPanel.reticulumInterfaces.localOfflineRowStale', {
        port: iface.serial_port ?? '',
      });
    }
    if (health === 'enabled_down') {
      return reticulumLocalOfflineDisplayKind(iface) === 'ble'
        ? t('connectionPanel.reticulumInterfaces.localOfflineRowBle')
        : t('connectionPanel.reticulumInterfaces.localOfflineRow');
    }
    return null;
  };

  return (
    <details className="group bg-deep-black/40 rounded-lg border border-gray-700">
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-3 py-3 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>{t('connectionPanel.reticulumInterfaces.title')}</span>
        <DetailsChevron />
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-400">
            {t('connectionPanel.reticulumInterfaces.type')}
            <select
              value={ifaceType}
              disabled={actionsDisabled}
              onChange={(e) => {
                onIfaceTypeChange(e.target.value as ReticulumIfaceUiType);
              }}
              className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
              aria-label={t('connectionPanel.reticulumInterfaces.type')}
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="auto">Auto</option>
              <option value="rnode">RNode</option>
              <option value="rnode_multi">RNode Multi</option>
              <option value="kiss">KISS</option>
              <option value="pipe">Pipe</option>
              <option value="i2p">I2P</option>
              {bleAvailable ? (
                <option value="ble_peer">
                  {t('connectionPanel.reticulumInterfaces.blePeerType')}
                </option>
              ) : null}
            </select>
          </label>
          {ifaceType === 'rnode' ? (
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.rnodeTransport')}
              <select
                value={rnodeTransport}
                disabled={actionsDisabled}
                onChange={(e) => {
                  onRnodeTransportChange(e.target.value as ReticulumRnodeTransport);
                }}
                className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
                aria-label={t('connectionPanel.reticulumInterfaces.rnodeTransport')}
              >
                <option value="serial">
                  {t('connectionPanel.reticulumInterfaces.rnodeTransportSerial')}
                </option>
                {bleAvailable ? (
                  <option value="ble">
                    {t('connectionPanel.reticulumInterfaces.rnodeTransportBle')}
                  </option>
                ) : null}
              </select>
            </label>
          ) : null}
          {showHostPort ? (
            <>
              <label className="text-xs text-gray-400">
                {t('connectionPanel.reticulumInterfaces.host')}
                <input
                  value={ifaceHost}
                  disabled={actionsDisabled}
                  onChange={(e) => {
                    onIfaceHostChange(e.target.value);
                  }}
                  className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
                />
              </label>
              {ifaceType !== 'i2p' ? (
                <label className="text-xs text-gray-400">
                  {t('connectionPanel.reticulumInterfaces.port')}
                  <input
                    value={ifacePort}
                    disabled={actionsDisabled}
                    onChange={(e) => {
                      onIfacePortChange(e.target.value);
                    }}
                    className="mt-1 block w-20 rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
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
                disabled={actionsDisabled}
                onChange={(e) => {
                  onPipeCommandChange(e.target.value);
                }}
                className="mt-1 block min-w-[12rem] rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
              />
            </label>
          ) : null}
          {showSerial && !(ifaceType === 'rnode' && rnodeTransport === 'ble') ? (
            <>
              <label className="text-xs text-gray-400">
                {t('connectionPanel.reticulumInterfaces.serialPort')}
                {serialPorts.length > 0 ? (
                  <select
                    value={serialPort}
                    disabled={actionsDisabled}
                    onChange={(e) => {
                      onSerialPortChange(e.target.value);
                    }}
                    className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
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
                    disabled={actionsDisabled}
                    onChange={(e) => {
                      onSerialPortChange(e.target.value);
                    }}
                    className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
                  />
                )}
              </label>
              {showRnodePreset ? (
                <label className="text-xs text-gray-400">
                  {t('connectionPanel.reticulumInterfaces.preset')}
                  <select
                    value={selectedPreset}
                    disabled={actionsDisabled}
                    onChange={(e) => {
                      onSelectedPresetChange(e.target.value);
                    }}
                    className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
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
          {showBlePeer ? (
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.seedAddresses')}
              <input
                value={seedAddresses}
                disabled={actionsDisabled}
                onChange={(e) => {
                  onSeedAddressesChange(e.target.value);
                }}
                placeholder="AA:BB:CC:DD:EE:FF"
                className="mt-1 block min-w-[12rem] rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
              />
            </label>
          ) : null}
          {showRnodeBle ? (
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.rnodeTransportBle')}
              <input
                value={serialPort}
                readOnly
                className="mt-1 block min-w-[12rem] rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
              />
            </label>
          ) : null}
          {needsDevicePicker ? (
            <button
              type="button"
              disabled={actionsDisabled || (!sidecarReady && pickerMode !== 'serial')}
              onClick={() => {
                onPickDevice(pickerMode, (value) => {
                  if (ifaceType === 'ble_peer') {
                    onSeedAddressesChange(
                      seedAddresses.trim() ? `${seedAddresses},${value}` : value,
                    );
                    return;
                  }
                  onSerialPortChange(value);
                });
              }}
              className="rounded border border-amber-600 px-2 py-1.5 text-xs text-amber-200 hover:bg-amber-950/40 disabled:opacity-40"
              aria-label={t('connectionPanel.reticulumInterfaces.pickDevice')}
            >
              {t('connectionPanel.reticulumInterfaces.pickDevice')}
            </button>
          ) : null}
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={onAdd}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600 disabled:opacity-40"
          >
            {t('connectionPanel.reticulumInterfaces.add')}
          </button>
        </div>
        {bleAvailable && ifaceType !== 'ble_peer' ? (
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
                      disabled={actionsDisabled}
                      onClick={() => {
                        onStartEdit(iface);
                      }}
                      className="text-xs text-sky-400 hover:underline disabled:opacity-40"
                      aria-label={t('connectionPanel.reticulumInterfaces.edit', {
                        name: iface.name,
                      })}
                    >
                      {t('connectionPanel.reticulumInterfaces.edit')}
                    </button>
                    <button
                      type="button"
                      disabled={actionsDisabled}
                      onClick={() => {
                        onToggle(iface.id, !iface.enabled, iface.type);
                      }}
                      className="text-xs text-amber-400 hover:underline disabled:opacity-40"
                    >
                      {iface.enabled
                        ? t('connectionPanel.reticulumInterfaces.disable')
                        : t('connectionPanel.reticulumInterfaces.enable')}
                    </button>
                    <button
                      type="button"
                      disabled={actionsDisabled}
                      onClick={() => {
                        onDelete(iface.id, iface.name);
                      }}
                      className="text-xs text-red-400 hover:underline disabled:opacity-40"
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
            onPickDevice={onPickDevice}
            onSave={(patch) => {
              onSaveEdit(editingInterface.id, patch);
            }}
            onCancel={onCancelEdit}
          />
        ) : null}
      </div>
    </details>
  );
}
