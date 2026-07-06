/* eslint-disable react-hooks/set-state-in-effect */
import { Info } from 'lucide-react-motion';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { useReticulumInterfaceDevicePicker } from '@/renderer/hooks/useReticulumInterfaceDevicePicker';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { restartReticulumStack } from '@/renderer/lib/reticulum/restartReticulumStack';
import {
  fetchReticulumConfigAudit,
  repairReticulumConfig,
  type ReticulumConfigAuditIssue,
  type ReticulumConfigRepairKind,
} from '@/renderer/lib/reticulum/reticulumConfigAudit';
import {
  buildDefaultHubAddRequest,
  listMissingDefaultHubPresets,
  RETICULUM_DEFAULT_HUB_PRESETS,
} from '@/renderer/lib/reticulum/reticulumDefaultHubPresets';
import { humanizeReticulumInterfaceApiError } from '@/renderer/lib/reticulum/reticulumInterfaceApiError';
import { getReticulumInterfaceHelp } from '@/renderer/lib/reticulum/reticulumInterfaceHelp';
import {
  formatReticulumInterfaceRowSummary,
  RETICULUM_IFACE_TYPE_LABELS,
} from '@/renderer/lib/reticulum/reticulumInterfaceLabels';
import { reticulumInterfaceChangeRequiresStackRestart } from '@/renderer/lib/reticulum/reticulumInterfaceStackRestart';
import {
  classifyReticulumLocalInterface,
  isReticulumBleRnodeSerialPort,
  reticulumLocalInterfaceTextClass,
  reticulumLocalOfflineDisplayKind,
} from '@/renderer/lib/reticulum/reticulumLocalInterfaceHealth';
import { setReticulumPrimaryLocalSerialInterface } from '@/renderer/lib/reticulum/reticulumLocalRnodePrimary';
import {
  buildReticulumRnodeTcpPort,
  isReticulumTcpRnodeSerialPort,
  parseReticulumRnodeTcpPort,
  type ReticulumRnodeTransportKind,
  RNODE_DEFAULT_TCP_PORT,
} from '@/renderer/lib/reticulum/reticulumRnodeTransport';
import type {
  ReticulumInterfaceRow,
  ReticulumSerialPortOption,
} from '@/renderer/lib/reticulum/useReticulumInterfaceSnapshot';
import { useReticulumUiStore } from '@/renderer/stores/reticulumUiStore';
import {
  formatConnectHostLiteral,
  isValidConnectHost,
  stripConnectHostBrackets,
} from '@/shared/connectHost';
import {
  countEnabledLocallyConnectedSerialInterfaces,
  isReticulumLocallyConnectedSerialInterface,
} from '@/shared/reticulumLocalRnodePrimary';
import { forceApplyReticulumRnodePresetDefaults } from '@/shared/reticulumRnodeRfProfiles';
import { clampTcpPort } from '@/shared/tcpPort';

import { ConfirmModal } from '../ConfirmModal';
import { HelpTooltip } from '../HelpTooltip';
import { ReticulumInterfaceDevicePickerModal } from './ReticulumInterfaceDevicePickerModal';
import {
  hzToKhzFieldValue,
  hzToMhzFieldValue,
  parseKhzFieldToHz,
  parseMhzFieldToHz,
  type RnodeRfFieldValues,
  RnodeRfParamFields,
} from './RnodeRfParamFields';

type ReticulumRnodeTransport = ReticulumRnodeTransportKind;

interface ReticulumRnodePreset {
  id: string;
  label: string;
}

interface ReticulumRnodePresetGroups {
  flat: ReticulumRnodePreset[];
  coordinated: ReticulumRnodePreset[];
  fallback: ReticulumRnodePreset[];
  legacy: ReticulumRnodePreset[];
}

function parseRnodePresetWire(body: unknown): ReticulumRnodePresetGroups {
  const wire = body as {
    presets?: ReticulumRnodePreset[];
    coordinated?: ReticulumRnodePreset[];
    fallback?: ReticulumRnodePreset[];
    legacy?: ReticulumRnodePreset[];
  };
  const coordinated = wire.coordinated ?? [];
  const fallback = wire.fallback ?? [];
  const legacy = wire.legacy ?? [];
  const flat = wire.presets ?? [...coordinated, ...fallback, ...legacy];
  return { flat, coordinated, fallback, legacy };
}

const RETICULUM_TCP_CLIENT_DEFAULT_PORT = 4242;

function normalizeReticulumConnectHost(host: string): string {
  return formatConnectHostLiteral(stripConnectHostBrackets(host.trim()));
}

function reticulumConnectHostIsInvalid(host: string): boolean {
  const trimmed = host.trim();
  return trimmed.length === 0 || !isValidConnectHost(trimmed);
}

type ReticulumIfaceUiType =
  'tcp' | 'auto' | 'rnode' | 'udp' | 'kiss' | 'pipe' | 'i2p' | 'rnode_multi' | 'ble_peer';

export interface ReticulumInterfacesPanelProps {
  sidecarApiReady: boolean;
  connecting: boolean;
  identityConfigured?: boolean;
  interfaces: ReticulumInterfaceRow[];
  serialPorts: ReticulumSerialPortOption[];
  serialPortPaths: string[];
  effectivePrimaryLocalSerialInterfaceId: string | null;
  onRefresh: () => Promise<unknown>;
  onBeginBleConnectGrace: () => void;
}

/** Connection tab: Reticulum interface list, add/edit/delete, device picker. */
export function ReticulumInterfacesPanel({
  sidecarApiReady,
  connecting,
  identityConfigured = true,
  interfaces,
  serialPorts,
  serialPortPaths,
  effectivePrimaryLocalSerialInterfaceId,
  onRefresh,
  onBeginBleConnectGrace,
}: ReticulumInterfacesPanelProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [ifaceType, setIfaceType] = useState<ReticulumIfaceUiType>('tcp');
  const [ifaceHost, setIfaceHost] = useState('');
  const [ifacePort, setIfacePort] = useState('4242');
  const [serialPort, setSerialPort] = useState('');
  const [pipeCommand, setPipeCommand] = useState('');
  const [presets, setPresets] = useState<ReticulumRnodePresetGroups>({
    flat: [],
    coordinated: [],
    fallback: [],
    legacy: [],
  });
  const [selectedPreset, setSelectedPreset] = useState('');
  const [auditByInterfaceId, setAuditByInterfaceId] = useState<
    Map<string, ReticulumConfigAuditIssue[]>
  >(() => new Map());
  const pendingInterfaceEditId = useReticulumUiStore((s) => s.pendingInterfaceEditId);
  const clearPendingInterfaceEdit = useReticulumUiStore((s) => s.clearPendingInterfaceEdit);
  const [bleAvailable, setBleAvailable] = useState(false);
  const [rnodeTransport, setRnodeTransport] = useState<ReticulumRnodeTransport>('serial');
  const [rnodeWifiHost, setRnodeWifiHost] = useState('');
  const [rnodeWifiPort, setRnodeWifiPort] = useState(String(RNODE_DEFAULT_TCP_PORT));
  const [seedAddresses, setSeedAddresses] = useState('');
  const devicePicker = useReticulumInterfaceDevicePicker();
  const [interfaceError, setInterfaceError] = useState<string | null>(null);
  const [pendingDeleteInterface, setPendingDeleteInterface] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [editingInterface, setEditingInterface] = useState<ReticulumInterfaceRow | null>(null);
  const [restartStackHint, setRestartStackHint] = useState(false);
  const [addingDefaultHubs, setAddingDefaultHubs] = useState(false);

  useEffect(() => {
    if (!sidecarApiReady) {
      setBleAvailable(false);
      return;
    }
    void window.electronAPI.reticulum
      .proxyGet('/api/v1/rnode/presets')
      .then((body) => {
        setPresets(parseRnodePresetWire(body));
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

  const refreshAuditIssues = useCallback(async () => {
    if (!sidecarApiReady) {
      setAuditByInterfaceId(new Map());
      return;
    }
    try {
      const issues = await fetchReticulumConfigAudit();
      const map = new Map<string, ReticulumConfigAuditIssue[]>();
      for (const issue of issues) {
        if (!issue.interface_id) continue;
        const list = map.get(issue.interface_id) ?? [];
        list.push(issue);
        map.set(issue.interface_id, list);
      }
      setAuditByInterfaceId(map);
    } catch {
      // catch-no-log-ok audit is optional UI enrichment on Connection tab
    }
  }, [sidecarApiReady]);

  useEffect(() => {
    void refreshAuditIssues();
  }, [refreshAuditIssues, interfaces]);

  useEffect(() => {
    if (!pendingInterfaceEditId) return;
    const iface = interfaces.find((row) => row.id === pendingInterfaceEditId);
    if (iface) {
      setEditingInterface(iface);
      clearPendingInterfaceEdit();
    }
  }, [pendingInterfaceEditId, interfaces, clearPendingInterfaceEdit]);

  const restartStackForInterfaceChange = useCallback(async () => {
    const result = await restartReticulumStack({
      onBeginBleConnectGrace,
      onRefresh,
      logTag: 'ReticulumInterfacesPanel',
    });
    if (result.ok && !result.restarted && result.unavailable) {
      setRestartStackHint(true);
      return;
    }
    if (!result.ok) {
      setInterfaceError(
        t('connectionPanel.reticulumInterfaces.restartStackFailed', {
          message: result.message,
        }),
      );
      setRestartStackHint(true);
      return;
    }
    setRestartStackHint(false);
  }, [onBeginBleConnectGrace, onRefresh, t]);

  const handleSetPrimaryLocalSerial = useCallback(
    async (id: string) => {
      if (!sidecarApiReady) return;
      setInterfaceError(null);
      try {
        const res = await setReticulumPrimaryLocalSerialInterface(id);
        if (!res.ok) {
          addToast(
            humanizeReticulumInterfaceApiError(
              res.error,
              t,
              'connectionPanel.reticulumInterfaces.setPrimaryFailed',
            ),
            'error',
          );
          return;
        }
        addToast(t('connectionPanel.reticulumInterfaces.setPrimarySuccess'), 'success');
        setRestartStackHint(true);
        await onRefresh();
      } catch (e) {
        // catch-no-log-ok set-primary failure surfaced via interfaceError toast area
        setInterfaceError(
          humanizeReticulumInterfaceApiError(
            errLikeToLogString(e),
            t,
            'connectionPanel.reticulumInterfaces.setPrimaryFailed',
          ),
        );
      }
    },
    [addToast, onRefresh, sidecarApiReady, t],
  );

  const runInterfaceAuditRepair = useCallback(
    async (repairKind: ReticulumConfigRepairKind) => {
      try {
        const res = await repairReticulumConfig([repairKind]);
        if (!res.ok) {
          addToast(t('connectionPanel.reticulumInterfaces.auditRepairFailed'), 'error');
          return;
        }
        if (!res.repaired?.length) {
          addToast(t('connectionPanel.reticulumInterfaces.auditRepairNoChanges'), 'warning');
          await refreshAuditIssues();
          return;
        }
        addToast(t('connectionPanel.reticulumInterfaces.auditRepairSuccess'), 'success');
        if (res.restart_required) {
          await restartStackForInterfaceChange();
        }
        await onRefresh();
        await refreshAuditIssues();
      } catch (e) {
        addToast(t('connectionPanel.reticulumInterfaces.auditRepairFailed'), 'error');
        console.debug('[ReticulumInterfacesPanel] audit repair', e);
      }
    },
    [onRefresh, refreshAuditIssues, restartStackForInterfaceChange, t, addToast],
  );

  const handleAddInterface = async () => {
    setInterfaceError(null);
    try {
      const body: Record<string, unknown> = { type: ifaceType };
      if (ifaceType === 'tcp' || ifaceType === 'udp' || ifaceType === 'i2p') {
        if (ifaceType === 'tcp' || ifaceType === 'udp') {
          if (reticulumConnectHostIsInvalid(ifaceHost)) {
            setInterfaceError(t('connectionPanel.reticulumInterfaces.invalidHost'));
            return;
          }
          body.host = normalizeReticulumConnectHost(ifaceHost);
        } else {
          body.host = ifaceHost.trim();
        }
        if (ifaceType !== 'i2p') {
          body.port = clampTcpPort(ifacePort, RETICULUM_TCP_CLIENT_DEFAULT_PORT);
        }
      }
      if (ifaceType === 'rnode' || ifaceType === 'rnode_multi' || ifaceType === 'kiss') {
        if (ifaceType === 'rnode' && rnodeTransport === 'wifi') {
          if (reticulumConnectHostIsInvalid(rnodeWifiHost)) {
            setInterfaceError(t('connectionPanel.reticulumInterfaces.invalidHost'));
            return;
          }
          body.serial_port = buildReticulumRnodeTcpPort(
            rnodeWifiHost,
            clampTcpPort(rnodeWifiPort, RNODE_DEFAULT_TCP_PORT),
          );
        } else {
          body.serial_port = serialPort.trim();
        }
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
        setInterfaceError(
          humanizeReticulumInterfaceApiError(
            res.error,
            t,
            'connectionPanel.reticulumInterfaces.addFailed',
          ),
        );
        return;
      }
      await onRefresh();
      if (reticulumInterfaceChangeRequiresStackRestart(ifaceType)) {
        await restartStackForInterfaceChange();
      }
    } catch (e) {
      // catch-no-log-ok: interface add failure shown via interfaceError
      setInterfaceError(
        humanizeReticulumInterfaceApiError(
          errLikeToLogString(e),
          t,
          'connectionPanel.reticulumInterfaces.addFailed',
        ),
      );
    }
  };

  const handleAddDefaultHubPresets = async () => {
    setInterfaceError(null);
    const missing = listMissingDefaultHubPresets(interfaces);
    const skipped = RETICULUM_DEFAULT_HUB_PRESETS.length - missing.length;
    if (missing.length === 0) {
      addToast(t('connectionPanel.reticulumInterfaces.addDefaultHubsAllPresent'), 'info');
      return;
    }
    setAddingDefaultHubs(true);
    let added = 0;
    try {
      for (const preset of missing) {
        const res = (await window.electronAPI.reticulum.proxyPost(
          '/api/v1/interfaces',
          buildDefaultHubAddRequest(preset),
        )) as { ok?: boolean; error?: string };
        if (res?.ok === false) {
          setInterfaceError(
            humanizeReticulumInterfaceApiError(
              res.error,
              t,
              'connectionPanel.reticulumInterfaces.addDefaultHubsFailed',
            ),
          );
          console.debug('[ReticulumInterfacesPanel] add default hub failed', preset.id, res.error);
          break;
        }
        added += 1;
      }
      if (added > 0) {
        await onRefresh();
        setRestartStackHint(true);
        if (added === missing.length) {
          addToast(
            t('connectionPanel.reticulumInterfaces.addDefaultHubsSuccess', { added, skipped }),
            'success',
          );
        }
      }
    } catch (e) {
      setInterfaceError(
        humanizeReticulumInterfaceApiError(
          errLikeToLogString(e),
          t,
          'connectionPanel.reticulumInterfaces.addDefaultHubsFailed',
        ),
      );
      console.debug('[ReticulumInterfacesPanel] add default hubs', e);
    } finally {
      setAddingDefaultHubs(false);
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
        setInterfaceError(
          humanizeReticulumInterfaceApiError(
            res.error,
            t,
            'connectionPanel.reticulumInterfaces.toggleFailed',
          ),
        );
        return;
      }
      await onRefresh();
      if (enabled && ifaceTypeName && reticulumInterfaceChangeRequiresStackRestart(ifaceTypeName)) {
        await restartStackForInterfaceChange();
      }
    } catch (e) {
      // catch-no-log-ok: interface toggle failure shown via interfaceError
      setInterfaceError(
        humanizeReticulumInterfaceApiError(
          errLikeToLogString(e),
          t,
          'connectionPanel.reticulumInterfaces.toggleFailed',
        ),
      );
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
        setInterfaceError(
          humanizeReticulumInterfaceApiError(
            res.error,
            t,
            'connectionPanel.reticulumInterfaces.deleteFailed',
          ),
        );
        return;
      }
      setPendingDeleteInterface(null);
      if (editingInterface?.id === id) {
        setEditingInterface(null);
      }
      await onRefresh();
      await restartStackForInterfaceChange();
    } catch (e) {
      // catch-no-log-ok: delete failure shown via interfaceError
      setInterfaceError(
        humanizeReticulumInterfaceApiError(
          errLikeToLogString(e),
          t,
          'connectionPanel.reticulumInterfaces.deleteFailed',
        ),
      );
    }
  };

  const saveEditInterface = async (id: string, patch: Record<string, unknown>) => {
    setInterfaceError(null);
    const patchType = typeof patch.type === 'string' ? patch.type : '';
    const patchHost = typeof patch.host === 'string' ? patch.host : '';
    const patchSerialPort = typeof patch.serial_port === 'string' ? patch.serial_port : '';
    if (patchType === 'tcp' || patchType === 'udp') {
      if (reticulumConnectHostIsInvalid(patchHost)) {
        setInterfaceError(t('connectionPanel.reticulumInterfaces.invalidHost'));
        return;
      }
    } else if (patchType === 'rnode' && isReticulumTcpRnodeSerialPort(patchSerialPort)) {
      const parsed = parseReticulumRnodeTcpPort(patchSerialPort);
      if (!parsed || reticulumConnectHostIsInvalid(parsed.host)) {
        setInterfaceError(t('connectionPanel.reticulumInterfaces.invalidHost'));
        return;
      }
    }
    try {
      const res = (await window.electronAPI.reticulum.proxyPut(
        `/api/v1/interfaces/${id}`,
        patch,
      )) as { ok?: boolean; error?: string };
      if (res?.ok === false) {
        setInterfaceError(
          humanizeReticulumInterfaceApiError(
            res.error,
            t,
            'connectionPanel.reticulumInterfaces.editFailed',
          ),
        );
        return;
      }
      setEditingInterface(null);
      await onRefresh();
      if (reticulumInterfaceChangeRequiresStackRestart(undefined, patch)) {
        await restartStackForInterfaceChange();
      }
    } catch (e) {
      // catch-no-log-ok: edit failure shown via interfaceError
      setInterfaceError(
        humanizeReticulumInterfaceApiError(
          errLikeToLogString(e),
          t,
          'connectionPanel.reticulumInterfaces.editFailed',
        ),
      );
    }
  };

  const actionsDisabled = !sidecarApiReady || connecting || !identityConfigured;
  const defaultHubsDisabled = actionsDisabled || addingDefaultHubs;

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
        effectivePrimaryLocalSerialInterfaceId={effectivePrimaryLocalSerialInterfaceId}
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
        rnodeWifiHost={rnodeWifiHost}
        rnodeWifiPort={rnodeWifiPort}
        seedAddresses={seedAddresses}
        onIfaceTypeChange={setIfaceType}
        onIfaceHostChange={setIfaceHost}
        onIfacePortChange={setIfacePort}
        onSerialPortChange={setSerialPort}
        onPipeCommandChange={setPipeCommand}
        onSelectedPresetChange={setSelectedPreset}
        onRnodeTransportChange={setRnodeTransport}
        onRnodeWifiHostChange={setRnodeWifiHost}
        onRnodeWifiPortChange={setRnodeWifiPort}
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
        auditByInterfaceId={auditByInterfaceId}
        onAuditRepair={(kind) => {
          void runInterfaceAuditRepair(kind);
        }}
        onAuditDisable={async (id) => {
          await toggleInterface(id, false);
          await refreshAuditIssues();
        }}
        onSetPrimaryLocalSerial={(id) => {
          void handleSetPrimaryLocalSerial(id);
        }}
        identityConfigured={identityConfigured}
        addingDefaultHubs={addingDefaultHubs}
        defaultHubsDisabled={defaultHubsDisabled}
        onAddDefaultHubs={() => {
          void handleAddDefaultHubPresets();
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
  rf: RnodeRfFieldValues;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { name: draft.name.trim(), type: draft.type };
  if (draft.type === 'tcp' || draft.type === 'udp' || draft.type === 'i2p') {
    if (draft.type === 'tcp' || draft.type === 'udp') {
      body.host = normalizeReticulumConnectHost(draft.host);
    } else {
      body.host = draft.host.trim();
    }
    if (draft.type !== 'i2p') {
      body.port = clampTcpPort(draft.port, RETICULUM_TCP_CLIENT_DEFAULT_PORT);
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
    const frequency = parseMhzFieldToHz(draft.rf.frequencyMhz);
    const bandwidth = parseKhzFieldToHz(draft.rf.bandwidthKhz);
    const spreadingFactor = Number.parseInt(draft.rf.spreadingFactor, 10);
    const codingRate = Number.parseInt(draft.rf.codingRate, 10);
    const txpower = Number.parseInt(draft.rf.txpower, 10);
    if (frequency != null) body.frequency = frequency;
    if (bandwidth != null) body.bandwidth = bandwidth;
    if (Number.isFinite(spreadingFactor)) body.spreading_factor = spreadingFactor;
    if (Number.isFinite(codingRate)) body.coding_rate = codingRate;
    if (Number.isFinite(txpower)) body.txpower = txpower;
  }
  if (draft.type === 'pipe') {
    body.command = draft.pipeCommand.trim() || null;
  }
  return body;
}

function rfFieldsFromInterface(iface: ReticulumInterfaceRow): RnodeRfFieldValues {
  return {
    frequencyMhz: hzToMhzFieldValue(iface.frequency),
    bandwidthKhz: hzToKhzFieldValue(iface.bandwidth),
    spreadingFactor: iface.spreading_factor != null ? String(iface.spreading_factor) : '',
    codingRate: iface.coding_rate != null ? String(iface.coding_rate) : '5',
    txpower: iface.txpower != null ? String(iface.txpower) : '17',
  };
}

function RnodePresetSelect({
  value,
  onChange,
  presets,
  disabled,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  presets: ReticulumRnodePresetGroups;
  disabled?: boolean;
  className?: string;
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  const grouped = presets.coordinated.length > 0;
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className={className}
      aria-label={ariaLabel}
    >
      <option value="">{t('common.emDash')}</option>
      {grouped ? (
        <>
          <optgroup label={t('connectionPanel.reticulumInterfaces.rfProfile.coordinated')}>
            {presets.coordinated.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('connectionPanel.reticulumInterfaces.rfProfile.fallback')}>
            {presets.fallback.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('connectionPanel.reticulumInterfaces.rfProfile.legacy')}>
            {presets.legacy.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
        </>
      ) : (
        presets.flat.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))
      )}
    </select>
  );
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
  presets: ReticulumRnodePresetGroups;
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
  const parsedTcp = parseReticulumRnodeTcpPort(iface.serial_port ?? '');
  const [wifiHost, setWifiHost] = useState(parsedTcp?.host ?? '');
  const [wifiPort, setWifiPort] = useState(
    parsedTcp ? String(parsedTcp.port) : String(RNODE_DEFAULT_TCP_PORT),
  );
  const [preset, setPreset] = useState(iface.preset ?? '');
  const [callsign, setCallsign] = useState(iface.callsign ?? '');
  const [rfFields, setRfFields] = useState<RnodeRfFieldValues>(() => rfFieldsFromInterface(iface));
  const [seedAddresses, setSeedAddresses] = useState((iface.seed_addresses ?? []).join(', '));
  const editUsesBleRnode = uiType === 'rnode' && isReticulumBleRnodeSerialPort(serialPort);
  const editUsesWifiRnode = uiType === 'rnode' && isReticulumTcpRnodeSerialPort(serialPort);
  const osSerialPaths = serialPorts.map((p) => p.path);
  const serialPortStale =
    serialPort.trim().length > 0 &&
    !isReticulumBleRnodeSerialPort(serialPort) &&
    !isReticulumTcpRnodeSerialPort(serialPort) &&
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
            ) : editUsesWifiRnode ? (
              <>
                <label className="text-xs text-gray-400">
                  {t('connectionPanel.reticulumInterfaces.rnodeWifiHost')}
                  <input
                    value={wifiHost}
                    onChange={(e) => {
                      setWifiHost(e.target.value);
                    }}
                    className="mt-1 block min-w-[10rem] rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                    aria-label={t('connectionPanel.reticulumInterfaces.rnodeWifiHost')}
                  />
                </label>
                <label className="text-xs text-gray-400">
                  {t('connectionPanel.reticulumInterfaces.rnodeWifiPort')}
                  <input
                    value={wifiPort}
                    onChange={(e) => {
                      setWifiPort(e.target.value);
                    }}
                    className="mt-1 block w-20 rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                    aria-label={t('connectionPanel.reticulumInterfaces.rnodeWifiPort')}
                  />
                </label>
              </>
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
                    <option value="">{t('common.emDash')}</option>
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
              <RnodePresetSelect
                value={preset}
                onChange={(value) => {
                  setPreset(value);
                  if (!value) return;
                  const defaults = forceApplyReticulumRnodePresetDefaults(value);
                  if (!defaults) return;
                  setRfFields({
                    frequencyMhz: hzToMhzFieldValue(defaults.frequency),
                    bandwidthKhz: hzToKhzFieldValue(defaults.bandwidth),
                    spreadingFactor: String(defaults.spreading_factor),
                    codingRate: String(defaults.coding_rate),
                    txpower: String(defaults.txpower),
                  });
                }}
                presets={presets}
                className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm"
                ariaLabel={t('connectionPanel.reticulumInterfaces.preset')}
              />
            </label>
            <RnodeRfParamFields
              idPrefix={`edit-${iface.id}`}
              values={rfFields}
              onChange={(patch) => {
                setRfFields((prev) => ({ ...prev, ...patch }));
              }}
            />
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
              placeholder={t('connectionPanel.reticulumInterfaces.seedAddressesPlaceholder')}
              aria-label={t('connectionPanel.reticulumInterfaces.seedAddresses')}
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
            disabled={editUsesWifiRnode}
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
            className="rounded border border-amber-600 px-2 py-1.5 text-xs text-amber-200 hover:bg-amber-950/40 disabled:opacity-40"
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
            const resolvedSerialPort = editUsesWifiRnode
              ? buildReticulumRnodeTcpPort(wifiHost, clampTcpPort(wifiPort, RNODE_DEFAULT_TCP_PORT))
              : serialPort;
            onSave(
              buildInterfaceEditPatch({
                name,
                type: uiType,
                host,
                port,
                serialPort: resolvedSerialPort,
                preset,
                callsign,
                pipeCommand: '',
                seedAddresses,
                rf: rfFields,
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
  effectivePrimaryLocalSerialInterfaceId,
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
  rnodeWifiHost,
  rnodeWifiPort,
  seedAddresses,
  onIfaceTypeChange,
  onIfaceHostChange,
  onIfacePortChange,
  onSerialPortChange,
  onPipeCommandChange,
  onSelectedPresetChange,
  onRnodeTransportChange,
  onRnodeWifiHostChange,
  onRnodeWifiPortChange,
  onSeedAddressesChange,
  onPickDevice,
  onAdd,
  onToggle,
  onDelete,
  editingInterface,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  auditByInterfaceId,
  onAuditRepair,
  onAuditDisable,
  onSetPrimaryLocalSerial,
  identityConfigured,
  addingDefaultHubs,
  defaultHubsDisabled,
  onAddDefaultHubs,
}: {
  interfaces: ReticulumInterfaceRow[];
  osSerialPortPaths: string[];
  effectivePrimaryLocalSerialInterfaceId: string | null;
  sidecarReady: boolean;
  actionsDisabled: boolean;
  ifaceType: ReticulumIfaceUiType;
  ifaceHost: string;
  ifacePort: string;
  serialPort: string;
  pipeCommand: string;
  selectedPreset: string;
  presets: ReticulumRnodePresetGroups;
  serialPorts: ReticulumSerialPortOption[];
  bleAvailable: boolean;
  rnodeTransport: ReticulumRnodeTransport;
  rnodeWifiHost: string;
  rnodeWifiPort: string;
  seedAddresses: string;
  onIfaceTypeChange: (v: ReticulumIfaceUiType) => void;
  onIfaceHostChange: (v: string) => void;
  onIfacePortChange: (v: string) => void;
  onSerialPortChange: (v: string) => void;
  onPipeCommandChange: (v: string) => void;
  onSelectedPresetChange: (v: string) => void;
  onRnodeTransportChange: (v: ReticulumRnodeTransport) => void;
  onRnodeWifiHostChange: (v: string) => void;
  onRnodeWifiPortChange: (v: string) => void;
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
  auditByInterfaceId: Map<string, ReticulumConfigAuditIssue[]>;
  onAuditRepair: (kind: ReticulumConfigRepairKind) => void;
  onAuditDisable: (id: string) => Promise<void>;
  onSetPrimaryLocalSerial: (id: string) => void;
  identityConfigured: boolean;
  addingDefaultHubs: boolean;
  defaultHubsDisabled: boolean;
  onAddDefaultHubs: () => void;
}) {
  const { t } = useTranslation();
  const purposeIconTrigger = useIconTrigger();
  const enabledLocalSerialCount = countEnabledLocallyConnectedSerialInterfaces(interfaces);
  const showPrimaryControls = enabledLocalSerialCount >= 2;
  const primaryInterfaceName =
    interfaces.find((row) => row.id === effectivePrimaryLocalSerialInterfaceId)?.name ?? '';
  const showHostPort = ifaceType === 'tcp' || ifaceType === 'udp' || ifaceType === 'i2p';
  const showSerial = ifaceType === 'rnode' || ifaceType === 'rnode_multi' || ifaceType === 'kiss';
  const showRnodePreset = ifaceType === 'rnode' || ifaceType === 'rnode_multi';
  const showBlePeer = ifaceType === 'ble_peer';
  const showRnodeBle = ifaceType === 'rnode' && rnodeTransport === 'ble';
  const showRnodeWifi = ifaceType === 'rnode' && rnodeTransport === 'wifi';
  const needsDevicePicker =
    (showSerial && !showRnodeBle && !showRnodeWifi) || showBlePeer || showRnodeBle;
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
      const kind = reticulumLocalOfflineDisplayKind(iface);
      if (kind === 'ble') {
        return t('connectionPanel.reticulumInterfaces.localOfflineRowBle');
      }
      if (kind === 'wifi') {
        return t('connectionPanel.reticulumInterfaces.localOfflineRowWifi');
      }
      return t('connectionPanel.reticulumInterfaces.localOfflineRow');
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
        <div className="space-y-1">
          <p id="reticulum-default-hubs" className="text-muted text-xs">
            {t('connectionPanel.reticulumInterfaces.defaultHubsLabel')}
          </p>
          {!identityConfigured ? (
            <p className="text-xs text-amber-300" role="status">
              {t('connectionPanel.reticulumInterfaces.identityRequiredHint')}
            </p>
          ) : null}
          <button
            type="button"
            disabled={defaultHubsDisabled}
            onClick={onAddDefaultHubs}
            className="rounded border border-amber-600/70 bg-amber-950/20 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-950/40 disabled:opacity-40"
            aria-label={t('connectionPanel.reticulumInterfaces.addDefaultHubsAria')}
          >
            {addingDefaultHubs
              ? t('common.loading')
              : t('connectionPanel.reticulumInterfaces.addDefaultHubs')}
          </button>
        </div>
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
              <option value="tcp">{RETICULUM_IFACE_TYPE_LABELS.tcp}</option>
              <option value="udp">{RETICULUM_IFACE_TYPE_LABELS.udp}</option>
              <option value="auto">{RETICULUM_IFACE_TYPE_LABELS.auto}</option>
              <option value="rnode">{RETICULUM_IFACE_TYPE_LABELS.rnode}</option>
              <option value="rnode_multi">{RETICULUM_IFACE_TYPE_LABELS.rnode_multi}</option>
              <option value="kiss">{RETICULUM_IFACE_TYPE_LABELS.kiss}</option>
              <option value="pipe">{RETICULUM_IFACE_TYPE_LABELS.pipe}</option>
              <option value="i2p">{RETICULUM_IFACE_TYPE_LABELS.i2p}</option>
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
                <option value="wifi">
                  {t('connectionPanel.reticulumInterfaces.rnodeTransportWifi')}
                </option>
              </select>
            </label>
          ) : null}
          {showRnodeWifi ? (
            <>
              <label className="text-xs text-gray-400">
                {t('connectionPanel.reticulumInterfaces.rnodeWifiHost')}
                <input
                  value={rnodeWifiHost}
                  disabled={actionsDisabled}
                  onChange={(e) => {
                    onRnodeWifiHostChange(e.target.value);
                  }}
                  placeholder={t('connectionPanel.reticulumInterfaces.rnodeWifiHostPlaceholder')}
                  className="mt-1 block min-w-[10rem] rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
                  aria-label={t('connectionPanel.reticulumInterfaces.rnodeWifiHost')}
                />
              </label>
              <label className="text-xs text-gray-400">
                {t('connectionPanel.reticulumInterfaces.rnodeWifiPort')}
                <input
                  value={rnodeWifiPort}
                  disabled={actionsDisabled}
                  onChange={(e) => {
                    onRnodeWifiPortChange(e.target.value);
                  }}
                  className="mt-1 block w-20 rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
                  aria-label={t('connectionPanel.reticulumInterfaces.rnodeWifiPort')}
                />
              </label>
            </>
          ) : null}
          {ifaceType === 'rnode' && rnodeTransport === 'wifi' ? (
            <details className="w-full text-xs text-gray-400">
              <summary className="cursor-pointer text-amber-200/90">
                {t('connectionPanel.reticulumInterfaces.rnodeWifiSetupTitle')}
              </summary>
              <p className="mt-2 text-[11px] leading-relaxed whitespace-pre-line text-gray-400">
                {t('connectionPanel.reticulumInterfaces.rnodeWifiSetupHint')}
              </p>
            </details>
          ) : null}
          {showRnodePreset && showRnodeWifi ? (
            <label className="text-xs text-gray-400">
              {t('connectionPanel.reticulumInterfaces.preset')}
              <RnodePresetSelect
                value={selectedPreset}
                onChange={onSelectedPresetChange}
                presets={presets}
                disabled={actionsDisabled}
                className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
                ariaLabel={t('connectionPanel.reticulumInterfaces.preset')}
              />
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
          {showSerial &&
          !(ifaceType === 'rnode' && (rnodeTransport === 'ble' || rnodeTransport === 'wifi')) ? (
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
                    <option value="">{t('common.emDash')}</option>
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
                  <RnodePresetSelect
                    value={selectedPreset}
                    onChange={onSelectedPresetChange}
                    presets={presets}
                    disabled={actionsDisabled}
                    className="mt-1 block rounded border border-gray-600 bg-slate-900 px-2 py-1 text-sm disabled:opacity-50"
                    ariaLabel={t('connectionPanel.reticulumInterfaces.preset')}
                  />
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
                placeholder={t('connectionPanel.reticulumInterfaces.seedAddressesPlaceholder')}
                aria-label={t('connectionPanel.reticulumInterfaces.seedAddresses')}
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
        {showPrimaryControls ? (
          <p className="text-muted mt-2 text-xs" role="status">
            {t('connectionPanel.reticulumInterfaces.primaryLocalSummary', {
              name: primaryInterfaceName,
            })}
          </p>
        ) : null}
        <ul className="mt-3 space-y-2 text-sm">
          {interfaces.length === 0 ? (
            <li className="text-muted">{t('connectionPanel.reticulumNetworkEmpty')}</li>
          ) : (
            interfaces.map((iface) => {
              const rowReason = localRowReason(iface);
              const help = getReticulumInterfaceHelp(iface);
              const auditIssues = auditByInterfaceId.get(iface.id) ?? [];
              const primaryAudit =
                auditIssues.find((issue) => issue.severity !== 'info') ?? auditIssues[0];
              const rowBorder =
                rowReason != null || primaryAudit?.severity === 'error'
                  ? 'border-red-800/60'
                  : primaryAudit?.severity === 'warning'
                    ? 'border-amber-700/50'
                    : 'border-gray-700/60';
              const repairKind = primaryAudit?.repair_kind as ReticulumConfigRepairKind | undefined;
              const isLocalSerialRow =
                iface.enabled && isReticulumLocallyConnectedSerialInterface(iface);
              const isPrimaryRow =
                showPrimaryControls &&
                effectivePrimaryLocalSerialInterfaceId != null &&
                iface.id === effectivePrimaryLocalSerialInterfaceId;
              return (
                <li
                  key={iface.id}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded border px-2 py-1.5 ${rowBorder}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span className={reticulumLocalInterfaceTextClass(iface, osSerialPortPaths)}>
                        {formatReticulumInterfaceRowSummary(t, iface)}
                      </span>
                      <HelpTooltip
                        text={t(help.purposeKey)}
                        ariaLabel={t('connectionPanel.reticulumInterfaces.purposeAria', {
                          name: iface.name,
                        })}
                        className="text-muted hover:text-gray-200"
                      >
                        <Info
                          aria-hidden
                          className="h-3.5 w-3.5"
                          trigger={purposeIconTrigger}
                          size={14}
                        />
                      </HelpTooltip>
                      {help.isRuntimeOnly ? (
                        <span className="text-muted text-[10px] tracking-wide uppercase">
                          {t('connectionPanel.reticulumInterfaces.runtimeBadge')}
                        </span>
                      ) : null}
                      {isPrimaryRow ? (
                        <span className="text-readable-green text-[10px] tracking-wide uppercase">
                          {t('connectionPanel.reticulumInterfaces.primaryLocalBadge')}
                        </span>
                      ) : null}
                    </span>
                    {rowReason ? (
                      <span className="mt-0.5 block text-xs text-red-300/90">{rowReason}</span>
                    ) : null}
                    {primaryAudit ? (
                      <span
                        className={`mt-0.5 block text-xs ${
                          primaryAudit.severity === 'error'
                            ? 'text-red-300/90'
                            : primaryAudit.severity === 'warning'
                              ? 'text-amber-300/90'
                              : 'text-blue-300/80'
                        }`}
                      >
                        {t(`diagnosticsPanel.reticulum.audit.${primaryAudit.kind}`, {
                          name: primaryAudit.interface_name ?? iface.name,
                          message: primaryAudit.message,
                        })}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    {showPrimaryControls && isLocalSerialRow && !isPrimaryRow ? (
                      <button
                        type="button"
                        disabled={actionsDisabled}
                        onClick={() => {
                          onSetPrimaryLocalSerial(iface.id);
                        }}
                        className="text-xs text-emerald-400 hover:underline disabled:opacity-40"
                        aria-label={t('connectionPanel.reticulumInterfaces.setPrimaryLocalAria', {
                          name: iface.name,
                        })}
                      >
                        {t('connectionPanel.reticulumInterfaces.setPrimaryLocal')}
                      </button>
                    ) : null}
                    {repairKind === 'repair_config' ||
                    repairKind === 'apply_preset' ||
                    repairKind === 'add_auto' ? (
                      <button
                        type="button"
                        disabled={actionsDisabled}
                        onClick={() => {
                          onAuditRepair(repairKind);
                        }}
                        className="text-xs text-sky-400 hover:underline disabled:opacity-40"
                      >
                        {t('connectionPanel.reticulumInterfaces.auditRepair')}
                      </button>
                    ) : null}
                    {repairKind === 'disable' && help.isSystemManaged ? (
                      <button
                        type="button"
                        disabled={actionsDisabled}
                        onClick={() => {
                          void onAuditDisable(iface.id);
                        }}
                        className="text-xs text-amber-400 hover:underline disabled:opacity-40"
                      >
                        {t('connectionPanel.reticulumInterfaces.auditDisable')}
                      </button>
                    ) : null}
                    {!help.isSystemManaged ? (
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
                    ) : null}
                    {!help.isSystemManaged ? (
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
                    ) : null}
                    {!help.isSystemManaged ? (
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
                    ) : null}
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
