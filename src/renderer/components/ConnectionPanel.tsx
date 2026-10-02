/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs */
import { PARENT_HOVER_ATTR, Unplug } from 'lucide-react-motion';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trans, useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { ConnectionIcon } from '@/renderer/lib/icons/connectionIcons';
import { ICON_MD } from '@/renderer/lib/icons/iconClass';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { SpinnerIcon, SpinnerIconLg } from '@/renderer/lib/icons/spinnerIcon';
import { meshcoreTargetsSharedMeshtasticBlePeripheral } from '@/renderer/lib/meshcoreDualNobleBleInit';
import { markMqttUserDisconnect } from '@/renderer/lib/mqttDisconnectIntent';
import { parseTcpAddress } from '@/renderer/lib/parseTcpAddress';
import { cancelProtocolRfAutoConnect } from '@/renderer/lib/protocolRfAutoConnectGate';
import { useRadioProvider } from '@/renderer/lib/radio/providerFactory';
import type { RfConnectAutomaticFn, RfConnectFn } from '@/renderer/lib/rfConnectionTypes';
import { isPairingRelatedError } from '@/shared/blePairingError';
import {
  clampMqttMaxRetries,
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '@/shared/meshtasticMqttReconnect';
import { mqttUsesTls } from '@/shared/mqttTls';
import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';
import { type BlePickerIdentity, resolveBlePickerIdentity } from '@/shared/normalizeBleMac';
import { clampTcpPort, parseTcpPortFromString } from '@/shared/tcpPort';

import { useActiveMeshIdentity } from '../hooks/useActiveMeshIdentity';
import { useHostLinkMeter } from '../hooks/useHostLinkMeter';
import {
  flushPendingMqttSave,
  getMqttSettingsStorageKey,
  loadProtocolMqttSettings,
  persistMqttSettingsIfChanged,
} from '../hooks/useProtocolMqttSettings';
import { shouldClearMeshcoreBleSelectionForError } from '../lib/bleConnectErrors';
import {
  cacheBleDeviceMac,
  getBleDeviceMac,
  loadBleDeviceMacCache,
} from '../lib/bleDeviceMacCache';
import { reconnectBleWithScan, startGattScanningWithRetry } from '../lib/bleReconnectHelper';
import { deviceHeaderVariant } from '../lib/connectionHeaderStatus';
import {
  humanizeBleError,
  humanizeHttpError,
  humanizeReticulumSidecarError,
  humanizeSerialError,
} from '../lib/connectionPanelErrorHumanize';
import {
  connectionPanelConnectionTypeLabel,
  connectionPanelRadioStatusLabel,
} from '../lib/connectionPanelLabels';
import {
  COLORADO_MQTT_REGION_ACK_KEY,
  meshcoreMqttNeedsColoradoRegionAck,
  runConnectionPanelStorageMigrations,
} from '../lib/connectionPanelStorageMigrations';
import type { FirmwareCheckResult } from '../lib/firmwareCheck';
import {
  BLE_SELECTION_CLEARED_EVENT,
  clearStoredBleSelection as clearStoredBleSelectionForProtocol,
} from '../lib/lastConnectionStorage';
import {
  letsMeshPresetConfigurationDeviation,
  validateLetsMeshManualCredentials,
  validateLetsMeshPresetConnect,
} from '../lib/letsMeshConnectionGuards';
import {
  generateLetsMeshAuthToken,
  LETSMESH_HOST_EU,
  LETSMESH_HOST_US,
  letsMeshMqttUsernameFromIdentity,
  MESHCORE_CA_HOST_BACKUP,
  MESHCORE_CA_HOST_PRIMARY,
  meshcoreClientKeyHexFromIdentity,
  meshcoreIdentityHasFullKeyPair,
  meshcoreIdentityHasPrivateKey,
  readMeshcoreIdentity,
  readMeshcoreIdentityAsync,
} from '../lib/letsMeshJwt';
import { translateMeshcoreUserMessage } from '../lib/meshcore/meshcoreMessageI18n';
import {
  applyMeshcoreMqttPreset,
  isDeviceSigningMeshcorePreset,
  type MeshcoreMqttPreset,
  readStoredMeshcoreMqttPreset,
  usesMeshcoreDeviceSigningMqtt,
} from '../lib/meshcoreMqttPresets';
import {
  isIataScopedMeshcoreMqtt,
  parseMeshcoreIataTopicPrefix,
  prepareMeshcoreIataMqttTopicPrefix,
} from '../lib/meshcoreMqttTopicPrefix';
import { meshcoreMqttUserFacingHint } from '../lib/meshcoreMqttUserHint';
import {
  meshtasticMqttTopicPrefixesDiverge,
  meshtasticRadioMqttRootFromModuleConfigs,
  normalizeMeshtasticMqttTopicPrefix,
} from '../lib/meshtastic/meshtasticMqttTopicPrefixOverlay';
import {
  formatChannelPskInput,
  manualChannelPsksDeclareSlotIndices,
  parseChannelPskInput,
  validateChannelPskEntries,
} from '../lib/meshtasticChannelPskInput';
import { MESHTASTIC_MQTT_SETTINGS_KEY } from '../lib/meshtasticMqttSettingsStorage';
import {
  isLiamBrokerSettings,
  isMeshtasticOfficialBrokerSettings,
  MESHTASTIC_LIAM_1883,
  MESHTASTIC_OFFICIAL_1883,
  meshtasticMqttErrorUserHint,
} from '../lib/meshtasticMqttTlsMigration';
import { tryAutoLaunchMqtt } from '../lib/mqttAutoLaunch';
import {
  applyMqttProfile,
  createMqttProfile,
  deleteMqttProfile,
  loadMqttProfiles,
  matchMqttProfile,
  type MqttProfile,
  mqttProfileApplyEffect,
  mqttProfileIdFromSelectValue,
  mqttProfileSelectValue,
  normalizeLiveTopicPrefix,
  renameMqttProfile,
  saveMqttProfiles,
} from '../lib/mqttProfiles';
import { parseStoredJson } from '../lib/parseStoredJson';
import {
  blePickerDisplayName,
  defaultPickerSort,
  nextPickerSort,
  sortPickerItems,
  useDebouncedPickerSort,
} from '../lib/pickerListSort';
import { getSerialPortNodeName } from '../lib/serialPortNodeNames';
import { LAST_SERIAL_PORT_KEY } from '../lib/serialPortSignature';
import { isWeakBleRssi } from '../lib/signal';
import type {
  ConnectionType,
  DeviceState,
  GattBleDevice,
  MeshProtocol,
  MQTTSettings,
  MQTTStatus,
  SerialPortInfo,
} from '../lib/types';
import {
  getWindowsBlePairState,
  isWindowsPinRejected,
  pairWindowsBle,
  shouldOfferWindowsRePair,
  unpairWindowsBle,
} from '../lib/windowsBlePairing';
import { useDeviceStore } from '../stores/deviceStore';
import { useTimeFormatStore } from '../stores/timeFormatStore';
import { BleWeakSignalBanner } from './BleWeakSignalBanner';
import { ConfirmModal } from './ConfirmModal';
import {
  ConnectionStatusTiles,
  type ConnectionTakSummary,
} from './connection/ConnectionStatusTiles';
import ConnectionBatteryGauge from './ConnectionBatteryGauge';
import ConnectionLinkMeter from './ConnectionLinkMeter';
import FirmwareStatusIndicator from './FirmwareStatusIndicator';
import { HelpTooltip } from './HelpTooltip';
import { MqttNetworkPresetSelect } from './MqttNetworkPresetSelect';
import { MqttProfileControls } from './MqttProfileControls';
import { PickerSortControls } from './PickerSortControls';
import type { ReticulumSetupDestination } from './reticulum/ReticulumSetupGuide';
import { ReticulumStackPanel } from './ReticulumStackPanel';
import SignalBars from './SignalBars';
import { Button } from './ui/Button';
import { CopyField } from './ui/CopyField';
import {
  CHECKBOX_CLASS,
  chipClass,
  FIELD_LABEL_CLASS,
  INPUT_CLASS,
  NOTICE_CLASS,
  TEXTAREA_CLASS,
} from './ui/formClasses';
import { LabelValue, LabelValueGrid } from './ui/LabelValue';
import { type MenuEntry, SplitButton } from './ui/Menu';
import { Panel } from './ui/Panel';
import { SegmentedControl, type SegmentedOption } from './ui/SegmentedControl';
import { Stepper } from './ui/Stepper';
import { Switch } from './ui/Switch';
// ─── Last Connection (localStorage) ───────────────────────────────
interface LastConnection {
  type: ConnectionType;
  httpAddress?: string;
  bleDeviceId?: string;
  bleDeviceName?: string;
  /** Formatted BLE MAC when known (macOS UUID deviceId + CoreBluetoothCache address). */
  bleMac?: string;
  serialPortId?: string;
}

function lastBleDeviceKey(p: MeshProtocol) {
  return `mesh-client:lastBleDevice:${p}`;
}

function lastConnectionKey(p: MeshProtocol) {
  return `mesh-client:lastConnection:${p}`;
}

function shouldShowLinuxRePairFromBleError(err: unknown, bleErrMsg: string): boolean {
  const rawMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const pairingFlag = isPairingRelatedError(err);
  const domPairingSignal =
    err instanceof DOMException && (err.name === 'SecurityError' || err.name === 'NetworkError');
  // MeshCore Linux Web Bluetooth: handshake timeout often means PIN not paired at OS level (Electron may never fire providePin).
  const meshcoreWebBtHandshakeOrTimeout =
    /MeshCore handshake timed out \(Web Bluetooth\)|opening MeshCore over Web Bluetooth|Bluetooth connected but MeshCore protocol handshake did not complete/i.test(
      bleErrMsg,
    );
  // High-confidence pairing indicators only; avoid broad "connection failed" matching.
  return (
    pairingFlag ||
    domPairingSignal ||
    meshcoreWebBtHandshakeOrTimeout ||
    /GATT Error:\s*Not supported/i.test(rawMessage) ||
    /authentication failed/i.test(rawMessage) ||
    /not be properly paired/i.test(bleErrMsg) ||
    /pairing issue/i.test(rawMessage)
  );
}

/** When Electron never shows a PIN sheet, offer manual PIN + bluetoothctl pairing after a MeshCore timeout. */
function shouldOfferMeshcoreLinuxManualPinAfterError(bleErrMsg: string): boolean {
  return /MeshCore handshake timed out \(Web Bluetooth\)|opening MeshCore over Web Bluetooth/i.test(
    bleErrMsg,
  );
}

/** Parse `bluetoothctl info <mac>` output for bond state (Linux / BlueZ). */
function parseBluetoothctlPairedState(info: string): 'yes' | 'no' | 'unknown' {
  const s = info.toLowerCase();
  if (/paired:\s*yes\b/.test(s)) return 'yes';
  if (/paired:\s*no\b/.test(s)) return 'no';
  return 'unknown';
}

const STAGE_LINUX_UNPAIRED = 'connectionPanel.stageLinuxUnpaired';

function resolveConnectionStageText(
  stage: string,
  autoConnectTarget: string | null,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  if (!stage) return '';
  if (autoConnectTarget) {
    if (
      stage === 'connectionPanel.stageConnecting' ||
      stage === 'connectionPanel.stageConnectingLast'
    ) {
      return t('connectionPanel.stageAutoConnectingBle', { deviceName: autoConnectTarget });
    }
  }
  return t(stage);
}

/** Static-key lookup for the MeshCore device-signing preset deviation banner (keeps i18n scanner happy). */
function meshcorePresetDeviationText(
  t: (key: string) => string,
  preset: MeshcoreMqttPreset,
): string {
  switch (preset) {
    case 'coloradomesh':
      return t('connectionPanel.meshcorePresetDeviation.coloradomesh');
    case 'meshmapper':
      return t('connectionPanel.meshcorePresetDeviation.meshmapper');
    case 'waev':
      return t('connectionPanel.meshcorePresetDeviation.waev');
    case 'meshatse':
      return t('connectionPanel.meshcorePresetDeviation.meshatse');
    case 'meshcoreca':
      return t('connectionPanel.meshcorePresetDeviation.meshcoreca');
    case 'eastmesh':
      return t('connectionPanel.meshcorePresetDeviation.eastmesh');
    default:
      return t('connectionPanel.meshcorePresetDeviation.letsmesh');
  }
}

/** BLE pairing PIN: 1–6 digits (bluetoothctl; MeshCore may show shorter codes). */
function normalizePairingPin(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return /^\d{1,6}$/.test(digits) ? digits : null;
}

function loadLastConnection(p: MeshProtocol): LastConnection | null {
  return parseStoredJson<LastConnection>(
    localStorage.getItem(lastConnectionKey(p)),
    'ConnectionPanel loadLastConnection',
  );
}

function saveLastConnection(p: MeshProtocol, c: LastConnection) {
  try {
    localStorage.setItem(lastConnectionKey(p), JSON.stringify(c));
  } catch (e) {
    console.debug('[ConnectionPanel] saveLastConnection ' + errLikeToLogString(e));
  }
}

function clearLastConnection(p: MeshProtocol) {
  try {
    localStorage.removeItem(lastConnectionKey(p));
  } catch (e) {
    console.debug('[ConnectionPanel] clearLastConnection ' + errLikeToLogString(e));
  }
}

function loadLastBleDevice(protocol: MeshProtocol): string | null {
  try {
    return localStorage.getItem(lastBleDeviceKey(protocol));
  } catch (e) {
    console.debug('[ConnectionPanel] loadLastBleDevice ' + errLikeToLogString(e));
    return null;
  }
}

function saveLastBleDevice(protocol: MeshProtocol, id: string) {
  try {
    localStorage.setItem(lastBleDeviceKey(protocol), id);
  } catch (e) {
    console.debug('[ConnectionPanel] saveLastBleDevice ' + errLikeToLogString(e));
  }
}

function loadLastSerialPort(): string | null {
  try {
    return localStorage.getItem(LAST_SERIAL_PORT_KEY);
  } catch (e) {
    console.debug('[ConnectionPanel] loadLastSerialPort ' + errLikeToLogString(e));
    return null;
  }
}

function saveLastSerialPort(id: string) {
  try {
    localStorage.setItem(LAST_SERIAL_PORT_KEY, id);
  } catch (e) {
    console.debug('[ConnectionPanel] saveLastSerialPort ' + errLikeToLogString(e));
  }
}

function getBleDeviceName(deviceId: string): string | null {
  const cache =
    parseStoredJson<Record<string, string>>(
      localStorage.getItem('mesh-client:bleDeviceNames'),
      'ConnectionPanel bleDeviceNames',
    ) ?? {};
  return cache[deviceId] ?? null;
}

function resolveLastBleIdentity(
  last: LastConnection | null,
  protocol: MeshProtocol,
): BlePickerIdentity | null {
  const deviceId = last?.bleDeviceId ?? loadLastBleDevice(protocol) ?? '';
  if (!deviceId && !last?.bleMac) return null;
  const identity = resolveBlePickerIdentity({
    deviceId,
    address: last?.bleMac,
    cachedMac: deviceId ? getBleDeviceMac(deviceId) : null,
  });
  return identity.display ? identity : null;
}

const LETS_MESH_USERNAME_SYNC_DEBOUNCE_MS = 100;

function loadMqttSettings(): MQTTSettings {
  return loadProtocolMqttSettings('meshtastic');
}

function loadMeshcoreMqttSettings(): MQTTSettings {
  return loadProtocolMqttSettings('meshcore');
}

interface Props {
  state: DeviceState;
  onConnect: RfConnectFn;
  onAutoConnect: RfConnectAutomaticFn;
  onDisconnect: () => Promise<void>;
  mqttStatus: MQTTStatus;
  /** The drop was unexpected; the MQTT tile then reads as an error, like the status bar. */
  mqttConnectionLoss?: boolean;
  myNodeLabel?: string;
  protocol: MeshProtocol;
  manualAddContacts?: boolean;
  onToggleManualContacts?: (manual: boolean) => Promise<void>;
  firmwareCheckState?: FirmwareCheckResult;
  onOpenFirmwareReleases?: () => void;
  /** MeshCore: export private key from connected radio when MQTT identity cache is incomplete. */
  ensureMeshcoreMqttIdentity?: () => Promise<boolean>;
  /** Reticulum: start or restart the AGPL sidecar stack. */
  onStartReticulumStack?: () => Promise<void>;
  /** Reticulum: open Network tab RMAP discovery settings. */
  onOpenReticulumRmapSettings?: () => void;
  /** Reticulum: open App tab GPS settings for RMAP coordinates. */
  onOpenAppGpsSettings?: () => void;
  /** Reticulum: open Admin Bluetooth for USB Clear paired / Start pairing. */
  onOpenAdminBluetooth?: () => void;
  onOpenReticulumSetupDestination?: (destination: ReticulumSetupDestination) => boolean;
  /** TAK server summary for the link tiles; omitted when the protocol has no TAK panel. */
  tak?: ConnectionTakSummary;
}

/** "1200D35FA9246B15…7F9F81F3F92F6B4AEE65": enough of a 64-char key to recognize it. */
function shortenClientKey(hex: string): string {
  return hex.length > 40 ? `${hex.slice(0, 16)}…${hex.slice(-20)}` : hex;
}

export default function ConnectionPanel({
  state,
  onConnect,
  onAutoConnect,
  onDisconnect,
  mqttStatus,
  mqttConnectionLoss = false,
  myNodeLabel,
  protocol,
  manualAddContacts,
  onToggleManualContacts,
  firmwareCheckState,
  onOpenFirmwareReleases,
  ensureMeshcoreMqttIdentity,
  onStartReticulumStack,
  onOpenReticulumRmapSettings,
  onOpenAppGpsSettings,
  onOpenAdminBluetooth,
  onOpenReticulumSetupDestination,
  tak,
}: Props) {
  const { t } = useTranslation();
  const capabilities = useRadioProvider(protocol);
  const parentIconTrigger = useParentIconTrigger();
  const use24HourTime = useTimeFormatStore((s) => s.use24HourTime);
  const letsMeshUsernameSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reticulumStackError, setReticulumStackError] = useState<string | null>(null);

  useEffect(() => {
    runConnectionPanelStorageMigrations();
  }, []);

  const [connectionType, setConnectionType] = useState<ConnectionType>('ble');
  const [httpAddress, setHttpAddress] = useState(() => {
    const last = loadLastConnection(protocol);
    return last?.type === 'http' && last.httpAddress ? last.httpAddress : 'meshtastic.local';
  });
  const [tcpAddress, setTcpAddress] = useState(() => {
    const last = loadLastConnection(protocol);
    return last?.type === 'tcp' && last.httpAddress ? last.httpAddress : 'meshtastic.local:4403';
  });
  const [tcpHost, setTcpHost] = useState(() => {
    const last = loadLastConnection(protocol);
    if (last?.type === 'http' && last.httpAddress && protocol === 'meshcore') {
      return parseTcpAddress(last.httpAddress).host;
    }
    return 'localhost';
  });
  const [tcpPortStr, setTcpPortStr] = useState<string>(() => {
    const last = loadLastConnection(protocol);
    if (last?.type === 'http' && last.httpAddress && protocol === 'meshcore') {
      return String(parseTcpAddress(last.httpAddress).port);
    }
    return '5000';
  });
  const tcpPort = parseTcpPortFromString(tcpPortStr, 5000);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionStage, setConnectionStage] = useState('');
  const [showRePairButton, setShowRePairButton] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [manualPairingFallback, setManualPairingFallback] = useState(false);
  const [pinInputValue, setPinInputValue] = useState('');
  const activeHostAddress =
    protocol === 'meshcore'
      ? `${tcpHost}:${tcpPort}`
      : connectionType === 'tcp' || state.connectionType === 'tcp'
        ? tcpAddress
        : httpAddress;
  const hostLinkMeter = useHostLinkMeter({
    protocol,
    connectionType: state.connectionType,
    status: state.status,
    hostAddress:
      state.connectionType === 'tcp'
        ? tcpAddress
        : state.connectionType === 'http'
          ? protocol === 'meshcore'
            ? `${tcpHost}:${tcpPort}`
            : httpAddress
          : activeHostAddress,
    platform: window.electronAPI.getPlatform() as NodeJS.Platform,
  });

  // ─── MQTT settings state ───────────────────────────────────────
  const [mqttSettings, setMqttSettings] = useState<MQTTSettings>(loadMqttSettings);
  const [meshcoreMqttSettings, setMeshcoreMqttSettings] =
    useState<MQTTSettings>(loadMeshcoreMqttSettings);
  const [showMqttPassword, setShowMqttPassword] = useState(false);
  const [mqttError, setMqttError] = useState<string | null>(null);
  const [mqttWarning, setMqttWarning] = useState<string | null>(null);
  const [channelPskWarn, setChannelPskWarn] = useState<string | null>(null);
  const [channelPskDraft, setChannelPskDraft] = useState(() =>
    formatChannelPskInput(
      (protocol === 'meshcore' ? loadMeshcoreMqttSettings() : loadMqttSettings()).channelPsks,
    ),
  );
  const mqttSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meshcoreMqttSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mqttSettingsRef = useRef(mqttSettings);
  mqttSettingsRef.current = mqttSettings;
  const meshcoreMqttSettingsRef = useRef(meshcoreMqttSettings);
  meshcoreMqttSettingsRef.current = meshcoreMqttSettings;
  const [meshcorePreset, setMeshcorePreset] = useState<MeshcoreMqttPreset>(() =>
    readStoredMeshcoreMqttPreset(),
  );
  // Bumped when a preset selection is cancelled (Ripple / Colorado confirm) so the controlled
  // <select> remounts and re-applies `meshcorePreset`, discarding the user's cancelled choice.
  const [meshcorePresetSelectNonce, setMeshcorePresetSelectNonce] = useState(0);
  const [coloradoRegionGateOpen, setColoradoRegionGateOpen] = useState(false);
  const [meshtasticPreset, setMeshtasticPreset] = useState<'official-plain' | 'liam' | 'custom'>(
    () => {
      const s = loadMqttSettings();
      if (isLiamBrokerSettings(s)) return 'liam';
      if (!isMeshtasticOfficialBrokerSettings(s)) return 'custom';
      if (s.port === 1883) return 'official-plain';
      return 'custom';
    },
  );
  const [mqttProfiles, setMqttProfiles] = useState<MqttProfile[]>(loadMqttProfiles);
  // Profile chosen while connected whose broker/credentials differ; applied once MQTT disconnects
  // so the live session's settings and matched profile stay accurate.
  const [pendingMqttProfile, setPendingMqttProfile] = useState<MqttProfile | null>(null);
  const activeMqttProfile = useMemo(
    () => matchMqttProfile(mqttProfiles, mqttSettings),
    [mqttProfiles, mqttSettings],
  );
  const updateMqttProfiles = (next: MqttProfile[]) => {
    setMqttProfiles(next);
    saveMqttProfiles(next);
  };
  // Async topic updates apply only if they are still the latest selection on a live session.
  const mqttProfileRequestRef = useRef(0);
  const mqttStatusRef = useRef(mqttStatus);
  useEffect(() => {
    mqttStatusRef.current = mqttStatus;
  }, [mqttStatus]);
  const applyMeshtasticMqttProfile = (profile: MqttProfile) => {
    // An in-flight connect already captured the current settings.
    if (mqttStatus === 'connecting') return;
    const requestId = ++mqttProfileRequestRef.current;
    const next = applyMqttProfile(mqttSettings, profile);
    const effect = mqttProfileApplyEffect(mqttSettings, next);
    if (mqttStatus === 'connected' && effect === 'reconnect') {
      setPendingMqttProfile(profile);
      return;
    }
    if (mqttStatus === 'connected' && effect === 'topicPrefix') {
      const topicPrefix = normalizeLiveTopicPrefix(next.topicPrefix);
      if (topicPrefix == null) {
        console.warn('[ConnectionPanel] MQTT profile topic prefix rejected for live session');
        return;
      }
      // Settings follow the live subscription only once main accepts the new prefix.
      void window.electronAPI.mqtt
        .updateTopicPrefix({ topicPrefix })
        .then(() => {
          if (
            requestId !== mqttProfileRequestRef.current ||
            mqttStatusRef.current !== 'connected'
          ) {
            return;
          }
          setPendingMqttProfile(null);
          setMeshtasticPreset('custom');
          setMqttSettings((prev) => ({ ...applyMqttProfile(prev, profile), topicPrefix }));
        })
        .catch((e: unknown) => {
          console.warn('[ConnectionPanel] mqtt.updateTopicPrefix failed ' + errLikeToLogString(e));
        });
      return;
    }
    setPendingMqttProfile(null);
    setMeshtasticPreset('custom');
    setMqttSettings(next);
  };

  useEffect(() => {
    if (mqttStatus !== 'disconnected' || !pendingMqttProfile) return;
    setMeshtasticPreset('custom');
    setMqttSettings((prev) => applyMqttProfile(prev, pendingMqttProfile));
    setPendingMqttProfile(null);
  }, [mqttStatus, pendingMqttProfile]);

  // Persist Meshtastic MQTT settings with debounce
  useEffect(() => {
    if (mqttSaveTimerRef.current) clearTimeout(mqttSaveTimerRef.current);
    mqttSaveTimerRef.current = setTimeout(() => {
      persistMqttSettingsIfChanged(MESHTASTIC_MQTT_SETTINGS_KEY, mqttSettingsRef.current);
      mqttSaveTimerRef.current = null;
    }, 300);
    return () => {
      if (mqttSaveTimerRef.current) {
        clearTimeout(mqttSaveTimerRef.current);
        mqttSaveTimerRef.current = null;
      }
    };
  }, [mqttSettings]);

  useEffect(() => {
    const flushMeshtasticMqtt = () => {
      flushPendingMqttSave(mqttSaveTimerRef, MESHTASTIC_MQTT_SETTINGS_KEY, mqttSettingsRef.current);
    };
    window.addEventListener('beforeunload', flushMeshtasticMqtt);
    return () => {
      window.removeEventListener('beforeunload', flushMeshtasticMqtt);
      flushPendingMqttSave(mqttSaveTimerRef, MESHTASTIC_MQTT_SETTINGS_KEY, mqttSettingsRef.current);
    };
  }, []);

  // Persist MeshCore preset selection
  useEffect(() => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', meshcorePreset);
  }, [meshcorePreset]);

  // One-time Colorado region gate for existing Colorado MQTT users (blocks auto-launch until ack)
  useEffect(() => {
    if (protocol !== 'meshcore') return;
    if (meshcoreMqttNeedsColoradoRegionAck()) {
      setColoradoRegionGateOpen(true);
    }
  }, [protocol]);

  // Persist MeshCore MQTT settings with debounce
  useEffect(() => {
    if (meshcoreMqttSaveTimerRef.current) clearTimeout(meshcoreMqttSaveTimerRef.current);
    meshcoreMqttSaveTimerRef.current = setTimeout(() => {
      persistMqttSettingsIfChanged(
        getMqttSettingsStorageKey('meshcore'),
        meshcoreMqttSettingsRef.current,
      );
      meshcoreMqttSaveTimerRef.current = null;
    }, 300);
    return () => {
      if (meshcoreMqttSaveTimerRef.current) {
        clearTimeout(meshcoreMqttSaveTimerRef.current);
        meshcoreMqttSaveTimerRef.current = null;
      }
    };
  }, [meshcoreMqttSettings]);

  useEffect(() => {
    const flushMeshcoreMqtt = () => {
      flushPendingMqttSave(
        meshcoreMqttSaveTimerRef,
        getMqttSettingsStorageKey('meshcore'),
        meshcoreMqttSettingsRef.current,
      );
    };
    window.addEventListener('beforeunload', flushMeshcoreMqtt);
    return () => {
      window.removeEventListener('beforeunload', flushMeshcoreMqtt);
      flushPendingMqttSave(
        meshcoreMqttSaveTimerRef,
        getMqttSettingsStorageKey('meshcore'),
        meshcoreMqttSettingsRef.current,
      );
    };
  }, []);

  // Listen for MQTT events from main process (dual-mode: only errors for the active protocol)
  useEffect(() => {
    return window.electronAPI.mqtt.onError(({ error, protocol: mqttProtocol }) => {
      if (mqttProtocol !== protocol) return;
      setMqttError(
        protocol === 'meshcore'
          ? translateMeshcoreUserMessage(t, meshcoreMqttUserFacingHint(error))
          : meshtasticMqttErrorUserHint(error),
      );
    });
  }, [protocol, t]);
  useEffect(() => {
    return window.electronAPI.mqtt.onWarning(({ warning, protocol: mqttProtocol }) => {
      if (mqttProtocol !== protocol) return;
      setMqttWarning(
        protocol === 'meshcore'
          ? translateMeshcoreUserMessage(t, meshcoreMqttUserFacingHint(warning))
          : warning,
      );
    });
  }, [protocol, t]);

  // Clear MQTT error on successful connect; leave it visible on disconnect so the user can read it.
  useEffect(() => {
    if (mqttStatus === 'connected') setMqttError(null);
    if (mqttStatus === 'disconnected') {
      setMqttWarning(null);
    }
    if (mqttStatus === 'connecting') setMqttWarning(null);
  }, [mqttStatus]);

  // Keep LetsMesh MQTT username in sync with imported MeshCore identity (v1_<64-hex public key>).
  useEffect(() => {
    const syncLetsMeshUsername = () => {
      if (protocol !== 'meshcore' || !isDeviceSigningMeshcorePreset(meshcorePreset)) return;
      const u = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
      if (!u) return;
      setMeshcoreMqttSettings((prev) => (prev.username === u ? prev : { ...prev, username: u }));
    };
    const scheduleSync = () => {
      if (letsMeshUsernameSyncTimerRef.current) {
        clearTimeout(letsMeshUsernameSyncTimerRef.current);
      }
      letsMeshUsernameSyncTimerRef.current = setTimeout(() => {
        letsMeshUsernameSyncTimerRef.current = null;
        syncLetsMeshUsername();
      }, LETS_MESH_USERNAME_SYNC_DEBOUNCE_MS);
    };
    syncLetsMeshUsername();
    window.addEventListener('meshclient:meshcoreIdentityUpdated', scheduleSync);
    return () => {
      window.removeEventListener('meshclient:meshcoreIdentityUpdated', scheduleSync);
      if (letsMeshUsernameSyncTimerRef.current) {
        clearTimeout(letsMeshUsernameSyncTimerRef.current);
        letsMeshUsernameSyncTimerRef.current = null;
      }
    };
  }, [protocol, meshcorePreset]);

  const [hasPrivateKey, setHasPrivateKey] = useState(() => meshcoreIdentityHasPrivateKey());
  const meshcoreClientKeyHex = hasPrivateKey
    ? (meshcoreClientKeyHexFromIdentity(readMeshcoreIdentity()) ?? '')
    : '';
  useEffect(() => {
    const sync = () => {
      setHasPrivateKey(meshcoreIdentityHasPrivateKey());
    };
    window.addEventListener('meshclient:meshcoreIdentityUpdated', sync);
    return () => {
      window.removeEventListener('meshclient:meshcoreIdentityUpdated', sync);
    };
  }, []);

  const activeMqttSettings = protocol === 'meshcore' ? meshcoreMqttSettings : mqttSettings;
  const setActiveMqttSettings = protocol === 'meshcore' ? setMeshcoreMqttSettings : setMqttSettings;
  const activeMqttTls = mqttUsesTls(activeMqttSettings);
  const { focusedIdentityId } = useActiveMeshIdentity(protocol);
  const radioModuleConfigs = useDeviceStore((s) =>
    protocol === 'meshtastic' && focusedIdentityId
      ? (s.devices[focusedIdentityId]?.moduleConfigs ?? null)
      : null,
  );
  const radioMqttRoot =
    protocol === 'meshtastic' && state.status === 'configured' && radioModuleConfigs
      ? meshtasticRadioMqttRootFromModuleConfigs(radioModuleConfigs)
      : null;
  const radioMqttRootDiverges =
    radioMqttRoot != null &&
    meshtasticMqttTopicPrefixesDiverge(activeMqttSettings.topicPrefix, radioMqttRoot);
  const showMqttOnlyChannelPskIndexHint =
    protocol === 'meshtastic' &&
    state.status !== 'configured' &&
    !manualChannelPsksDeclareSlotIndices(parseChannelPskInput(channelPskDraft));

  const updateMqtt = <K extends keyof MQTTSettings>(
    key: K,
    value: MQTTSettings[K],
    affectsPreset = true,
  ) => {
    if (affectsPreset) {
      if (protocol === 'meshcore') {
        setMeshcorePreset('custom');
      } else {
        setMeshtasticPreset('custom');
      }
    }
    setActiveMqttSettings((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'autoLaunch') {
        persistMqttSettingsIfChanged(getMqttSettingsStorageKey(protocol), next);
      }
      return next;
    });
  };

  useEffect(() => {
    setChannelPskDraft(formatChannelPskInput(activeMqttSettings.channelPsks));
  }, [protocol, activeMqttSettings.channelPsks]);

  const commitChannelPskDraft = useCallback((): string[] => {
    const lines = parseChannelPskInput(channelPskDraft);
    setActiveMqttSettings((prev) => ({
      ...prev,
      channelPsks: lines.length > 0 ? lines : undefined,
    }));
    const validation = validateChannelPskEntries(lines);
    if (validation === 'invalidLength') {
      setChannelPskWarn(t('connectionPanel.channelPsksInvalidLength'));
    } else if (validation === 'invalidBase64') {
      setChannelPskWarn(t('connectionPanel.channelPsksInvalidBase64'));
    } else {
      setChannelPskWarn(null);
    }
    return lines;
  }, [channelPskDraft, t, setActiveMqttSettings]);

  // ─── BLE device picker state ──────────────────────────────────
  const [bleDevices, setBleDevices] = useState<GattBleDevice[]>([]);
  const [showBlePicker, setShowBlePicker] = useState(false);
  const [blePickerSort, setBlePickerSort] = useState(() => defaultPickerSort('ble'));
  const bleDeviceNamesCache = useMemo(() => {
    const parsed =
      parseStoredJson<Record<string, string>>(
        localStorage.getItem('mesh-client:bleDeviceNames'),
        'ConnectionPanel bleDeviceNames list',
      ) ?? {};
    const cache: Record<string, string> = {};
    for (const device of bleDevices) {
      const cached = parsed[device.deviceId];
      if (cached) cache[device.deviceId] = cached;
    }
    return cache;
  }, [bleDevices]);
  const bleDeviceMacsCache = useMemo(() => {
    const parsed = loadBleDeviceMacCache();
    const cache: Record<string, string> = {};
    for (const device of bleDevices) {
      const cached = parsed[device.deviceId];
      if (cached) cache[device.deviceId] = cached;
    }
    return cache;
  }, [bleDevices]);
  const getBlePickerName = useCallback(
    (device: GattBleDevice) =>
      blePickerDisplayName(
        device.deviceId,
        device.deviceName,
        bleDeviceNamesCache[device.deviceId],
      ),
    [bleDeviceNamesCache],
  );
  const getBlePickerId = useCallback((device: GattBleDevice) => device.deviceId, []);
  const getBlePickerRssi = useCallback((device: GattBleDevice) => device.rssi, []);
  const sortedBleDevices = useDebouncedPickerSort(
    bleDevices,
    blePickerSort.key,
    blePickerSort.dir,
    { getName: getBlePickerName, getId: getBlePickerId, getRssi: getBlePickerRssi },
  );
  const isLinux = window.electronAPI.getPlatform() === 'linux';
  const isWindows = window.electronAPI.getPlatform() === 'win32';

  // ─── Serial port picker state ─────────────────────────────────
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [showSerialPicker, setShowSerialPicker] = useState(false);
  const [serialPickerSort, setSerialPickerSort] = useState(() => defaultPickerSort('serial'));
  const getSerialPickerName = useCallback(
    (port: SerialPortInfo) => getSerialPortNodeName(port.portId) ?? port.displayName,
    [],
  );
  const getSerialPickerId = useCallback((port: SerialPortInfo) => port.portId, []);
  const sortedSerialPorts = useMemo(
    () =>
      sortPickerItems(serialPorts, serialPickerSort.key, serialPickerSort.dir, {
        getName: getSerialPickerName,
        getId: getSerialPickerId,
      }),
    [
      getSerialPickerId,
      getSerialPickerName,
      serialPickerSort.dir,
      serialPickerSort.key,
      serialPorts,
    ],
  );

  // ─── Last connection + reconnect UI state ─────────────────────
  const [lastConnection, setLastConnection] = useState<LastConnection | null>(() =>
    loadLastConnection(protocol),
  );
  const autoConnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAutoConnectingRef = useRef(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [autoConnectBleTarget, setAutoConnectBleTarget] = useState<string | null>(null);
  // Tracks BLE device name at selection time, used when saving LastConnection
  const lastSelectedBleNameRef = useRef<string | null>(null);
  // Advertised hardware address at selection time.
  const lastSelectedBleAddressRef = useRef<string | null>(null);
  // Tracks BLE device MAC for potential re-pairing on Linux
  const lastSelectedBleMacRef = useRef<string | null>(null);
  /**
   * Linux (bluetoothctl) / Windows (WinRT in-app) pairing completes before opening the
   * sidecar GATT session.
   */
  const pendingPairBleDeviceRef = useRef<{ deviceId: string } | null>(null);
  const windowsReconnectAttemptRef = useRef<object | null>(null);
  const manualBleScanActiveRef = useRef(false);
  const lastConnectionBleDeviceNameFallbackRef = useRef(lastConnection?.bleDeviceName);
  lastConnectionBleDeviceNameFallbackRef.current = lastConnection?.bleDeviceName;
  const lastConnectionBleMacFallbackRef = useRef(lastConnection?.bleMac);
  lastConnectionBleMacFallbackRef.current = lastConnection?.bleMac;
  /** Prior store status for distinguishing pre-connect BLE scan from failed RF attempts. */
  const prevStoreStatusRef = useRef(state.status);
  /** Mount-only auto-connect reads latest props/state via refs so the effect can stay `[]`. */
  const deviceStateRef = useRef(state);
  deviceStateRef.current = state;
  const lastConnectionRef = useRef(lastConnection);
  lastConnectionRef.current = lastConnection;

  const clearMeshcoreBleSelectionOnMissingServices = useCallback(
    (err: unknown) => {
      if (protocol !== 'meshcore' || !shouldClearMeshcoreBleSelectionForError(err)) return;
      clearStoredBleSelectionForProtocol('meshcore');
      setLastConnection(null);
    },
    [protocol, setLastConnection],
  );
  const connectionTypeRef = useRef(connectionType);
  connectionTypeRef.current = connectionType;
  const onAutoConnectRef = useRef(onAutoConnect);
  onAutoConnectRef.current = onAutoConnect;

  // Reload last connection when protocol switches (each protocol has its own key)
  useEffect(() => {
    setLastConnection(loadLastConnection(protocol));
  }, [protocol]);

  useEffect(() => {
    const handleBleSelectionCleared = (event: Event) => {
      const detail = (event as CustomEvent<{ protocol: MeshProtocol }>).detail;
      if (detail?.protocol !== protocol) return;
      setLastConnection(null);
    };
    window.addEventListener(BLE_SELECTION_CLEARED_EVENT, handleBleSelectionCleared);
    return () => {
      window.removeEventListener(BLE_SELECTION_CLEARED_EVENT, handleBleSelectionCleared);
    };
  }, [protocol]);

  useEffect(() => {
    pendingPairBleDeviceRef.current = null;
    manualBleScanActiveRef.current = false;
    return () => {
      pendingPairBleDeviceRef.current = null;
      manualBleScanActiveRef.current = false;
      windowsReconnectAttemptRef.current = null;
    };
  }, [protocol]);

  // Update connection stage based on state transitions, and save last connection on success

  useEffect(() => {
    if (state.status === 'connecting') {
      if (showPinPrompt) return;
      if (showBlePicker) setConnectionStage('connectionPanel.stageSelectDevice');
      else if (showSerialPicker) setConnectionStage('connectionPanel.stageSelectSerial');
      else if (connectionType === 'ble' && isAutoConnectingRef.current) {
        setConnectionStage('connectionPanel.stageConnectingLast');
      } else setConnectionStage('connectionPanel.stagePleaseWait');
    } else if (state.status === 'connected') {
      setConnectionStage('connectionPanel.stageConfiguring');
    } else if (state.status === 'configured') {
      setConnectionStage('');
      setConnecting(false);
      isAutoConnectingRef.current = false;
      setIsAutoConnecting(false);
      setAutoConnectBleTarget(null);
      if (autoConnectTimeoutRef.current) {
        clearTimeout(autoConnectTimeoutRef.current);
        autoConnectTimeoutRef.current = null;
      }
      // Persist connection details for next startup
      if (state.connectionType) {
        const conn: LastConnection = { type: state.connectionType };
        if (state.connectionType === 'http' || state.connectionType === 'tcp') {
          conn.httpAddress = activeHostAddress;
        } else if (state.connectionType === 'ble') {
          const prev = lastConnectionRef.current;
          const bleId = loadLastBleDevice(protocol) ?? prev?.bleDeviceId;
          if (bleId) {
            conn.bleDeviceId = bleId;
            conn.bleDeviceName =
              getBleDeviceName(bleId) ??
              lastSelectedBleNameRef.current ??
              lastConnectionBleDeviceNameFallbackRef.current ??
              prev?.bleDeviceName;
            const bleIdentity = resolveBlePickerIdentity({
              deviceId: bleId,
              address: lastSelectedBleAddressRef.current,
              cachedMac: getBleDeviceMac(bleId) ?? lastConnectionBleMacFallbackRef.current,
            });
            if (bleIdentity.isMac) conn.bleMac = bleIdentity.display;
          }
        } else if (state.connectionType === 'serial') {
          const serialId = loadLastSerialPort();
          if (serialId) conn.serialPortId = serialId;
        }
        saveLastConnection(protocol, conn);
        setLastConnection(conn);
      }
    } else if (state.status === 'disconnected') {
      const prevStatus = prevStoreStatusRef.current;
      const hadRfAttempt =
        prevStatus === 'connecting' ||
        prevStatus === 'connected' ||
        prevStatus === 'configured' ||
        prevStatus === 'stale' ||
        prevStatus === 'reconnecting' ||
        state.connectionType !== null;

      if (hadRfAttempt) {
        setConnectionStage('');
        setConnecting(false);
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        if (showBlePicker || showSerialPicker) {
          setShowBlePicker(false);
          setShowSerialPicker(false);
        }
      }
    }

    prevStoreStatusRef.current = state.status;
  }, [
    state.status,
    state.connectionType,
    showBlePicker,
    showPinPrompt,
    showSerialPicker,
    httpAddress,
    activeHostAddress,
    connectionType,
    connecting,
    protocol,
  ]);

  // Listen for sidecar GATT discovery events.
  useEffect(() => {
    return window.electronAPI.onGattDeviceDiscovered((device) => {
      if (device.address) cacheBleDeviceMac(device.deviceId, device.address);
      setBleDevices((prev) => {
        const idx = prev.findIndex((d) => d.deviceId === device.deviceId);
        if (idx >= 0) {
          const existing = prev[idx];
          if (!existing) return prev;
          const nextRssi = device.rssi !== undefined ? device.rssi : existing.rssi;
          const nextAddress = device.address ?? existing.address;
          if (
            existing.deviceName === device.deviceName &&
            existing.rssi === nextRssi &&
            existing.address === nextAddress
          ) {
            return prev;
          }
          const next = [...prev];
          next[idx] = {
            ...existing,
            deviceName: device.deviceName,
            rssi: nextRssi,
            address: nextAddress,
          };
          return next;
        }
        return [...prev, device];
      });
      if (isAutoConnectingRef.current) {
        const lastId = lastConnection?.bleDeviceId ?? loadLastBleDevice(protocol);
        if (
          protocol === 'meshcore' &&
          lastId &&
          meshcoreTargetsSharedMeshtasticBlePeripheral(lastId)
        ) {
          return;
        }
        if (lastId && device.deviceId === lastId) {
          // reconnectBleWithScan + connectAutomatic already owns Noble auto-connect; a second
          // onConnect here races prepareRfConnect / Noble IPC (dual-protocol startup).
          return;
        }
      }
      if (manualBleScanActiveRef.current && connectionTypeRef.current === 'ble') {
        setShowBlePicker(true);
        setConnectionStage('connectionPanel.stageScanning');
      }
    });
  }, [lastConnection, onConnect, protocol, t]); // isAutoConnecting intentionally omitted — ref handles it

  // Handle re-pair button click: always capture PIN before re-pair actions.
  const handleRePair = useCallback(() => {
    console.debug('[ConnectionPanel] handleRePair START');
    const mac = lastSelectedBleMacRef.current;
    if (!mac) {
      console.debug('[ConnectionPanel] handleRePair: no MAC available');
      setError(t('connectionPanel.error.noMacRePair'));
      return;
    }

    console.debug('[ConnectionPanel] handleRePair: MAC=', mac);
    setError(null);
    setShowRePairButton(false);
    setManualPairingFallback(true);
    setPinInputValue(protocol === 'meshtastic' ? '123456' : '');
    setShowPinPrompt(true);
    setConnecting(false);
    setConnectionStage('connectionPanel.stageEnterPinPair');
    console.debug('[ConnectionPanel] handleRePair END');
  }, [protocol, t]);

  const connectSelectedBleDevice = useCallback(
    async (deviceId: string) => {
      setConnectionStage('connectionPanel.stageConnecting');
      try {
        await onConnect('ble', undefined, deviceId);
      } catch (err) {
        console.warn(
          '[ConnectionPanel] BLE connect after selection failed ' + errLikeToLogString(err),
        );
        clearMeshcoreBleSelectionOnMissingServices(err);
        const bleErrMsg = humanizeBleError(err, t);
        if (bleErrMsg) setError(bleErrMsg);
        if (
          (isLinux && shouldShowLinuxRePairFromBleError(err, bleErrMsg)) ||
          (isWindows && shouldOfferWindowsRePair(err))
        ) {
          setShowRePairButton(true);
          setConnectionStage('connectionPanel.stagePairingFailed');
        } else {
          setConnectionStage('');
        }
        setConnecting(false);
      }
    },
    [onConnect, clearMeshcoreBleSelectionOnMissingServices, isLinux, isWindows, t],
  );

  /** Windows: show the in-app PIN prompt for a radio the OS has no bond for. */
  const promptWindowsPairing = useCallback(
    (deviceId: string) => {
      pendingPairBleDeviceRef.current = { deviceId };
      lastSelectedBleMacRef.current = deviceId;
      setManualPairingFallback(false);
      setPinInputValue(protocol === 'meshtastic' ? '123456' : '');
      setShowPinPrompt(true);
      setConnecting(false);
      setConnectionStage('connectionPanel.stageEnterPinWindows');
    },
    [protocol],
  );

  /** Windows: pair in-app with the PIN, then connect. Wrong PIN keeps the prompt open. */
  const pairWindowsThenConnect = useCallback(
    async (deviceId: string, pin: string, unpairFirst: boolean) => {
      const pendingDevice = { deviceId };
      pendingPairBleDeviceRef.current = pendingDevice;
      try {
        setError(null);
        setConnecting(true);
        if (unpairFirst) {
          setShowPinPrompt(false);
          setConnectionStage('connectionPanel.stageRemoving');
          await unpairWindowsBle(deviceId);
          if (pendingPairBleDeviceRef.current !== pendingDevice) return;
        }
        setConnectionStage('connectionPanel.stagePairingWindows');
        await pairWindowsBle(deviceId, pin);
        if (pendingPairBleDeviceRef.current !== pendingDevice) return;
        pendingPairBleDeviceRef.current = null;
        setShowPinPrompt(false);
        setPinInputValue('');
        setManualPairingFallback(false);
        setShowRePairButton(false);
        await connectSelectedBleDevice(deviceId);
      } catch (err) {
        if (pendingPairBleDeviceRef.current !== pendingDevice) return;
        console.warn('[ConnectionPanel] Windows in-app pairing failed: ' + errLikeToLogString(err));
        const msg = err instanceof Error ? err.message : String(err);
        setError(
          isWindowsPinRejected(err)
            ? t('connectionPanel.error.windowsPinRejected')
            : t('connectionPanel.error.pairingFailed', { msg }),
        );
        setManualPairingFallback(false);
        setShowPinPrompt(true);
        setConnectionStage('connectionPanel.stageEnterPinWindows');
        setConnecting(false);
      }
    },
    [connectSelectedBleDevice, t],
  );

  // Handle PIN submission for pairing
  const handlePinSubmit = useCallback(async () => {
    const normalizedPin = normalizePairingPin(pinInputValue);
    if (!normalizedPin) {
      setError(t('connectionPanel.error.pinFormat'));
      return;
    }
    const pendingDevice = pendingPairBleDeviceRef.current;
    if (isWindows && capabilities.hasGattBleScanning) {
      // OS-specific: WinRT custom pairing via the sidecar (Settings pairing is unreliable).
      const deviceId = manualPairingFallback
        ? lastSelectedBleMacRef.current
        : pendingDevice?.deviceId;
      if (deviceId) {
        if (!/^\d{4,6}$/.test(normalizedPin)) {
          setError(t('connectionPanel.error.pinFormat'));
          return;
        }
        await pairWindowsThenConnect(deviceId, normalizedPin, manualPairingFallback);
        return;
      }
    }
    if (pendingDevice && isLinux && !manualPairingFallback) {
      try {
        setError(null);
        setConnecting(true);
        setConnectionStage('connectionPanel.stagePairingBluetooth');
        await window.electronAPI.bluetoothPair(pendingDevice.deviceId, normalizedPin);
        try {
          await window.electronAPI.bluetoothGetInfo(pendingDevice.deviceId);
        } catch {
          // catch-no-log-ok -- diagnostics only
        }
        if (pendingPairBleDeviceRef.current !== pendingDevice) return;
        pendingPairBleDeviceRef.current = null;
        setShowPinPrompt(false);
        setPinInputValue('');
        setConnectionStage('connectionPanel.stageConnecting');
        await connectSelectedBleDevice(pendingDevice.deviceId);
      } catch (err) {
        if (pendingPairBleDeviceRef.current !== pendingDevice) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[ConnectionPanel] BLE pre-connect pair failed: ' + errLikeToLogString(err));
        setError(t('connectionPanel.error.pairingFailed', { msg }));
        setConnectionStage('connectionPanel.stageEnterPin');
        setConnecting(false);
      }
      return;
    }
    const manualMac = lastSelectedBleMacRef.current;
    // Explicit "Remove & Re-pair" only (Linux). Normal Cancel / disconnect never hits this — it does not run on Win/macOS.
    if (manualPairingFallback && isLinux && manualMac) {
      let scanStarted = false;
      try {
        setError(null);
        setShowPinPrompt(false);
        setConnecting(true);
        setConnectionStage('connectionPanel.stageRemoving');
        await window.electronAPI.bluetoothUnpair(manualMac);
        try {
          await window.electronAPI.bluetoothUntrust(manualMac);
        } catch {
          // catch-no-log-ok -- untrust is best-effort, ignore all failures
        }
        try {
          await window.electronAPI.bluetoothStartScan();
          scanStarted = true;
        } catch (e) {
          console.warn('[ConnectionPanel] bluetoothStartScan warning: ' + errLikeToLogString(e));
        }
        setConnectionStage('connectionPanel.stagePairingPin');
        await window.electronAPI.bluetoothPair(manualMac, normalizedPin);
        try {
          await window.electronAPI.bluetoothGetInfo(manualMac);
        } catch {
          // catch-no-log-ok -- diagnostics only
        }
        setPinInputValue('');
        setManualPairingFallback(false);
        setShowRePairButton(false);
        setConnecting(false);
        setConnectionStage('');
        setError(t('connectionPanel.error.pinAcceptedNext'));
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[ConnectionPanel] manual pair failed: ' + errLikeToLogString(err));
        setError(t('connectionPanel.error.pinPairingFailed', { msg }));
        setShowRePairButton(true);
        setConnecting(false);
        setConnectionStage('');
        return;
      } finally {
        if (scanStarted) {
          try {
            await window.electronAPI.bluetoothStopScan();
          } catch {
            // catch-no-log-ok -- stop scan is best-effort
          }
        }
      }
    }
    setShowPinPrompt(false);
    setPinInputValue('');
  }, [
    pinInputValue,
    manualPairingFallback,
    isLinux,
    isWindows,
    capabilities.hasGattBleScanning,
    pairWindowsThenConnect,
    connectSelectedBleDevice,
    t,
  ]);

  // Cancel also invalidates an in-flight OS pairing result.
  const handlePinCancel = useCallback(() => {
    pendingPairBleDeviceRef.current = null;
    setShowPinPrompt(false);
    setManualPairingFallback(false);
    setPinInputValue('');
    setConnecting(false);
    setConnectionStage('');
  }, []);

  // Listen for serial ports discovered by main process
  useEffect(() => {
    return window.electronAPI.onSerialPortsDiscovered((ports) => {
      setSerialPorts(ports);
      if (isAutoConnecting) {
        const lastId = lastConnection?.serialPortId ?? loadLastSerialPort();
        if (lastId) {
          const match = ports.find((p) => p.portId === lastId);
          if (match) {
            if (autoConnectTimeoutRef.current) {
              clearTimeout(autoConnectTimeoutRef.current);
              autoConnectTimeoutRef.current = null;
            }
            window.electronAPI.selectSerialPort(match.portId);
            setConnectionStage('connectionPanel.stageConnecting');
            return;
          }
        }
      }
      setShowSerialPicker(true);
      setConnectionStage('connectionPanel.stageSelectSerial');
    });
  }, [isAutoConnecting, lastConnection]);

  const handleConnect = useCallback(async () => {
    // Cancel deferred dual-Noble BLE auto-connect so it cannot race prepareRfConnect against
    // a manual TCP/serial/HTTP connect (orphan TCP socket + connectType flip).
    // Mount auto-connect lives in ProtocolAutoConnectCoordinator — cancel that gate too.
    cancelProtocolRfAutoConnect(protocol);
    if (isAutoConnectingRef.current) {
      console.debug('[ConnectionPanel] cancelling in-flight BLE auto-connect for manual connect');
    }
    isAutoConnectingRef.current = false;
    setIsAutoConnecting(false);
    setAutoConnectBleTarget(null);
    if (autoConnectTimeoutRef.current) {
      clearTimeout(autoConnectTimeoutRef.current);
      autoConnectTimeoutRef.current = null;
    }
    setError(null);
    setConnecting(true);
    setBleDevices([]);
    setSerialPorts([]);
    setShowBlePicker(false);
    setShowSerialPicker(false);
    setShowPinPrompt(false);
    pendingPairBleDeviceRef.current = null;
    manualBleScanActiveRef.current = false;
    setConnectionStage('connectionPanel.stagePleaseWait');

    if (connectionType === 'ble') {
      // Manual Connect always scans so users can choose another radio.
      manualBleScanActiveRef.current = true;
      setConnectionStage('connectionPanel.stageScanning');
      try {
        await startGattScanningWithRetry(protocol);
      } catch (err) {
        manualBleScanActiveRef.current = false;
        console.warn('[ConnectionPanel] startGattScanning failed: ' + errLikeToLogString(err));
        const bleErrMsg = humanizeBleError(err, t);
        if (bleErrMsg) setError(bleErrMsg);
        setConnecting(false);
        setConnectionStage('');
      }
      return;
    }

    try {
      console.debug('[ConnectionPanel] handleConnect', connectionType, activeHostAddress);
      if (connectionType === 'http') {
        await onConnect('http', activeHostAddress);
      } else if (connectionType === 'tcp') {
        await onConnect('tcp', activeHostAddress);
      } else {
        await onConnect('serial');
      }
    } catch (err) {
      console.warn('[ConnectionPanel] handleConnect failed ' + errLikeToLogString(err));
      let errorMsg: string;
      if (connectionType === 'serial') {
        errorMsg = humanizeSerialError(err, t);
      } else if (connectionType === 'http' || connectionType === 'tcp') {
        errorMsg = humanizeHttpError(activeHostAddress, err, t);
      } else {
        errorMsg = err instanceof Error ? err.message : t('connectionPanel.error.connectionFailed');
      }
      // Empty humanize = MeshCore setup AbortError (supersede/cancel); do not setError('').
      if (errorMsg) setError(errorMsg);
      setConnecting(false);
      setConnectionStage('');
    }
  }, [connectionType, activeHostAddress, onConnect, protocol, t]);

  const handleCancelConnection = useCallback(() => {
    cancelProtocolRfAutoConnect(protocol);
    isAutoConnectingRef.current = false;
    setIsAutoConnecting(false);
    if (autoConnectTimeoutRef.current) {
      clearTimeout(autoConnectTimeoutRef.current);
      autoConnectTimeoutRef.current = null;
    }
    if (showBlePicker || connectionType === 'ble') {
      manualBleScanActiveRef.current = false;
      pendingPairBleDeviceRef.current = null;
      setShowPinPrompt(false);
      setManualPairingFallback(false);
      if (capabilities.hasGattBleScanning) {
        void window.electronAPI.stopGattScanning(protocol).catch((e: unknown) => {
          console.debug('[ConnectionPanel] stopGattScanning failed ' + errLikeToLogString(e));
        });
      }
    }
    if (showSerialPicker) {
      window.electronAPI.cancelSerialSelection();
    }
    setShowBlePicker(false);
    setShowSerialPicker(false);
    manualBleScanActiveRef.current = false;
    setConnecting(false);
    setConnectionStage('');
    // Tear down connection without blocking Cancel UI on sidecar cargo/BLE start.
    console.debug('[ConnectionPanel] handleCancelConnection onDisconnect');
    void onDisconnect().catch((e: unknown) => {
      console.debug('[ConnectionPanel] onDisconnect best-effort cleanup ' + errLikeToLogString(e));
    });
  }, [
    showBlePicker,
    showSerialPicker,
    onDisconnect,
    connectionType,
    protocol,
    capabilities.hasGattBleScanning,
  ]);

  const handleSelectBleDevice = useCallback(
    (deviceId: string) => {
      console.debug(
        `[ConnectionPanel] BLE device selected deviceId=${deviceId} isLinux=${isLinux}`,
      );
      saveLastBleDevice(protocol, deviceId);
      // Save BLE advertisement name for use in LastConnection display
      const found = bleDevices.find((d) => d.deviceId === deviceId);
      lastSelectedBleNameRef.current = found?.deviceName ?? null;
      if (found?.address) {
        cacheBleDeviceMac(deviceId, found.address);
        lastSelectedBleAddressRef.current = found.address;
      } else {
        lastSelectedBleAddressRef.current = getBleDeviceMac(deviceId);
      }
      // Store MAC address for potential re-pairing on Linux
      lastSelectedBleMacRef.current = deviceId;
      setShowBlePicker(false);
      manualBleScanActiveRef.current = false;
      setShowRePairButton(false);
      if (capabilities.hasGattBleScanning) {
        void window.electronAPI.stopGattScanning(protocol).catch((e: unknown) => {
          console.debug('[ConnectionPanel] stopGattScanning failed ' + errLikeToLogString(e));
        });
      }
      if (isLinux) {
        // OS-specific: BlueZ pairing uses bluetoothctl with the PIN entered in this panel.
        const pendingDevice = { deviceId };
        pendingPairBleDeviceRef.current = pendingDevice;
        setConnectionStage('connectionPanel.stageCheckingPairing');
        void (async () => {
          try {
            const info = await window.electronAPI.bluetoothGetInfo(deviceId);
            if (pendingPairBleDeviceRef.current !== pendingDevice) return;
            if (parseBluetoothctlPairedState(info) === 'yes') {
              pendingPairBleDeviceRef.current = null;
              await connectSelectedBleDevice(deviceId);
              return;
            }
          } catch (err) {
            console.debug(
              '[ConnectionPanel] pairing status unavailable ' + errLikeToLogString(err),
            );
          }
          if (pendingPairBleDeviceRef.current !== pendingDevice) return;
          setManualPairingFallback(false);
          setPinInputValue(protocol === 'meshtastic' ? '123456' : '');
          setShowPinPrompt(true);
          setConnectionStage('connectionPanel.stageEnterPinLinux');
        })();
        return;
      }
      if (isWindows && capabilities.hasGattBleScanning) {
        // OS-specific: an unpaired radio can wedge btleplug's WinRT connect; pair in-app first.
        const pendingDevice = { deviceId };
        pendingPairBleDeviceRef.current = pendingDevice;
        setConnectionStage('connectionPanel.stageCheckingPairing');
        void (async () => {
          const pairState = await getWindowsBlePairState(deviceId);
          if (pendingPairBleDeviceRef.current !== pendingDevice) return;
          if (pairState === 'unpaired') {
            promptWindowsPairing(deviceId);
            return;
          }
          pendingPairBleDeviceRef.current = null;
          await connectSelectedBleDevice(deviceId);
        })();
        return;
      }
      void connectSelectedBleDevice(deviceId);
    },
    [
      bleDevices,
      isLinux,
      isWindows,
      connectSelectedBleDevice,
      promptWindowsPairing,
      protocol,
      capabilities.hasGattBleScanning,
    ],
  );

  const handleSelectSerialPort = useCallback((portId: string) => {
    saveLastSerialPort(portId);
    window.electronAPI.selectSerialPort(portId);
    setShowSerialPicker(false);
    setConnectionStage('connectionPanel.stageConnecting');
  }, []);

  // Cold-start RF auto-connect (serial/BLE/TCP/HTTP) is owned by
  // ProtocolAutoConnectCoordinator / useProtocolRfAutoConnect — not this panel.

  // Cleanup timeout on unmount
  useEffect(
    () => () => {
      if (autoConnectTimeoutRef.current) clearTimeout(autoConnectTimeoutRef.current);
    },
    [],
  );

  const handleReconnect = useCallback(() => {
    if (!lastConnection) return;
    // Same cancel as handleConnect — Reconnect must not race deferred ProtocolAutoConnectCoordinator
    // BLE/serial auto-connect (orphan socket / connectType flip).
    cancelProtocolRfAutoConnect(protocol);
    if (isAutoConnectingRef.current) {
      console.debug('[ConnectionPanel] cancelling in-flight BLE auto-connect for reconnect');
    }
    isAutoConnectingRef.current = false;
    setIsAutoConnecting(false);
    setAutoConnectBleTarget(null);
    if (autoConnectTimeoutRef.current) {
      clearTimeout(autoConnectTimeoutRef.current);
      autoConnectTimeoutRef.current = null;
    }
    setError(null);

    if (lastConnection.type === 'ble') {
      void (async () => {
        if (!lastConnection.bleDeviceId) return;
        setConnectionType('ble');
        setBleDevices([]);
        setShowBlePicker(false);
        manualBleScanActiveRef.current = false;
        pendingPairBleDeviceRef.current = null;
        isAutoConnectingRef.current = true;
        setIsAutoConnecting(true);
        setConnecting(true);
        const bleDeviceId = lastConnection.bleDeviceId;
        const matchIds = [bleDeviceId, lastConnection.bleMac].filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        );
        lastSelectedBleMacRef.current = bleDeviceId;
        if (isWindows && capabilities.hasGattBleScanning) {
          // OS-specific: skip a doomed WinRT connect (wedges for ~41s) when the bond is gone.
          setConnectionStage('connectionPanel.stageCheckingPairing');
          const attempt = {};
          windowsReconnectAttemptRef.current = attempt;
          const pairState = await getWindowsBlePairState(bleDeviceId);
          // Cancel, manual connect, or a newer Reconnect superseded this attempt mid-await.
          if (windowsReconnectAttemptRef.current !== attempt || !isAutoConnectingRef.current) {
            return;
          }
          windowsReconnectAttemptRef.current = null;
          if (pairState === 'unpaired') {
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            promptWindowsPairing(bleDeviceId);
            return;
          }
        }
        setConnectionStage('connectionPanel.stageConnecting');
        try {
          await reconnectBleWithScan(
            protocol,
            bleDeviceId,
            (resolvedId) => onConnect('ble', undefined, resolvedId ?? bleDeviceId),
            { matchIds },
          );
          isAutoConnectingRef.current = false;
          setIsAutoConnecting(false);
          setConnecting(false);
          setConnectionStage('');
        } catch (err: unknown) {
          // catch-no-log-ok reconnect errors surfaced via setError/humanizeBleError
          isAutoConnectingRef.current = false;
          setIsAutoConnecting(false);
          clearMeshcoreBleSelectionOnMissingServices(err);
          const bleErrMsg = humanizeBleError(err, t);
          if (bleErrMsg) setError(bleErrMsg);
          const isPairingRelatedError = isWindows
            ? shouldOfferWindowsRePair(err)
            : shouldShowLinuxRePairFromBleError(err, bleErrMsg);
          if ((isLinux || isWindows) && isPairingRelatedError) {
            setShowRePairButton(true);
            setShowBlePicker(false);
            setConnectionStage('connectionPanel.stagePairingFailed');
            setConnecting(false);
          } else {
            setConnecting(false);
            setConnectionStage('');
          }
          if (protocol === 'meshcore' && shouldOfferMeshcoreLinuxManualPinAfterError(bleErrMsg)) {
            setShowPinPrompt(true);
            setManualPairingFallback(true);
            setPinInputValue('');
          }
        }
      })();
    } else if (lastConnection.type === 'http') {
      const fallbackAddress = protocol === 'meshcore' ? tcpHost : httpAddress;
      const addr = lastConnection.httpAddress ?? fallbackAddress;
      if (protocol === 'meshcore') {
        const { host, port } = parseTcpAddress(addr);
        setTcpHost(host);
        setTcpPortStr(String(port));
      } else {
        setHttpAddress(addr);
      }
      setConnectionType('http');
      setConnecting(true);
      setBleDevices([]);
      setSerialPorts([]);
      setShowBlePicker(false);
      setShowSerialPicker(false);
      setConnectionStage('connectionPanel.stagePleaseWait');
      onConnect('http', addr).catch((err: unknown) => {
        // catch-no-log-ok reconnect errors surfaced via setError/humanizeHttpError
        // Empty humanize = MeshCore setup AbortError (supersede/cancel); do not setError('').
        const httpErr = humanizeHttpError(addr, err, t);
        if (httpErr) setError(httpErr);
        setConnecting(false);
        setConnectionStage('');
      });
    } else if (lastConnection.type === 'tcp') {
      const addr = lastConnection.httpAddress ?? tcpAddress;
      setTcpAddress(addr);
      setConnectionType('tcp');
      setConnecting(true);
      setBleDevices([]);
      setSerialPorts([]);
      setShowBlePicker(false);
      setShowSerialPicker(false);
      setConnectionStage('connectionPanel.stagePleaseWait');
      onConnect('tcp', addr).catch((err: unknown) => {
        // catch-no-log-ok reconnect errors surfaced via setError/humanizeHttpError
        // Empty humanize = MeshCore setup AbortError (supersede/cancel); do not setError('').
        const tcpErr = humanizeHttpError(addr, err, t);
        if (tcpErr) setError(tcpErr);
        setConnecting(false);
        setConnectionStage('');
      });
    } else if (lastConnection.type === 'serial') {
      isAutoConnectingRef.current = true;
      setIsAutoConnecting(true);
      setConnectionType('serial');
      setConnecting(true);
      setConnectionStage('connectionPanel.stagePleaseWait');
      onAutoConnect('serial', undefined, lastConnection.serialPortId).catch((err: unknown) => {
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        setError(humanizeSerialError(err, t));
        setConnecting(false);
        setConnectionStage('');
      });
    }
  }, [
    lastConnection,
    onConnect,
    onAutoConnect,
    httpAddress,
    tcpAddress,
    protocol,
    tcpHost,
    isLinux,
    isWindows,
    capabilities.hasGattBleScanning,
    promptWindowsPairing,
    clearMeshcoreBleSelectionOnMissingServices,
    t,
  ]);

  const isConnected =
    state.status === 'connected' ||
    state.status === 'configured' ||
    state.status === 'stale' ||
    state.status === 'reconnecting';
  const lastBleIdentity = resolveLastBleIdentity(lastConnection, protocol);

  // ─── Connecting Progress View ───────────────────────────────────
  const radioUp =
    state.status === 'configured' || state.status === 'connected' || state.status === 'stale';
  const showAutoReconnectBanner =
    state.status === 'reconnecting' || (!radioUp && (isAutoConnecting || connecting));

  /** Linux BLE / MeshCore pairing PIN entry, shared by the connecting and disconnected views. */
  const renderPinForm = (onSubmit: () => void) => (
    <>
      <p className="text-ink-200 mb-2 text-sm">{t('connectionPanel.enterPin')}</p>
      <div className="flex flex-wrap gap-2">
        <div className="w-40">
          <input
            type="text"
            value={pinInputValue}
            onChange={(e) => {
              setPinInputValue(e.target.value.replace(/\D/g, '').slice(0, 6));
            }}
            placeholder={t('connectionPanel.pinPlaceholder')}
            aria-label={t('connectionPanel.enterPin')}
            className={`${INPUT_CLASS} font-mono`}
            maxLength={6}
            inputMode="numeric"
            pattern="[0-9]*"
          />
        </div>
        <Button variant="primary" onClick={onSubmit} disabled={!normalizePairingPin(pinInputValue)}>
          {t('connectionPanel.submit')}
        </Button>
        <Button onClick={handlePinCancel}>{t('common.cancel')}</Button>
      </div>
    </>
  );

  const renderAutoReconnectBanner = (): ReactNode =>
    showAutoReconnectBanner ? (
      <div
        role="status"
        aria-live="polite"
        className="rounded-lg border border-cyan-700/45 bg-cyan-950/40 px-4 py-3 text-sm text-cyan-100"
      >
        {t('connectionPanel.autoReconnectInProgress')}
      </div>
    ) : null;

  let connectingProgressView: ReactNode = null;
  if (!capabilities.hasReticulumInterfaceConfig && connecting && !isConnected) {
    connectingProgressView = (
      <div className="flex w-full flex-col items-center justify-center space-y-6 py-10">
        {renderAutoReconnectBanner()}
        <SpinnerIconLg className="text-bright-green" />
        <div className="space-y-2 text-center">
          <h2 className="text-ink-200 text-lg font-semibold">
            {showPinPrompt
              ? t('connectionPanel.pairWithDevice')
              : showBlePicker
                ? t('connectionPanel.scanningBluetooth')
                : isAutoConnecting && autoConnectBleTarget
                  ? t('connectionPanel.autoConnectingTo', { deviceName: autoConnectBleTarget })
                  : isAutoConnecting
                    ? t('connectionPanel.autoConnecting')
                    : t('connectionPanel.connecting')}
          </h2>
          <div role="status" aria-live="polite" aria-atomic="true">
            <p
              className={
                connectionStage === STAGE_LINUX_UNPAIRED
                  ? 'rounded-lg border border-orange-500/45 bg-orange-950/40 px-4 py-3 text-sm text-orange-200'
                  : 'text-muted text-sm'
              }
            >
              {resolveConnectionStageText(connectionStage, autoConnectBleTarget, t)}
            </p>
            <p className="text-muted/80 mt-1 text-xs">{t('connectionPanel.stayOnTab')}</p>
            {(() => {
              const targetId =
                lastConnection?.bleDeviceId ?? loadLastBleDevice(protocol) ?? undefined;
              const targetRssi =
                (targetId ? bleDevices.find((d) => d.deviceId === targetId)?.rssi : undefined) ??
                bleDevices.find((d) => d.deviceName === autoConnectBleTarget)?.rssi ??
                null;
              return isWeakBleRssi(targetRssi) ? (
                <BleWeakSignalBanner
                  rssi={targetRssi}
                  className="mt-2 rounded-lg border border-orange-800/60 bg-orange-900/40 px-3 py-2 text-xs text-orange-200"
                />
              ) : null;
            })()}
          </div>
        </div>

        {/* Embedded BLE Device Picker — hide while PIN entry is primary (Linux pairing / MeshCore pre-connect) */}
        {showBlePicker && !showPinPrompt && (
          <div
            role="region"
            aria-labelledby="ble-device-picker-heading"
            className="bg-deep-black border-ink-800 w-full overflow-hidden rounded-xl border"
          >
            <div className="border-ink-800 flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2">
              <span id="ble-device-picker-heading" className="text-ink-200 text-sm font-semibold">
                {t('connectionPanel.selectBluetoothDevice')}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-ink-300 text-xs" aria-live="polite">
                  {t('connectionPanel.devicesFound', { count: bleDevices.length })}
                </span>
                {bleDevices.length > 0 ? (
                  <PickerSortControls
                    mode="ble"
                    sortKey={blePickerSort.key}
                    sortDir={blePickerSort.dir}
                    onSortClick={(key) => {
                      setBlePickerSort((prev) => nextPickerSort(prev, key));
                    }}
                  />
                ) : null}
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {bleDevices.length === 0 ? (
                <div className="text-muted px-4 py-6 text-center text-sm">
                  <SpinnerIcon className="text-muted mx-auto mb-2 h-5 w-5" />
                  {t('connectionPanel.scanningDevices', {
                    protocol: protocol === 'meshcore' ? 'MeshCore' : 'Meshtastic',
                  })}
                </div>
              ) : (
                sortedBleDevices.map((device) => {
                  const displayName = getBlePickerName(device);
                  const identity = resolveBlePickerIdentity({
                    deviceId: device.deviceId,
                    address: device.address,
                    cachedMac: bleDeviceMacsCache[device.deviceId],
                  });
                  const hasRssi = device.rssi != null && Number.isFinite(device.rssi);
                  const bleAriaLabel = hasRssi
                    ? t('connectionPanel.pickerDeviceAriaWithRssi', {
                        name: displayName,
                        address: identity.display,
                        rssi: Math.round(device.rssi!),
                      })
                    : t('connectionPanel.pickerDeviceAria', {
                        name: displayName,
                        address: identity.display,
                      });
                  return (
                    <button
                      key={device.deviceId}
                      type="button"
                      aria-label={bleAriaLabel}
                      {...{ [PARENT_HOVER_ATTR]: '' }}
                      onClick={() => {
                        handleSelectBleDevice(device.deviceId);
                      }}
                      className="hover:bg-sidebar-active-bg border-ink-800 w-full border-b px-4 py-3 text-left transition-colors last:border-b-0"
                    >
                      <div className="text-ink-200 flex items-center gap-2 text-sm">
                        <ConnectionIcon type="ble" trigger={parentIconTrigger} />
                        <span className="min-w-0 flex-1 truncate">{displayName}</span>
                        {hasRssi ? (
                          <span className="text-muted flex shrink-0 items-center gap-1 text-xs">
                            <SignalBars rssi={device.rssi} className="h-3 w-4" />
                            {t('connectionPanel.bleRssiDbm', {
                              rssi: Math.round(device.rssi!),
                            })}
                          </span>
                        ) : null}
                      </div>
                      {identity.display !== displayName ? (
                        <div className="text-muted ml-7 font-mono text-xs">{identity.display}</div>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
            {(() => {
              const weakListed = bleDevices
                .map((d) => d.rssi)
                .filter((r): r is number => r != null && Number.isFinite(r) && isWeakBleRssi(r));
              const weakest = weakListed.length > 0 ? Math.min(...weakListed) : null;
              return <BleWeakSignalBanner rssi={weakest} />;
            })()}
            {bleDevices.some((d) => d.deviceName === 'AdaDFU') && (
              <p className="text-muted border-ink-800 border-t px-4 py-2 text-xs">
                {t('connectionPanel.hintAdaDfuBle')}
              </p>
            )}
            {protocol === 'meshcore' && (
              <p className="border-ink-800 border-t px-4 py-2 text-xs text-orange-400">
                <Trans
                  i18nKey="connectionPanel.meshcoreBlePairingHint"
                  components={{ strong: <strong /> }}
                />
                {isWindows && <> {t('connectionPanel.meshcoreBleWindowsInAppPairingHint')}</>}
              </p>
            )}
          </div>
        )}

        {/* Embedded Serial Port Picker */}
        {showSerialPicker && (
          <div
            role="region"
            aria-labelledby="serial-port-picker-heading"
            className="bg-deep-black border-ink-800 w-full overflow-hidden rounded-xl border"
          >
            <div className="border-ink-800 flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2">
              <span id="serial-port-picker-heading" className="text-ink-200 text-sm font-semibold">
                {t('connectionPanel.selectSerialPort')}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-ink-300 text-xs" aria-live="polite">
                  {t('connectionPanel.devicesFound', { count: serialPorts.length })}
                </span>
                {serialPorts.length > 0 ? (
                  <PickerSortControls
                    mode="serial"
                    sortKey={serialPickerSort.key}
                    sortDir={serialPickerSort.dir}
                    onSortClick={(key) => {
                      setSerialPickerSort((prev) => nextPickerSort(prev, key));
                    }}
                  />
                ) : null}
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {serialPorts.length === 0 ? (
                <div className="text-muted px-4 py-6 text-center text-sm">
                  {t('connectionPanel.noSerialPorts')}
                </div>
              ) : (
                sortedSerialPorts.map((port) => {
                  const cachedNodeName = getSerialPortNodeName(port.portId);
                  const serialDetails = `${port.portName}${port.vendorId ? ` (VID: ${port.vendorId})` : ''}${port.productId ? ` PID: ${port.productId}` : ''}`;
                  const serialAriaLabel = `${cachedNodeName ? `${cachedNodeName} ` : ''}${port.displayName} ${serialDetails}`;
                  return (
                    <button
                      key={port.portId}
                      type="button"
                      aria-label={serialAriaLabel}
                      {...{ [PARENT_HOVER_ATTR]: '' }}
                      onClick={() => {
                        handleSelectSerialPort(port.portId);
                      }}
                      className="hover:bg-sidebar-active-bg border-ink-800 w-full border-b px-4 py-3 text-left transition-colors last:border-b-0"
                    >
                      <div className="text-ink-200 flex items-center gap-2 text-sm">
                        <ConnectionIcon type="serial" trigger={parentIconTrigger} />
                        {cachedNodeName ?? port.displayName}
                      </div>
                      <div className="text-muted ml-7 font-mono text-xs">
                        {port.portName}
                        {port.vendorId && ` (VID: ${port.vendorId})`}
                        {port.productId && ` PID: ${port.productId}`}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Error in progress view */}
        {error && (
          <div role="alert" className={`w-full ${NOTICE_CLASS.error}`}>
            {error}
          </div>
        )}

        {/* Re-pair button for Linux / Windows BLE pairing issues */}
        {showRePairButton && (
          <Button variant="primary" onClick={handleRePair}>
            {t('connectionPanel.rePairDevice')}
          </Button>
        )}

        {/* PIN input prompt for Linux BLE pairing (connecting view) */}
        {showPinPrompt && (
          <div className={`w-full ${NOTICE_CLASS.info}`}>
            {renderPinForm(() => {
              void handlePinSubmit();
            })}
          </div>
        )}

        <Button onClick={handleCancelConnection}>{t('common.cancel')}</Button>
      </div>
    );
  }

  // ─── Shared MQTT section ────────────────────────────────────────
  const disconnectMqtt = (reason: string) => {
    markMqttUserDisconnect();
    window.electronAPI.mqtt
      .disconnect(protocol === 'meshcore' ? 'meshcore' : 'meshtastic')
      .catch((err: unknown) => {
        console.warn(
          `[ConnectionPanel] mqtt.disconnect (${reason}) failed: ` + errLikeToLogString(err),
        );
      });
  };

  const mqttSection =
    mqttStatus === 'connected' ? (
      <Panel
        title={t('connectionPanel.mqttConnection')}
        actions={
          <Button
            variant="danger"
            size="sm"
            icon={<Unplug aria-hidden className={ICON_MD} size={16} />}
            onClick={() => {
              disconnectMqtt('panel');
            }}
          >
            {t('connectionPanel.disconnectMqtt')}
          </Button>
        }
      >
        <div className="space-y-5">
          {mqttError && (
            <div role="alert" className={NOTICE_CLASS.error}>
              {mqttError}
            </div>
          )}
          {mqttWarning && <div className={NOTICE_CLASS.warn}>{mqttWarning}</div>}
          <LabelValueGrid>
            <LabelValue label={t('connectionPanel.server')} mono>
              {activeMqttSettings.server}:{activeMqttSettings.port}
            </LabelValue>
            {protocol === 'meshcore' &&
              /^v1_[0-9a-f]{64}$/i.test(activeMqttSettings.username ?? '') && (
                <LabelValue label={t('connectionPanel.from')} mono>
                  {activeMqttSettings.username?.slice(3)}
                </LabelValue>
              )}
            {protocol === 'meshtastic' && state.myNodeNum > 0 && (
              <LabelValue label={t('connectionPanel.from')} mono>
                {formatMeshtasticNodeId(state.myNodeNum)}
              </LabelValue>
            )}
            <LabelValue label={t('connectionPanel.topic')} mono>
              {activeMqttSettings.topicPrefix.endsWith('/')
                ? activeMqttSettings.topicPrefix
                : `${activeMqttSettings.topicPrefix}/`}
              #
            </LabelValue>
          </LabelValueGrid>
          {protocol !== 'meshcore' && mqttProfiles.length > 0 ? (
            <div className="space-y-1">
              <p id="conn-meshtastic-live-profile" className="text-muted text-xs">
                {t('mqttProfiles.switchLabel')}
              </p>
              <MqttNetworkPresetSelect
                id="conn-meshtastic-live-profile-select"
                labelledById="conn-meshtastic-live-profile"
                value={activeMqttProfile ? mqttProfileSelectValue(activeMqttProfile.id) : ''}
                options={[
                  ...(activeMqttProfile
                    ? []
                    : [{ value: '', label: t('mqttProfiles.noneSelected') }]),
                  ...mqttProfiles.map((p) => ({
                    value: mqttProfileSelectValue(p.id),
                    label: p.name,
                  })),
                ]}
                onSelect={(value) => {
                  const profileId = mqttProfileIdFromSelectValue(value);
                  const profile = mqttProfiles.find((p) => p.id === profileId);
                  if (profile) applyMeshtasticMqttProfile(profile);
                }}
              />
              {pendingMqttProfile ? (
                <p className="text-xs text-orange-400" role="status">
                  {t('mqttProfiles.reconnectNeeded')}
                </p>
              ) : null}
            </div>
          ) : null}
          <Stepper
            id="mqtt-max-retries-when-connected"
            label={t('connectionPanel.maxReconnectAttempts')}
            min={1}
            max={MQTT_MAX_RECONNECT_ATTEMPTS}
            value={activeMqttSettings.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS}
            onChange={(value) => {
              updateMqtt('maxRetries', clampMqttMaxRetries(value), false);
            }}
            hint={
              protocol === 'meshcore'
                ? t('connectionPanel.maxRetriesHelpConnected.meshcore', {
                    max: MQTT_MAX_RECONNECT_ATTEMPTS,
                  })
                : t('connectionPanel.maxRetriesHelpConnected.meshtastic', {
                    max: MQTT_MAX_RECONNECT_ATTEMPTS,
                  })
            }
          />
        </div>
      </Panel>
    ) : (
      <Panel title={t('connectionPanel.mqttConnection')}>
        <div className="max-w-3xl space-y-4">
          {mqttError && (
            <div role="alert" className={NOTICE_CLASS.error}>
              {mqttError}
            </div>
          )}
          {protocol !== 'meshcore' && (
            <div className="space-y-1">
              <p id="conn-meshtastic-network-preset" className="text-muted text-xs">
                {t('connectionPanel.networkPreset')}
              </p>
              <MqttNetworkPresetSelect
                id="conn-meshtastic-network-preset-select"
                labelledById="conn-meshtastic-network-preset"
                disabled={mqttStatus === 'connecting'}
                value={
                  activeMqttProfile
                    ? mqttProfileSelectValue(activeMqttProfile.id)
                    : meshtasticPreset
                }
                options={[
                  {
                    value: 'official-plain',
                    label: t('connectionPanel.meshtasticPreset.officialPlain'),
                  },
                  { value: 'liam', label: t('connectionPanel.meshtasticPreset.liam') },
                  { value: 'custom', label: t('connectionPanel.meshtasticPreset.custom') },
                  ...mqttProfiles.map((p) => ({
                    value: mqttProfileSelectValue(p.id),
                    label: t('mqttProfiles.optionLabel', { name: p.name }),
                  })),
                ]}
                onSelect={(value) => {
                  const profileId = mqttProfileIdFromSelectValue(value);
                  if (profileId != null) {
                    const profile = mqttProfiles.find((p) => p.id === profileId);
                    if (profile) applyMeshtasticMqttProfile(profile);
                    return;
                  }
                  const id = value as 'official-plain' | 'liam' | 'custom';
                  setMeshtasticPreset(id);
                  if (id === 'official-plain') {
                    setMqttSettings({
                      ...MESHTASTIC_OFFICIAL_1883,
                      topicPrefix: mqttSettings.topicPrefix,
                      autoLaunch: mqttSettings.autoLaunch,
                    });
                  } else if (id === 'liam') {
                    setMqttSettings({
                      ...MESHTASTIC_LIAM_1883,
                      topicPrefix: mqttSettings.topicPrefix,
                      autoLaunch: mqttSettings.autoLaunch,
                    });
                  }
                }}
              />
              {meshtasticPreset === 'liam' && !activeMqttProfile && (
                <p className="text-xs text-orange-400">{t('connectionPanel.liamServerNote')}</p>
              )}
              <MqttProfileControls
                activeProfile={activeMqttProfile}
                onSave={(name) => {
                  updateMqttProfiles(createMqttProfile(mqttProfiles, name, mqttSettings));
                }}
                onRename={(id, name) => {
                  updateMqttProfiles(renameMqttProfile(mqttProfiles, id, name));
                }}
                onDelete={(id) => {
                  updateMqttProfiles(deleteMqttProfile(mqttProfiles, id));
                }}
              />
            </div>
          )}
          {protocol === 'meshcore' && (
            <div className="space-y-1">
              <p id="conn-meshcore-network-preset" className="text-muted text-xs">
                {t('connectionPanel.networkPreset')}
              </p>
              <MqttNetworkPresetSelect
                key={`meshcore-preset-${meshcorePresetSelectNonce}`}
                id="conn-meshcore-network-preset-select"
                labelledById="conn-meshcore-network-preset"
                value={meshcorePreset}
                options={[
                  { value: 'letsmesh', label: t('connectionPanel.meshcorePreset.letsmesh') },
                  { value: 'meshmapper', label: t('connectionPanel.meshcorePreset.meshmapper') },
                  {
                    value: 'coloradomesh',
                    label: t('connectionPanel.meshcorePreset.coloradomesh'),
                  },
                  { value: 'waev', label: t('connectionPanel.meshcorePreset.waev') },
                  { value: 'meshatse', label: t('connectionPanel.meshcorePreset.meshatse') },
                  { value: 'meshcoreca', label: t('connectionPanel.meshcorePreset.meshcoreca') },
                  { value: 'eastmesh', label: t('connectionPanel.meshcorePreset.eastmesh') },
                  { value: 'ripple', label: t('connectionPanel.meshcorePreset.ripple') },
                  { value: 'custom', label: t('connectionPanel.meshcorePreset.custom') },
                ]}
                onSelect={(value) => {
                  const id = value as MeshcoreMqttPreset;
                  if (id === 'custom') {
                    setMeshcorePreset(id);
                    return;
                  }
                  if (id === 'ripple') {
                    if (!window.confirm(t('connectionPanel.ripplePresetConfirm'))) {
                      // Cancelled: force the controlled select to snap back to the current preset.
                      setMeshcorePresetSelectNonce((n) => n + 1);
                      return;
                    }
                  }
                  if (id === 'coloradomesh') {
                    if (!window.confirm(t('connectionPanel.coloradoPresetConfirm'))) {
                      setMeshcorePresetSelectNonce((n) => n + 1);
                      return;
                    }
                    localStorage.setItem(COLORADO_MQTT_REGION_ACK_KEY, '1');
                  }
                  setMeshcorePreset(id);
                  const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                  setMeshcoreMqttSettings((prev) => ({
                    ...applyMeshcoreMqttPreset(id, prev),
                    username: fromIdentity || prev.username,
                  }));
                }}
              />
              {meshcorePreset === 'coloradomesh' && (
                <p className="text-xs text-orange-400">{t('connectionPanel.coloradoServerNote')}</p>
              )}
              {meshcorePreset === 'meshcoreca' && (
                <div
                  className="flex flex-wrap items-center gap-2 pt-1"
                  role="group"
                  aria-label={t('connectionPanel.meshcoreCaBroker')}
                >
                  <span className="text-muted text-xs">{t('connectionPanel.broker')}</span>
                  <button
                    type="button"
                    aria-pressed={meshcoreMqttSettings.server === MESHCORE_CA_HOST_PRIMARY}
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setMeshcoreMqttSettings((prev) => ({
                        ...prev,
                        server: MESHCORE_CA_HOST_PRIMARY,
                        port: 443,
                        useWebSocket: true,
                        tlsEnabled: true,
                        wsPath: '/mqtt',
                        keepalive: 30,
                        username: fromIdentity || prev.username,
                      }));
                    }}
                    className={chipClass(meshcoreMqttSettings.server === MESHCORE_CA_HOST_PRIMARY)}
                  >
                    {t('connectionPanel.meshcoreCaPrimary')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={meshcoreMqttSettings.server === MESHCORE_CA_HOST_BACKUP}
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setMeshcoreMqttSettings((prev) => ({
                        ...prev,
                        server: MESHCORE_CA_HOST_BACKUP,
                        port: 443,
                        useWebSocket: true,
                        tlsEnabled: true,
                        wsPath: '/mqtt',
                        keepalive: 30,
                        username: fromIdentity || prev.username,
                      }));
                    }}
                    className={chipClass(meshcoreMqttSettings.server === MESHCORE_CA_HOST_BACKUP)}
                  >
                    {t('connectionPanel.meshcoreCaBackup')}
                  </button>
                </div>
              )}
              {meshcorePreset === 'letsmesh' && (
                <div
                  className="flex flex-wrap items-center gap-2 pt-1"
                  role="group"
                  aria-label={t('connectionPanel.letsMeshRegion')}
                >
                  <span className="text-muted text-xs">{t('connectionPanel.region')}</span>
                  <button
                    type="button"
                    aria-pressed={meshcoreMqttSettings.server === LETSMESH_HOST_US}
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setMeshcoreMqttSettings((prev) => ({
                        ...prev,
                        server: LETSMESH_HOST_US,
                        port: 443,
                        useWebSocket: true,
                        tlsEnabled: true,
                        wsPath: '/ws',
                        keepalive: 60,
                        username: fromIdentity || prev.username,
                      }));
                    }}
                    className={chipClass(meshcoreMqttSettings.server === LETSMESH_HOST_US)}
                  >
                    {t('connectionPanel.letsMeshRegionUs')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={meshcoreMqttSettings.server === LETSMESH_HOST_EU}
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setMeshcoreMqttSettings((prev) => ({
                        ...prev,
                        server: LETSMESH_HOST_EU,
                        port: 443,
                        useWebSocket: true,
                        tlsEnabled: true,
                        wsPath: '/ws',
                        keepalive: 60,
                        username: fromIdentity || prev.username,
                      }));
                    }}
                    className={chipClass(meshcoreMqttSettings.server === LETSMESH_HOST_EU)}
                  >
                    {t('connectionPanel.letsMeshRegionEu')}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <div className="space-y-1">
              <label htmlFor="mqtt-server" className="text-muted text-xs">
                {t('connectionPanel.server')}
              </label>
              <input
                id="mqtt-server"
                type="text"
                value={activeMqttSettings.server}
                onChange={(e) => {
                  updateMqtt('server', e.target.value);
                }}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="mqtt-port" className="text-muted text-xs">
                {t('connectionPanel.port')}
              </label>
              <input
                id="mqtt-port"
                type="number"
                value={activeMqttSettings.port}
                onChange={(e) => {
                  updateMqtt('port', clampTcpPort(e.target.value, 1883));
                }}
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mqtt-tls-enabled"
              checked={
                activeMqttSettings.tlsEnabled === true ||
                (activeMqttSettings.tlsEnabled !== false && activeMqttTls)
              }
              onChange={(e) => {
                updateMqtt('tlsEnabled', e.target.checked);
              }}
              className={CHECKBOX_CLASS}
            />
            <label htmlFor="mqtt-tls-enabled" className="text-body text-ink-200 cursor-pointer">
              {t('connectionPanel.mqttTlsEnabled')}
            </label>
          </div>
          {activeMqttTls && (
            <div className={`flex items-center gap-2 ${NOTICE_CLASS.warn}`}>
              <input
                type="checkbox"
                id="mqtt-tls-insecure"
                checked={activeMqttSettings.tlsInsecure ?? false}
                onChange={(e) => {
                  updateMqtt('tlsInsecure', e.target.checked);
                }}
                className={CHECKBOX_CLASS}
              />
              <label htmlFor="mqtt-tls-insecure" className="cursor-pointer text-xs text-orange-200">
                {t('connectionPanel.mqttTlsInsecure')}
              </label>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mqtt-websocket"
              checked={activeMqttSettings.useWebSocket ?? false}
              onChange={(e) => {
                updateMqtt('useWebSocket', e.target.checked);
              }}
              className={CHECKBOX_CLASS}
            />
            <label htmlFor="mqtt-websocket" className="text-body text-ink-200 cursor-pointer">
              {t('connectionPanel.useWebSocket')}{' '}
              <span className="text-muted">{t('connectionPanel.wsRequired')}</span>
            </label>
          </div>
          {protocol === 'meshcore' &&
            usesMeshcoreDeviceSigningMqtt(meshcorePreset, meshcoreMqttSettings) &&
            letsMeshPresetConfigurationDeviation(meshcoreMqttSettings) && (
              <div className={NOTICE_CLASS.warn}>
                {meshcorePresetDeviationText(t, meshcorePreset)}
              </div>
            )}
          {protocol === 'meshcore' &&
            usesMeshcoreDeviceSigningMqtt(meshcorePreset, meshcoreMqttSettings) && (
              <div className={hasPrivateKey ? NOTICE_CLASS.success : NOTICE_CLASS.warn}>
                {hasPrivateKey && readMeshcoreIdentity()?.public_key
                  ? t('connectionPanel.meshcoreMqttIdentity.hasPrivateKey')
                  : t('connectionPanel.meshcoreMqttIdentity.noPrivateKey')}
              </div>
            )}
          {protocol === 'meshcore' &&
            usesMeshcoreDeviceSigningMqtt(meshcorePreset, meshcoreMqttSettings) &&
            hasPrivateKey &&
            meshcoreClientKeyHex !== '' && (
              <div className="space-y-1">
                <span className={FIELD_LABEL_CLASS}>
                  {t('connectionPanel.meshcoreMqttIdentity.clientKey')}
                </span>
                <CopyField
                  value={meshcoreClientKeyHex}
                  display={shortenClientKey(meshcoreClientKeyHex)}
                  copyLabel={t('connectionPanel.meshcoreMqttIdentity.copyClientKey')}
                />
              </div>
            )}
          {protocol === 'meshcore' && (
            <div className={`flex items-start gap-2 ${NOTICE_CLASS.info}`}>
              <input
                type="checkbox"
                id="meshcore-packet-logger"
                checked={meshcoreMqttSettings.meshcorePacketLoggerEnabled ?? false}
                onChange={(e) => {
                  updateMqtt('meshcorePacketLoggerEnabled', e.target.checked);
                }}
                className={`${CHECKBOX_CLASS} mt-0.5`}
              />
              <label htmlFor="meshcore-packet-logger" className="cursor-pointer leading-snug">
                {t('connectionPanel.meshcorePacketLogger.label', {
                  topic: `{topicPrefix}/meshcore/packets`,
                })}
              </label>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="mqtt-username" className="text-muted text-xs">
                {t('connectionPanel.username')}
              </label>
              <input
                id="mqtt-username"
                type="text"
                value={activeMqttSettings.username}
                onChange={(e) => {
                  updateMqtt('username', e.target.value);
                }}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="mqtt-password" className="text-muted text-xs">
                {t('connectionPanel.password')}
              </label>
              <div className="relative">
                <input
                  id="mqtt-password"
                  type={showMqttPassword ? 'text' : 'password'}
                  value={activeMqttSettings.password}
                  onChange={(e) => {
                    updateMqtt('password', e.target.value);
                  }}
                  className={`${INPUT_CLASS} pr-14`}
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowMqttPassword((v) => !v);
                  }}
                  aria-label={
                    showMqttPassword
                      ? t('connectionPanel.hidePassword')
                      : t('connectionPanel.showPassword')
                  }
                  className="text-muted hover:text-ink-200 absolute top-1/2 right-2.5 -translate-y-1/2 text-xs"
                >
                  {showMqttPassword
                    ? t('connectionPanel.hidePassword')
                    : t('connectionPanel.showPassword')}
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label htmlFor="mqtt-topic-prefix" className="text-muted text-xs">
                {t('connectionPanel.topicPrefix')}
              </label>
              <HelpTooltip
                text={
                  protocol === 'meshtastic'
                    ? t('connectionPanel.topicPrefixHelp.meshtastic')
                    : isDeviceSigningMeshcorePreset(meshcorePreset) ||
                        isIataScopedMeshcoreMqtt(meshcorePreset, activeMqttSettings)
                      ? t('connectionPanel.topicPrefixHelp.meshcoreLetsmesh')
                      : t('connectionPanel.topicPrefixHelp.meshcoreDefault')
                }
              />
            </div>
            <input
              id="mqtt-topic-prefix"
              type="text"
              value={activeMqttSettings.topicPrefix}
              onChange={(e) => {
                updateMqtt('topicPrefix', e.target.value, false);
              }}
              onBlur={() => {
                if (protocol !== 'meshcore') return;
                if (!isIataScopedMeshcoreMqtt(meshcorePreset, activeMqttSettings)) return;
                const parsed = parseMeshcoreIataTopicPrefix(activeMqttSettings.topicPrefix);
                if (parsed.ok && parsed.normalized !== activeMqttSettings.topicPrefix) {
                  updateMqtt('topicPrefix', parsed.normalized, false);
                }
              }}
              className={INPUT_CLASS}
              placeholder={t('connectionPanel.topicPrefixPlaceholder')}
              aria-invalid={
                protocol === 'meshcore' &&
                isIataScopedMeshcoreMqtt(meshcorePreset, activeMqttSettings) &&
                !parseMeshcoreIataTopicPrefix(activeMqttSettings.topicPrefix).ok
              }
            />
            {protocol === 'meshcore' &&
            isIataScopedMeshcoreMqtt(meshcorePreset, activeMqttSettings) &&
            !parseMeshcoreIataTopicPrefix(activeMqttSettings.topicPrefix).ok ? (
              <p className="text-xs text-orange-400" role="alert">
                {t('connectionPanel.topicPrefixInvalidIata')}
              </p>
            ) : null}
            {radioMqttRootDiverges ? (
              <p className="text-xs text-orange-400" role="status">
                {t('connectionPanel.radioMqttRootDivergesWarning', {
                  radioRoot: radioMqttRoot,
                  appPrefix: normalizeMeshtasticMqttTopicPrefix(activeMqttSettings.topicPrefix),
                })}
              </p>
            ) : null}
          </div>
          <Stepper
            id="mqtt-max-retries"
            label={t('connectionPanel.maxRetries')}
            min={1}
            max={MQTT_MAX_RECONNECT_ATTEMPTS}
            value={activeMqttSettings.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS}
            onChange={(value) => {
              updateMqtt('maxRetries', clampMqttMaxRetries(value), false);
            }}
            hint={
              protocol === 'meshcore'
                ? t('connectionPanel.maxRetriesHelp.meshcore')
                : t('connectionPanel.maxRetriesHelp.meshtastic', {
                    max: MQTT_MAX_RECONNECT_ATTEMPTS,
                  })
            }
          />
          {protocol !== 'meshcore' && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <label htmlFor="mqtt-channel-psks" className="text-muted text-xs">
                  {t('connectionPanel.channelPsks')}
                </label>
                <HelpTooltip text={t('connectionPanel.channelPsksHelp')} />
              </div>
              <textarea
                id="mqtt-channel-psks"
                rows={5}
                value={channelPskDraft}
                onChange={(e) => {
                  setChannelPskDraft(e.target.value);
                  setChannelPskWarn(null);
                }}
                onBlur={() => {
                  commitChannelPskDraft();
                }}
                className={`${TEXTAREA_CLASS} resize-none font-mono`}
                placeholder={t('connectionPanel.channelPsksPlaceholder')}
                spellCheck={false}
              />
              {channelPskWarn && (
                <p className="text-xs text-orange-300/90" role="status">
                  {channelPskWarn}
                </p>
              )}
              {showMqttOnlyChannelPskIndexHint && (
                <p className="text-xs text-orange-300/90" role="status">
                  {t('connectionPanel.channelPsksMqttOnlyIndexHint')}
                </p>
              )}
              <p className="text-muted text-xs">
                {t('connectionPanel.channelPsksPrivateUplinkNote')}
              </p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mqttAutoLaunch"
              checked={activeMqttSettings.autoLaunch}
              onChange={(e) => {
                updateMqtt('autoLaunch', e.target.checked, false);
              }}
              className={CHECKBOX_CLASS}
            />
            <label htmlFor="mqttAutoLaunch" className="text-body text-ink-200 cursor-pointer">
              {t('connectionPanel.autoConnect')}
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="primary"
              onClick={async () => {
                setMqttError(null);
                const committedPsks = commitChannelPskDraft();
                const settings: Parameters<typeof window.electronAPI.mqtt.connect>[0] = {
                  ...activeMqttSettings,
                  channelPsks: committedPsks.length > 0 ? committedPsks : undefined,
                  mqttTransportProtocol: protocol === 'meshcore' ? 'meshcore' : 'meshtastic',
                };
                if (protocol === 'meshcore') {
                  const iataPrepared = prepareMeshcoreIataMqttTopicPrefix(meshcorePreset, settings);
                  if (!iataPrepared.ok) {
                    setMqttError(t(iataPrepared.errorKey));
                    return;
                  }
                  if (iataPrepared.changed) {
                    settings.topicPrefix = iataPrepared.topicPrefix;
                    updateMqtt('topicPrefix', iataPrepared.topicPrefix, false);
                  }
                }
                if (
                  protocol === 'meshcore' &&
                  usesMeshcoreDeviceSigningMqtt(meshcorePreset, settings)
                ) {
                  const presetErr = validateLetsMeshPresetConnect(settings);
                  if (presetErr) {
                    setMqttError(presetErr);
                    return;
                  }
                  if (ensureMeshcoreMqttIdentity && !meshcoreIdentityHasFullKeyPair()) {
                    await ensureMeshcoreMqttIdentity();
                  }
                  const identity = await readMeshcoreIdentityAsync();
                  const hasFullIdentity = !!(identity?.private_key && identity?.public_key);
                  if (!hasFullIdentity) {
                    const manualErr = validateLetsMeshManualCredentials(settings);
                    if (manualErr) {
                      setMqttError(manualErr);
                      return;
                    }
                  }
                  if (hasFullIdentity) {
                    try {
                      const u = letsMeshMqttUsernameFromIdentity(identity);
                      if (u) settings.username = u;
                      const { token, expiresAt } = await generateLetsMeshAuthToken(
                        identity,
                        settings.server,
                      );
                      settings.password = token;
                      settings.tokenExpiresAt = expiresAt;
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      setMqttError(t('connectionPanel.authTokenFailed', { message: msg }));
                      console.warn(
                        '[ConnectionPanel] LetsMesh auth token generation failed ' +
                          errLikeToLogString(e),
                      );
                      return;
                    }
                  } else if (!settings.password) {
                    setMqttError(
                      identity?.private_key && !identity?.public_key
                        ? t('connectionPanel.meshcoreMqttIdentity.publicKeyMissing')
                        : identity
                          ? t('connectionPanel.meshcoreMqttIdentity.usernameBuildFailed')
                          : t('connectionPanel.meshcoreMqttIdentity.noIdentity'),
                    );
                    return;
                  }
                }
                window.electronAPI.mqtt.connect(settings).catch((err: unknown) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  setMqttError(msg);
                  console.warn('[ConnectionPanel] mqtt.connect failed: ' + errLikeToLogString(err));
                });
              }}
              disabled={
                mqttStatus === 'connecting' ||
                (protocol === 'meshcore' &&
                  isIataScopedMeshcoreMqtt(meshcorePreset, activeMqttSettings) &&
                  !parseMeshcoreIataTopicPrefix(activeMqttSettings.topicPrefix).ok)
              }
            >
              {t('connectionPanel.connectMqtt')}
            </Button>
            {mqttStatus === 'connecting' && (
              <Button
                aria-label={t('connectionPanel.cancelMqttConnect')}
                onClick={() => {
                  disconnectMqtt('cancel');
                }}
              >
                {t('connectionPanel.cancelMqttConnect')}
              </Button>
            )}
          </div>
        </div>
      </Panel>
    );

  // Portal to body: MeshCore ConnectionPanel stays mounted under a `hidden` ancestor when
  // another protocol tab is active — without a portal the gate would never paint.
  const coloradoRegionGateModal =
    coloradoRegionGateOpen && protocol === 'meshcore'
      ? createPortal(
          <ConfirmModal
            title={t('connectionPanel.coloradoRegionGateTitle')}
            message={t('connectionPanel.coloradoRegionGateMessage')}
            confirmLabel={t('connectionPanel.coloradoRegionGateStay')}
            cancelLabel={t('connectionPanel.coloradoRegionGateSwitch')}
            onConfirm={() => {
              localStorage.setItem(COLORADO_MQTT_REGION_ACK_KEY, '1');
              setColoradoRegionGateOpen(false);
              if (meshcoreMqttSettingsRef.current.autoLaunch) {
                void tryAutoLaunchMqtt('meshcore').catch((err: unknown) => {
                  console.warn(
                    '[ConnectionPanel] MQTT auto-launch after Colorado stay failed: ' +
                      errLikeToLogString(err),
                  );
                });
              }
            }}
            onCancel={() => {
              void (async () => {
                const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                const next = {
                  ...applyMeshcoreMqttPreset('letsmesh', meshcoreMqttSettingsRef.current),
                  username: fromIdentity || meshcoreMqttSettingsRef.current.username,
                };
                setMeshcorePreset('letsmesh');
                setMeshcoreMqttSettings(next);
                localStorage.setItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
                persistMqttSettingsIfChanged(getMqttSettingsStorageKey('meshcore'), next);
                localStorage.setItem(COLORADO_MQTT_REGION_ACK_KEY, '1');
                setColoradoRegionGateOpen(false);
                if (mqttStatus === 'connected' || mqttStatus === 'connecting') {
                  markMqttUserDisconnect();
                  try {
                    await window.electronAPI.mqtt.disconnect('meshcore');
                  } catch (err: unknown) {
                    console.warn(
                      '[ConnectionPanel] mqtt.disconnect after Colorado switch failed: ' +
                        errLikeToLogString(err),
                    );
                  }
                }
                if (next.autoLaunch) {
                  try {
                    await tryAutoLaunchMqtt('meshcore');
                  } catch (err: unknown) {
                    console.warn(
                      '[ConnectionPanel] MQTT auto-launch after Colorado switch failed: ' +
                        errLikeToLogString(err),
                    );
                  }
                }
              })();
            }}
          />,
          document.body,
        )
      : null;

  const connectingRadio = connecting && !isConnected;
  const radioTileDetail = isConnected
    ? [
        state.connectionType
          ? connectionPanelConnectionTypeLabel(t, state.connectionType, protocol)
          : null,
        state.myNodeNum > 0 ? (myNodeLabel ?? formatMeshtasticNodeId(state.myNodeNum)) : null,
      ]
        .filter((part): part is string => !!part)
        .join(' · ')
    : '';
  const statusTiles = (
    <ConnectionStatusTiles
      link={{
        label: t('connectionPanel.tiles.radioLink'),
        icon: <ConnectionIcon type={state.connectionType ?? connectionType} />,
        status: connectingRadio
          ? connectionPanelRadioStatusLabel(t, 'connecting')
          : connectionPanelRadioStatusLabel(t, state.status),
        variant: connectingRadio
          ? 'warn'
          : deviceHeaderVariant(state.status, state.connectionLoss ?? false),
        detail: radioTileDetail || undefined,
      }}
      mqtt={
        capabilities.hasMqttConnectionPanel
          ? {
              status: mqttStatus,
              connectionLoss: mqttConnectionLoss,
              server:
                mqttStatus === 'connected' || mqttStatus === 'connecting'
                  ? `${activeMqttSettings.server}:${activeMqttSettings.port}`
                  : undefined,
            }
          : undefined
      }
      tak={tak}
    />
  );

  const docsLink = (
    <a
      href="https://github.com/Colorado-Mesh/mesh-client/blob/main/docs/troubleshooting.md"
      target="_blank"
      rel="noreferrer"
      className="hover:text-bright-green text-muted text-xs transition-colors"
    >
      {t('diagnosticsPanel.docsLink')}
    </a>
  );

  if (connectingProgressView) {
    return (
      <div className="w-full space-y-4">
        {statusTiles}
        {connectingProgressView}
        {mqttSection}
        {coloradoRegionGateModal}
      </div>
    );
  }

  if (capabilities.hasReticulumInterfaceConfig) {
    return (
      <div className="w-full space-y-4">
        <ReticulumStackPanel
          tak={tak}
          connecting={state.status === 'connecting'}
          stackError={reticulumStackError}
          onOpenReticulumRmapSettings={onOpenReticulumRmapSettings}
          onOpenAppGpsSettings={onOpenAppGpsSettings}
          onOpenAdminBluetooth={onOpenAdminBluetooth}
          onOpenSetupDestination={onOpenReticulumSetupDestination}
          onStartStack={async () => {
            setReticulumStackError(null);
            try {
              await onStartReticulumStack?.();
            } catch (err: unknown) {
              setReticulumStackError(humanizeReticulumSidecarError(err, t));
              throw err;
            }
          }}
          onStopStack={async () => {
            setReticulumStackError(null);
            await onDisconnect();
          }}
        />
      </div>
    );
  }

  // ─── Connected View ────────────────────────────────────────────
  if (isConnected) {
    const mqttActive = mqttStatus === 'connected' || mqttStatus === 'connecting';
    const disconnectRadio = () => {
      onDisconnect().catch((err: unknown) => {
        console.warn('[ConnectionPanel] radio disconnect failed: ' + errLikeToLogString(err));
      });
    };
    const radioDisconnectEntries: MenuEntry[] = [
      {
        id: 'disconnect-all',
        label: t('connectionPanel.disconnectAll'),
        onSelect: () => {
          disconnectMqtt('disconnect all');
          disconnectRadio();
        },
      },
    ];
    const unplugIcon = <Unplug aria-hidden className={ICON_MD} size={16} />;
    return (
      <div className="w-full space-y-4">
        {statusTiles}
        {renderAutoReconnectBanner()}

        {/* Radio and MQTT side by side on wide windows (Option B), stacked below xl. */}
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <Panel
            title={t('connectionPanel.radioConnection')}
            actions={
              <>
                {docsLink}
                {mqttActive ? (
                  <SplitButton
                    variant="danger"
                    label={t('connectionPanel.disconnectRadio')}
                    icon={unplugIcon}
                    onClick={disconnectRadio}
                    groupLabel={t('connectionPanel.disconnectRadioGroup')}
                    menuTriggerLabel={t('connectionPanel.moreDisconnectOptions')}
                    menuLabel={t('connectionPanel.disconnectOptions')}
                    entries={radioDisconnectEntries}
                  />
                ) : (
                  <Button variant="danger" size="sm" icon={unplugIcon} onClick={disconnectRadio}>
                    {t('connectionPanel.disconnectRadio')}
                  </Button>
                )}
              </>
            }
          >
            <div className="space-y-5">
              <LabelValueGrid>
                <LabelValue label={t('connectionPanel.connectionType')}>
                  {state.connectionType
                    ? connectionPanelConnectionTypeLabel(t, state.connectionType, protocol)
                    : null}
                </LabelValue>
                {state.connectionType === 'ble' && lastBleIdentity ? (
                  <LabelValue
                    label={t(
                      lastBleIdentity.isMac
                        ? 'connectionPanel.bluetoothMac'
                        : 'connectionPanel.bluetoothId',
                    )}
                    mono
                  >
                    {lastBleIdentity.display}
                  </LabelValue>
                ) : null}
                {state.myNodeNum > 0 && (
                  <LabelValue label={t('connectionPanel.myNode')} mono>
                    {myNodeLabel ?? formatMeshtasticNodeId(state.myNodeNum)}
                  </LabelValue>
                )}
                {state.myNodeNum > 0 && state.batteryPercent !== undefined && (
                  <LabelValue label={t('connectionPanel.battery')}>
                    <ConnectionBatteryGauge
                      percent={state.batteryPercent}
                      charging={state.batteryCharging === true}
                    />
                  </LabelValue>
                )}
                {state.firmwareVersion && (
                  <LabelValue label={t('connectionPanel.firmware')}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-body-lg font-mono">{state.firmwareVersion}</span>
                      {firmwareCheckState && onOpenFirmwareReleases && (
                        <FirmwareStatusIndicator
                          phase={firmwareCheckState.phase}
                          latestVersion={firmwareCheckState.latestVersion}
                          onOpenReleases={onOpenFirmwareReleases}
                        />
                      )}
                    </span>
                  </LabelValue>
                )}
                {state.lastDataReceived && (
                  <LabelValue label={t('connectionPanel.lastData')}>
                    {formatDisplayTime(state.lastDataReceived, { use24Hour: use24HourTime })}
                  </LabelValue>
                )}
              </LabelValueGrid>
              {hostLinkMeter.kind != null && (
                <ConnectionLinkMeter
                  kind={hostLinkMeter.kind}
                  rssi={hostLinkMeter.rssi}
                  rttMs={hostLinkMeter.rttMs}
                  level={hostLinkMeter.level}
                />
              )}
              {onToggleManualContacts !== undefined && (
                <div className="border-ink-800 border-t pt-4">
                  <Switch
                    checked={manualAddContacts ?? false}
                    onChange={(next) => {
                      onToggleManualContacts(next).catch((err: unknown) => {
                        console.warn(
                          '[ConnectionPanel] manual contact approval toggle failed: ' +
                            errLikeToLogString(err),
                        );
                      });
                    }}
                    label={t('connectionPanel.manualContactApproval')}
                    description={t('connectionPanel.manualContactApprovalDesc')}
                  />
                </div>
              )}
            </div>
          </Panel>

          {mqttSection}
        </div>
        {coloradoRegionGateModal}
      </div>
    );
  }

  // ─── Disconnected View ─────────────────────────────────────────
  const showLastConnection = lastConnection !== null && !connecting;
  const connectionTypeOptions: SegmentedOption<ConnectionType>[] = (
    protocol === 'meshtastic'
      ? (['ble', 'serial', 'http', 'tcp'] as const)
      : (['ble', 'serial', 'http'] as const)
  ).map((type) => ({
    value: type,
    label: connectionPanelConnectionTypeLabel(t, type, protocol),
    icon: <ConnectionIcon type={type} />,
  }));
  return (
    <div className="w-full space-y-4">
      {statusTiles}
      {renderAutoReconnectBanner()}

      {/* Last Connection — one-click reconnect card */}
      {showLastConnection && (
        <div className="bg-deep-black border-ink-800 flex flex-wrap items-center gap-3 rounded-xl border px-4.5 py-4">
          <span className="bg-sidebar-active-bg text-ink-300 flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px]">
            <ConnectionIcon type={lastConnection.type} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-muted text-xs">{t('connectionPanel.lastConnectionLabel')}</p>
            <p className="text-ink-200 truncate text-sm font-semibold">
              {lastConnection.type === 'ble'
                ? (lastConnection.bleDeviceName ?? t('connectionPanel.bluetoothDevice'))
                : lastConnection.type === 'serial'
                  ? t('connectionPanel.serialDevice')
                  : (lastConnection.httpAddress ?? t('connectionPanel.wifiDevice'))}
            </p>
            {lastConnection.type === 'ble' && lastBleIdentity ? (
              <p className="text-muted font-mono text-xs">{lastBleIdentity.display}</p>
            ) : (
              <p className="text-muted text-xs">
                {connectionPanelConnectionTypeLabel(t, lastConnection.type, protocol)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearLastConnection(protocol);
                setLastConnection(null);
              }}
            >
              {t('connectionPanel.forgetDevice')}
            </Button>
            <Button variant="primary" onClick={handleReconnect}>
              {t('connectionPanel.reconnect')}
            </Button>
          </div>
        </div>
      )}

      {/* Radio and MQTT side by side on wide windows (Option B), stacked below xl. */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Panel title={t('connectionPanel.radioConnection')} actions={docsLink}>
          <div className="max-w-3xl space-y-4">
            {error && (
              <div role="alert" className={NOTICE_CLASS.error}>
                {error}
              </div>
            )}

            {showRePairButton && (isLinux || isWindows) && connectionType === 'ble' && (
              <Button variant="primary" onClick={handleRePair}>
                {t('connectionPanel.rePairDevice')}
              </Button>
            )}

            {/* PIN input prompt for Linux BLE pairing (disconnected view) */}
            {showPinPrompt && (
              <div className={NOTICE_CLASS.info}>
                {renderPinForm(() => {
                  void handlePinSubmit();
                })}
              </div>
            )}

            <fieldset className="min-w-0 space-y-2 border-0 p-0">
              <legend className={`${FIELD_LABEL_CLASS} mb-2`}>
                {t('connectionPanel.connectionType')}
              </legend>
              <SegmentedControl
                size="md"
                aria-label={t('connectionPanel.connectionType')}
                value={connectionType}
                onChange={setConnectionType}
                options={connectionTypeOptions}
              />
            </fieldset>

            {/* HTTP / TCP address input */}
            {connectionType === 'http' && protocol === 'meshtastic' && (
              <div className="max-w-md space-y-1">
                <label htmlFor="connection-meshtastic-host" className="text-muted text-xs">
                  {t('connectionPanel.deviceAddress')}
                </label>
                <input
                  id="connection-meshtastic-host"
                  type="text"
                  value={httpAddress}
                  onChange={(e) => {
                    setHttpAddress(e.target.value);
                  }}
                  placeholder={t('connectionPanel.deviceAddressPlaceholder')}
                  className={INPUT_CLASS}
                  autoComplete="off"
                />
                <p className="text-muted text-xs">{t('connectionPanel.deviceAddressHint')}</p>
                {navigator.userAgent.toLowerCase().includes('windows') && (
                  <p className="text-xs text-orange-400">{t('connectionPanel.windowsMdnsNote')}</p>
                )}
              </div>
            )}
            {connectionType === 'tcp' && protocol === 'meshtastic' && (
              <div className="max-w-md space-y-1">
                <label htmlFor="connection-meshtastic-tcp-host" className="text-muted text-xs">
                  {t('connectionPanel.deviceAddress')}
                </label>
                <input
                  id="connection-meshtastic-tcp-host"
                  type="text"
                  value={tcpAddress}
                  onChange={(e) => {
                    setTcpAddress(e.target.value);
                  }}
                  placeholder={t('connectionPanel.tcpAddressPlaceholder')}
                  className={INPUT_CLASS}
                  autoComplete="off"
                />
                <p className="text-muted text-xs">{t('connectionPanel.tcpAddressHint')}</p>
              </div>
            )}
            {connectionType === 'http' && protocol === 'meshcore' && (
              <div className="max-w-md space-y-1">
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <label htmlFor="connection-meshcore-tcp-host" className="text-muted text-xs">
                      {t('connectionPanel.meshcoreHost')}
                    </label>
                    <input
                      id="connection-meshcore-tcp-host"
                      type="text"
                      value={tcpHost}
                      onChange={(e) => {
                        setTcpHost(e.target.value);
                      }}
                      placeholder={t('connectionPanel.meshcoreHostPlaceholder')}
                      className={INPUT_CLASS}
                      autoComplete="off"
                      aria-label={t('connectionPanel.meshcoreHost')}
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <label htmlFor="connection-meshcore-tcp-port" className="text-muted text-xs">
                      {t('connectionPanel.meshcorePort')}
                    </label>
                    <input
                      id="connection-meshcore-tcp-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={tcpPortStr}
                      onChange={(e) => {
                        setTcpPortStr(e.target.value);
                      }}
                      className={INPUT_CLASS}
                      aria-label={t('connectionPanel.meshcorePort')}
                    />
                  </div>
                </div>
                <p className="text-muted text-xs">{t('connectionPanel.meshcoreHostHint')}</p>
              </div>
            )}

            {/* Connection hints */}
            <div className={`space-y-1 ${NOTICE_CLASS.info}`}>
              {connectionType === 'ble' && protocol === 'meshtastic' && (
                <>
                  <p>{t('connectionPanel.hintMeshtasticBle1')}</p>
                  <p>{t('connectionPanel.hintMeshtasticBle2')}</p>
                </>
              )}
              {connectionType === 'ble' && protocol === 'meshcore' && (
                <>
                  <p>{t('connectionPanel.hintMeshcoreBle1')}</p>
                  <p>{t('connectionPanel.hintMeshcoreBle2')}</p>
                </>
              )}
              {connectionType === 'serial' && protocol === 'meshtastic' && (
                <>
                  <p>{t('connectionPanel.hintMeshtasticSerial1')}</p>
                  <p>{t('connectionPanel.hintMeshtasticSerial2')}</p>
                </>
              )}
              {connectionType === 'serial' && protocol === 'meshcore' && (
                <>
                  <p>{t('connectionPanel.hintMeshcoreSerial1')}</p>
                  <p>{t('connectionPanel.hintMeshcoreSerial2')}</p>
                </>
              )}
              {connectionType === 'http' && protocol === 'meshtastic' && (
                <>
                  <p>{t('connectionPanel.hintMeshtasticHttp1')}</p>
                  <p>{t('connectionPanel.hintMeshtasticHttp2')}</p>
                </>
              )}
              {connectionType === 'tcp' && protocol === 'meshtastic' && (
                <>
                  <p>{t('connectionPanel.hintMeshtasticTcp1')}</p>
                  <p>{t('connectionPanel.hintMeshtasticTcp2')}</p>
                </>
              )}
              {connectionType === 'http' && protocol === 'meshcore' && (
                <p>{t('connectionPanel.hintMeshcoreHttp')}</p>
              )}
            </div>

            {/* Connect button: primary unless the last-connection card already offers Reconnect */}
            <div className="pt-1">
              <Button
                variant={showLastConnection ? 'secondary' : 'primary'}
                onClick={handleConnect}
                disabled={
                  connecting ||
                  state.status === 'connecting' ||
                  ((connectionType === 'http' || connectionType === 'tcp') &&
                    !activeHostAddress.trim())
                }
              >
                {t('connectionPanel.connectButton')}
              </Button>
            </div>
          </div>
        </Panel>

        {mqttSection}
      </div>
      {coloradoRegionGateModal}
    </div>
  );
}
