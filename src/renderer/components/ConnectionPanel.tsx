/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs */
import { PARENT_HOVER_ATTR, Unplug } from 'lucide-react-motion';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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
import { removeRendererStorageItem, setRendererStorageItem } from '@/renderer/lib/rendererStorage';
import type { RfConnectAutomaticFn, RfConnectFn } from '@/renderer/lib/rfConnectionTypes';
import {
  cancelAllLoraRfAutoConnect,
  listInAppSerialHolders,
  peekLastSerialClaimPort,
} from '@/renderer/lib/serialPortClaim';
import { isPairingRelatedError } from '@/shared/blePairingError';
import {
  LETSMESH_MQTT_AUTH_DOCS_URL,
  MESHCORE_DOCS_URL,
  MESHTASTIC_DOCS_URL,
  troubleshootingDocsUrl,
} from '@/shared/docsSite';
import type { GattBleDevice } from '@/shared/electron-api.types';
import {
  MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS,
  MAX_MESHCORE_MQTT_PUBLISH_FEEDS,
  MESHCORE_MQTT_CHAT_CONNECTION_ID,
} from '@/shared/meshcoreMqttConnections';
import {
  clampMqttMaxRetries,
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '@/shared/meshtasticMqttReconnect';
import { mqttUsesTls } from '@/shared/mqttTls';
import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';
import {
  bleIdsMatch,
  type BlePickerIdentity,
  isTwelveHexBleMac,
  normalizeBleMac,
  resolveBlePickerIdentity,
} from '@/shared/normalizeBleMac';
import { clampTcpPort, parseTcpPortFromString } from '@/shared/tcpPort';

import { useActiveMeshIdentity } from '../hooks/useActiveMeshIdentity';
import { useHostLinkMeter } from '../hooks/useHostLinkMeter';
import { useNowMs } from '../hooks/useNowMs';
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
  connectionHistoryIdentityKey,
  deleteConnectionHistory,
  isConnectionHistoryProtocol,
  loadConnectionHistory,
  type SavedConnection,
  savedConnectionPrimaryLabel,
  upsertConnectionHistory,
} from '../lib/connectionHistoryStorage';
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
  type BleSelectionClearedDetail,
  clearLastConnection,
  resolveLastSerialPortId,
  resolveMeshcomKissReconnectAddress,
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
import { parseBluetoothctlPairedState } from '../lib/linuxBlePairingInfo';
import { looksLikeRnodeBleName, meshcomBlePickerDisplayName } from '../lib/meshcom/meshcomBleName';
import {
  getMeshcomNetworkTime,
  subscribeMeshcomNetworkTime,
} from '../lib/meshcom/meshcomNetworkTime';
import {
  getMeshcomNodePasswd,
  meshcomAuthTransportFromConnectionType,
  setMeshcomNodePasswd,
} from '../lib/meshcom/meshcomNodePasswd';
import { shouldOpenMeshcomMqttPanel } from '../lib/meshcomMqttPanelOpen';
import { MESHCOM_MQTT_SETTINGS_KEY } from '../lib/meshcomMqttSettingsStorage';
import { translateMeshcoreUserMessage } from '../lib/meshcore/meshcoreMessageI18n';
import { connectMeshcoreMqttFeed } from '../lib/meshcoreMqttConnect';
import {
  canEnableMeshcoreMqttFeed,
  createMeshcoreMqttFeed,
  deleteMeshcoreMqttFeed,
  loadMeshcoreMqttFeeds,
  MESHCORE_MQTT_FEED_NAME_MAX_LENGTH,
  meshcoreFeedOverrideWarning,
  type MeshcoreMqttFeed,
  persistMeshcoreMqttFeeds,
  updateMeshcoreMqttFeed,
} from '../lib/meshcoreMqttFeeds';
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
  MeshProtocol,
  MQTTSettings,
  MQTTStatus,
  SerialPortInfo,
} from '../lib/types';
import {
  clearWindowsBleReconnectSkip,
  getWindowsBlePairState,
  pairWindowsBle,
  peekWindowsBleReconnectSkip,
  shouldOfferWindowsRePair,
  subscribeWindowsBleReconnectSkip,
  unpairWindowsBle,
  windowsPairingFailureMessage,
} from '../lib/windowsBlePairing';
import { useDeviceStore } from '../stores/deviceStore';
import { useMeshcoreMqttFeedStatusStore } from '../stores/meshcoreMqttFeedStatusStore';
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
import { MeshComConnectionHints } from './MeshComConnectionHints';
import { MqttNetworkPresetSelect } from './MqttNetworkPresetSelect';
import { MqttProfileControls } from './MqttProfileControls';
import { PickerSortControls } from './PickerSortControls';
import type { ReticulumSetupDestination } from './reticulum/ReticulumSetupGuide';
import { ReticulumStackPanel } from './ReticulumStackPanel';
import SignalBars from './SignalBars';
import { Button } from './ui/Button';
import { CopyField } from './ui/CopyField';
import { DocsSiteLink } from './ui/DocsSiteLink';
import {
  CHECKBOX_CLASS,
  chipClass,
  FIELD_LABEL_CLASS,
  INPUT_CLASS,
  NOTICE_CLASS,
  SELECT_CLASS,
  TEXTAREA_CLASS,
} from './ui/formClasses';
import { LabelValue, LabelValueGrid } from './ui/LabelValue';
import { type MenuEntry, SplitButton } from './ui/Menu';
import { Panel } from './ui/Panel';
import { SegmentedControl, type SegmentedOption } from './ui/SegmentedControl';
import { SettingsCollapsible } from './ui/SettingsSection';
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
  /** Last known BLE host RSSI (dBm) for Connection panel seed after reconnect. */
  bleRssi?: number;
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
  // High-confidence pairing indicators only; avoid broad "connection failed" matching.
  return (
    pairingFlag ||
    domPairingSignal ||
    /GATT Error:\s*Not supported/i.test(rawMessage) ||
    /authentication failed/i.test(rawMessage) ||
    /not be properly paired/i.test(bleErrMsg) ||
    /pairing issue/i.test(rawMessage)
  );
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

/** BLE pairing PIN: 1–6 digits (BlueZ / WinRT; MeshCore may show shorter codes). */
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
    setRendererStorageItem(lastConnectionKey(p), JSON.stringify(c));
  } catch (e) {
    console.debug('[ConnectionPanel] saveLastConnection ' + errLikeToLogString(e));
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
    setRendererStorageItem(lastBleDeviceKey(protocol), id);
  } catch (e) {
    console.debug('[ConnectionPanel] saveLastBleDevice ' + errLikeToLogString(e));
  }
}

function clearLastBleDevice(protocol: MeshProtocol) {
  try {
    removeRendererStorageItem(lastBleDeviceKey(protocol));
  } catch (e) {
    console.debug('[ConnectionPanel] clearLastBleDevice ' + errLikeToLogString(e));
  }
}

function saveLastSerialPort(id: string) {
  try {
    setRendererStorageItem(LAST_SERIAL_PORT_KEY, id);
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
  // Do not borrow another row's remembered BLE id when this record only has a MAC.
  const deviceId =
    last?.bleDeviceId?.trim() || (last == null ? (loadLastBleDevice(protocol) ?? '') : '');
  if (!deviceId && !last?.bleMac) return null;
  const identity = resolveBlePickerIdentity({
    deviceId,
    address: last?.bleMac,
    cachedMac: deviceId ? getBleDeviceMac(deviceId) : null,
  });
  return identity.display ? identity : null;
}

/** BLE reconnect id from the row itself — never another row's remembered device. */
function resolveSavedBleConnectId(target: LastConnection): string | null {
  const deviceId = target.bleDeviceId?.trim();
  if (deviceId) return deviceId;
  const mac = target.bleMac?.trim();
  if (mac && isTwelveHexBleMac(mac)) return normalizeBleMac(mac);
  return null;
}

/** Accessible name for saved-device actions; append BLE identity only when it adds information. */
function savedDeviceActionName(primary: string, bleIdentity: BlePickerIdentity | null): string {
  const identity = bleIdentity?.display?.trim();
  if (!identity) return primary;
  if (primary === identity) return primary;
  if (primary.toLowerCase().includes(identity.toLowerCase())) return primary;
  return `${primary} (${identity})`;
}

const LETS_MESH_USERNAME_SYNC_DEBOUNCE_MS = 100;

function loadMqttSettings(): MQTTSettings {
  return loadProtocolMqttSettings('meshtastic');
}

function loadMeshcoreMqttSettings(): MQTTSettings {
  return loadProtocolMqttSettings('meshcore');
}

function loadMeshcomMqttSettings(): MQTTSettings {
  return loadProtocolMqttSettings('meshcom');
}

export interface Props {
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
    if (last?.httpAddress && (last.type === 'http' || last.type === 'udp')) {
      return last.httpAddress;
    }
    if (protocol === 'meshcom') return '127.0.0.1:8001';
    return 'meshtastic.local';
  });
  const [tcpAddress, setTcpAddress] = useState(() => {
    // Meshtastic native TCP only — MeshCom KISS uses httpAddress / host:port fields.
    if (protocol !== 'meshtastic') return 'meshtastic.local:4403';
    const last = loadLastConnection(protocol);
    return last?.type === 'tcp' && last.httpAddress ? last.httpAddress : 'meshtastic.local:4403';
  });
  const [tcpHost, setTcpHost] = useState(() => {
    const last = loadLastConnection(protocol);
    if (
      last?.httpAddress &&
      (protocol === 'meshcore' || protocol === 'meshcom') &&
      (last.type === 'http' || last.type === 'tcp' || last.type === 'udp')
    ) {
      return parseTcpAddress(last.httpAddress).host;
    }
    return 'localhost';
  });
  const [tcpPortStr, setTcpPortStr] = useState<string>(() => {
    const last = loadLastConnection(protocol);
    if (last?.type === 'http' && last.httpAddress && protocol === 'meshcore') {
      return String(parseTcpAddress(last.httpAddress).port);
    }
    if (
      last?.httpAddress &&
      protocol === 'meshcom' &&
      (last.type === 'http' || last.type === 'udp')
    ) {
      return String(parseTcpAddress(last.httpAddress).port);
    }
    return protocol === 'meshcom' ? '8001' : '5000';
  });
  const tcpPort = parseTcpPortFromString(tcpPortStr, protocol === 'meshcom' ? 8001 : 5000);
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
      : protocol === 'meshcom'
        ? httpAddress
        : connectionType === 'tcp' || state.connectionType === 'tcp'
          ? tcpAddress
          : httpAddress;
  // ─── MQTT settings state ───────────────────────────────────────
  const [mqttSettings, setMqttSettings] = useState<MQTTSettings>(loadMqttSettings);
  const [meshcoreMqttSettings, setMeshcoreMqttSettings] =
    useState<MQTTSettings>(loadMeshcoreMqttSettings);
  const [meshcomMqttSettings, setMeshcomMqttSettings] =
    useState<MQTTSettings>(loadMeshcomMqttSettings);
  const [showMqttPassword, setShowMqttPassword] = useState(false);
  const [meshcomNodePassword, setMeshcomNodePassword] = useState('');
  const [showMeshcomNodePassword, setShowMeshcomNodePassword] = useState(false);
  // Load/clear the MeshCom node password for the currently selected host + transport.
  useEffect(() => {
    if (protocol !== 'meshcom') {
      setMeshcomNodePassword('');
      return;
    }
    const authTransport = meshcomAuthTransportFromConnectionType(connectionType);
    if (!authTransport) {
      setMeshcomNodePassword('');
      return;
    }
    setMeshcomNodePassword(getMeshcomNodePasswd(authTransport, httpAddress));
  }, [protocol, connectionType, httpAddress]);
  const [mqttError, setMqttError] = useState<string | null>(null);
  const [mqttWarning, setMqttWarning] = useState<string | null>(null);
  const [channelPskWarn, setChannelPskWarn] = useState<string | null>(null);
  const [channelPskDraft, setChannelPskDraft] = useState(() =>
    formatChannelPskInput(
      (protocol === 'meshcore'
        ? loadMeshcoreMqttSettings()
        : protocol === 'meshcom'
          ? loadMeshcomMqttSettings()
          : loadMqttSettings()
      ).channelPsks,
    ),
  );
  const mqttSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meshcoreMqttSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meshcomMqttSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mqttSettingsRef = useRef(mqttSettings);
  mqttSettingsRef.current = mqttSettings;
  const meshcoreMqttSettingsRef = useRef(meshcoreMqttSettings);
  meshcoreMqttSettingsRef.current = meshcoreMqttSettings;
  const meshcomMqttSettingsRef = useRef(meshcomMqttSettings);
  meshcomMqttSettingsRef.current = meshcomMqttSettings;
  const [meshcorePreset, setMeshcorePreset] = useState<MeshcoreMqttPreset>(() =>
    readStoredMeshcoreMqttPreset(),
  );
  // ─── MeshCore analyzer feeds (publish-only extra brokers) ──────────
  const [meshcoreFeeds, setMeshcoreFeeds] = useState<MeshcoreMqttFeed[]>(() =>
    loadMeshcoreMqttFeeds(),
  );
  const [meshcoreEditorTarget, setMeshcoreEditorTarget] = useState<string>(
    MESHCORE_MQTT_CHAT_CONNECTION_ID,
  );
  const [meshcoreFeedNameDraft, setMeshcoreFeedNameDraft] = useState('');
  const [meshcoreFeedError, setMeshcoreFeedError] = useState<string | null>(null);
  const meshcoreFeedStatuses = useMeshcoreMqttFeedStatusStore((s) => s.statuses);
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
  const [mqttProfiles, setMqttProfiles] = useState<MqttProfile[]>(() =>
    loadMqttProfiles('meshtastic'),
  );
  const mqttProfilesRef = useRef(mqttProfiles);
  mqttProfilesRef.current = mqttProfiles;
  const persistedMqttProfilesRef = useRef(mqttProfiles);
  const mqttProfileSaveRequestRef = useRef(0);
  const [meshcomMqttProfiles, setMeshcomMqttProfiles] = useState<MqttProfile[]>(() =>
    loadMqttProfiles('meshcom'),
  );
  const meshcomMqttProfilesRef = useRef(meshcomMqttProfiles);
  meshcomMqttProfilesRef.current = meshcomMqttProfiles;
  const persistedMeshcomMqttProfilesRef = useRef(meshcomMqttProfiles);
  const meshcomMqttProfileSaveRequestRef = useRef(0);
  // Profile chosen while connected whose broker/credentials differ; applied once MQTT disconnects
  // so the live session's settings and matched profile stay accurate.
  const [pendingMqttProfile, setPendingMqttProfile] = useState<MqttProfile | null>(null);
  const activeMqttProfile = useMemo(
    () =>
      protocol === 'meshcom'
        ? matchMqttProfile(meshcomMqttProfiles, meshcomMqttSettings)
        : matchMqttProfile(mqttProfiles, mqttSettings),
    [protocol, meshcomMqttProfiles, meshcomMqttSettings, mqttProfiles, mqttSettings],
  );
  const updateMqttProfiles = (next: MqttProfile[]) => {
    const requestId = ++mqttProfileSaveRequestRef.current;
    mqttProfilesRef.current = next;
    setMqttProfiles(next);
    void saveMqttProfiles(next, 'meshtastic')
      .then(() => {
        persistedMqttProfilesRef.current = next;
      })
      .catch((e: unknown) => {
        console.warn(
          'mcL0398 [ConnectionPanel] MQTT profile persistence failed ' + errLikeToLogString(e),
        );
        if (mqttProfileSaveRequestRef.current === requestId) {
          const persisted = persistedMqttProfilesRef.current;
          mqttProfilesRef.current = persisted;
          setMqttProfiles(persisted);
        }
      });
  };
  const updateMeshcomMqttProfiles = (next: MqttProfile[]) => {
    const requestId = ++meshcomMqttProfileSaveRequestRef.current;
    meshcomMqttProfilesRef.current = next;
    setMeshcomMqttProfiles(next);
    void saveMqttProfiles(next, 'meshcom')
      .then(() => {
        persistedMeshcomMqttProfilesRef.current = next;
      })
      .catch((e: unknown) => {
        console.warn(
          'mcL0399 [ConnectionPanel] MeshCom MQTT profile persistence failed ' +
            errLikeToLogString(e),
        );
        if (meshcomMqttProfileSaveRequestRef.current === requestId) {
          const persisted = persistedMeshcomMqttProfilesRef.current;
          meshcomMqttProfilesRef.current = persisted;
          setMeshcomMqttProfiles(persisted);
        }
      });
  };
  // Async topic updates apply only if they are still the latest selection on a live session.
  const mqttProfileRequestRef = useRef(0);
  const mqttStatusRef = useRef(mqttStatus);
  useEffect(() => {
    mqttStatusRef.current = mqttStatus;
    // Replies from a prior session must not apply after a reconnect.
    if (mqttStatus !== 'connected') mqttProfileRequestRef.current++;
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
        console.warn(
          'mcL0400 [ConnectionPanel] MQTT profile topic prefix rejected for live session',
        );
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
          console.warn(
            'mcL0401 [ConnectionPanel] mqtt.updateTopicPrefix failed ' + errLikeToLogString(e),
          );
        });
      return;
    }
    setPendingMqttProfile(null);
    setMeshtasticPreset('custom');
    setMqttSettings(next);
  };

  useEffect(() => {
    if (mqttStatus !== 'disconnected' || !pendingMqttProfile) return;
    if (protocol === 'meshcom') {
      setMeshcomMqttSettings((prev) => applyMqttProfile(prev, pendingMqttProfile));
    } else {
      setMeshtasticPreset('custom');
      setMqttSettings((prev) => applyMqttProfile(prev, pendingMqttProfile));
    }
    setPendingMqttProfile(null);
  }, [mqttStatus, pendingMqttProfile, protocol]);

  const applyMeshcomMqttProfile = (profile: MqttProfile) => {
    if (mqttStatus === 'connecting') return;
    const next = applyMqttProfile(meshcomMqttSettings, profile);
    const effect = mqttProfileApplyEffect(meshcomMqttSettings, next);
    // MeshCom has no live topicPrefix IPC — any live change needs reconnect.
    if (mqttStatus === 'connected' && effect !== 'none') {
      setPendingMqttProfile(profile);
      return;
    }
    setPendingMqttProfile(null);
    setMeshcomMqttSettings(next);
  };

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
    setRendererStorageItem('mesh-client:mqttPreset:meshcore', meshcorePreset);
  }, [meshcorePreset]);

  // Persist analyzer feeds (metadata sync + credentials via the secure service). Skip the first
  // render so a tab switch does not rewrite an unchanged feed list.
  const meshcoreFeedsHydratedRef = useRef(false);
  useEffect(() => {
    if (!meshcoreFeedsHydratedRef.current) {
      meshcoreFeedsHydratedRef.current = true;
      return;
    }
    persistMeshcoreMqttFeeds(meshcoreFeeds);
  }, [meshcoreFeeds]);

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

  // Persist MeshCom MQTT settings with debounce
  useEffect(() => {
    if (meshcomMqttSaveTimerRef.current) clearTimeout(meshcomMqttSaveTimerRef.current);
    meshcomMqttSaveTimerRef.current = setTimeout(() => {
      persistMqttSettingsIfChanged(MESHCOM_MQTT_SETTINGS_KEY, meshcomMqttSettingsRef.current);
      meshcomMqttSaveTimerRef.current = null;
    }, 300);
    return () => {
      if (meshcomMqttSaveTimerRef.current) {
        clearTimeout(meshcomMqttSaveTimerRef.current);
        meshcomMqttSaveTimerRef.current = null;
      }
    };
  }, [meshcomMqttSettings]);

  useEffect(() => {
    const flushMeshcomMqtt = () => {
      flushPendingMqttSave(
        meshcomMqttSaveTimerRef,
        MESHCOM_MQTT_SETTINGS_KEY,
        meshcomMqttSettingsRef.current,
      );
    };
    window.addEventListener('beforeunload', flushMeshcomMqtt);
    return () => {
      window.removeEventListener('beforeunload', flushMeshcomMqtt);
      flushPendingMqttSave(
        meshcomMqttSaveTimerRef,
        MESHCOM_MQTT_SETTINGS_KEY,
        meshcomMqttSettingsRef.current,
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
          : protocol === 'meshcom'
            ? error
            : meshtasticMqttErrorUserHint(error, t),
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

  // The dropdown can point the editor at the chat broker or one analyzer feed.
  const editingMeshcoreFeed =
    protocol === 'meshcore' && meshcoreEditorTarget !== MESHCORE_MQTT_CHAT_CONNECTION_ID
      ? (meshcoreFeeds.find((feed) => feed.id === meshcoreEditorTarget) ?? null)
      : null;
  const activeMeshcorePreset: MeshcoreMqttPreset = editingMeshcoreFeed
    ? editingMeshcoreFeed.preset
    : meshcorePreset;
  const setActiveMeshcorePreset = (preset: MeshcoreMqttPreset) => {
    if (editingMeshcoreFeed) {
      setMeshcoreFeeds((prev) =>
        prev.map((feed) => (feed.id === editingMeshcoreFeed.id ? { ...feed, preset } : feed)),
      );
      return;
    }
    setMeshcorePreset(preset);
  };

  const activeMqttSettings =
    protocol === 'meshcore'
      ? editingMeshcoreFeed
        ? editingMeshcoreFeed.settings
        : meshcoreMqttSettings
      : protocol === 'meshcom'
        ? meshcomMqttSettings
        : mqttSettings;
  const editingMeshcoreFeedId = editingMeshcoreFeed?.id ?? null;
  const mqttEditTargetRef = useRef<{ protocol: MeshProtocol; feedId: string | null }>(null);
  mqttEditTargetRef.current = { protocol, feedId: editingMeshcoreFeedId };
  const setActiveMqttSettings = useCallback<React.Dispatch<React.SetStateAction<MQTTSettings>>>(
    (value) => {
      const target = mqttEditTargetRef.current;
      if (!target) return;
      if (target.protocol === 'meshcore') {
        if (target.feedId === null) {
          setMeshcoreMqttSettings(value);
          return;
        }
        const feedId = target.feedId;
        setMeshcoreFeeds((prev) =>
          prev.map((feed) => {
            if (feed.id !== feedId) return feed;
            const next = typeof value === 'function' ? value(feed.settings) : value;
            return { ...feed, settings: next };
          }),
        );
        return;
      }
      if (target.protocol === 'meshcom') setMeshcomMqttSettings(value);
      else setMqttSettings(value);
    },
    [setMeshcomMqttSettings, setMqttSettings, setMeshcoreMqttSettings],
  );
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
        setActiveMeshcorePreset('custom');
      } else if (protocol === 'meshtastic') {
        setMeshtasticPreset('custom');
      }
    }
    setActiveMqttSettings((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'autoLaunch' && !editingMeshcoreFeed) {
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
    (device: GattBleDevice) => {
      const cached = bleDeviceNamesCache[device.deviceId];
      if (protocol === 'meshcom') {
        return meshcomBlePickerDisplayName(
          device.deviceId,
          device.deviceName,
          cached,
          blePickerDisplayName,
        );
      }
      return blePickerDisplayName(device.deviceId, device.deviceName, cached);
    },
    [bleDeviceNamesCache, protocol],
  );
  const getBlePickerId = useCallback((device: GattBleDevice) => device.deviceId, []);
  const getBlePickerRssi = useCallback((device: GattBleDevice) => device.rssi, []);
  const sortedBleDevices = useDebouncedPickerSort(
    bleDevices,
    blePickerSort.key,
    blePickerSort.dir,
    { getName: getBlePickerName, getId: getBlePickerId, getRssi: getBlePickerRssi },
  );
  // MeshCom reuses MeshCore NUS scan (unfiltered) — hide obvious RNode adverts so users
  // do not GATT-connect a Reticulum radio and get a silent HELLO (no MeshCom TYP JSON).
  const visibleBleDevices = useMemo(() => {
    if (protocol !== 'meshcom') return sortedBleDevices;
    return sortedBleDevices.filter((d) => !looksLikeRnodeBleName(d.deviceName));
  }, [protocol, sortedBleDevices]);
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
  /** In-flight BLE reconnect target — UI/RSSI only until configure promotes to MRU. */
  const [pendingBleReconnect, setPendingBleReconnect] = useState<LastConnection | null>(null);
  const [connectionHistory, setConnectionHistory] = useState<SavedConnection[]>(() =>
    loadConnectionHistory(protocol),
  );
  const bleHostSeedRssi = useMemo(() => {
    if (state.connectionType !== 'ble' && !(connecting && connectionType === 'ble')) {
      return null;
    }
    const id = lastConnection?.bleDeviceId ?? loadLastBleDevice(protocol);
    if (id) {
      const found = bleDevices.find((d) => d.deviceId === id);
      if (found?.rssi != null && Number.isFinite(found.rssi)) return found.rssi;
    }
    const stored = lastConnection?.bleRssi;
    return stored != null && Number.isFinite(stored) ? stored : null;
  }, [
    bleDevices,
    connecting,
    connectionType,
    lastConnection?.bleDeviceId,
    lastConnection?.bleRssi,
    protocol,
    state.connectionType,
  ]);
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
    bleSeedRssi: bleHostSeedRssi,
  });
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
   * Linux (BlueZ D-Bus) / Windows (WinRT in-app) pairing completes before opening the
   * sidecar GATT session.
   */
  const pendingPairBleDeviceRef = useRef<{ deviceId: string } | null>(null);
  const windowsReconnectAttemptRef = useRef<object | null>(null);
  /** Saved-devices row id chosen for reconnect — configure updates that row instead of duplicating. */
  const pendingHistoryRowIdRef = useRef<string | null>(null);
  const clearPendingHistoryReplace = useCallback(() => {
    pendingHistoryRowIdRef.current = null;
  }, []);
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
  /** Track displayed protocol so MeshCore-only storage clears skip when the panel switched away. */
  const displayedProtocolRef = useRef(protocol);
  displayedProtocolRef.current = protocol;

  const clearMeshcoreBleSelectionOnMissingServices = useCallback(
    (err: unknown, failedEndpoint?: LastConnection | null) => {
      if (protocol !== 'meshcore' || !shouldClearMeshcoreBleSelectionForError(err)) return;
      const endpoint = failedEndpoint ?? pendingBleReconnect ?? lastConnectionRef.current;
      if (endpoint?.type !== 'ble') return;
      const failedKey = connectionHistoryIdentityKey(endpoint, 'meshcore');
      if (!failedKey) return;

      // Clear remembered BLE id only when it belongs to the failed endpoint — keep MRU
      // for a different transport/device (deleteConnectionHistory updates MRU if needed).
      const storedBleId = loadLastBleDevice('meshcore');
      if (storedBleId) {
        const storedKey = connectionHistoryIdentityKey(
          { type: 'ble', bleDeviceId: storedBleId },
          'meshcore',
        );
        if (storedKey === failedKey) clearLastBleDevice('meshcore');
      }

      let next = loadConnectionHistory('meshcore');
      for (const entry of [...next]) {
        if (connectionHistoryIdentityKey(entry, 'meshcore') === failedKey) {
          const deleted = deleteConnectionHistory('meshcore', entry.id);
          if (deleted) next = deleted;
        }
      }

      // MRU may still match the failed endpoint when no history row shared its identity key
      // (e.g. MAC-only MRU vs UUID history). Promote/clear like deleteConnectionHistory.
      const mru = loadLastConnection('meshcore');
      const mruKey = mru ? connectionHistoryIdentityKey(mru, 'meshcore') : null;
      if (mruKey === failedKey) {
        const promoted = next.at(0);
        if (!promoted) {
          clearLastConnection('meshcore');
        } else {
          saveLastConnection('meshcore', {
            type: promoted.type,
            httpAddress: promoted.httpAddress,
            bleDeviceId: promoted.bleDeviceId,
            bleDeviceName: promoted.bleDeviceName,
            bleMac: promoted.bleMac,
            bleRssi: promoted.bleRssi,
            serialPortId: promoted.serialPortId,
          });
        }
      }

      // Panel may have switched protocols while this MeshCore attempt was in flight.
      if (displayedProtocolRef.current !== 'meshcore') return;
      setConnectionHistory(next);
      setLastConnection(loadLastConnection('meshcore'));
      setPendingBleReconnect(null);
    },
    [protocol, pendingBleReconnect, setLastConnection, setConnectionHistory],
  );
  const connectionTypeRef = useRef(connectionType);
  connectionTypeRef.current = connectionType;
  const onAutoConnectRef = useRef(onAutoConnect);
  onAutoConnectRef.current = onAutoConnect;

  // Reload last connection + host fields when protocol switches (one panel instance for all protocols).
  // Without rehydrating tcpHost/httpAddress/tcpAddress, a Meshtastic-first mount leaves MeshCore
  // TCP at default localhost and a later configured-save overwrites the real stored IP.
  // MeshCom must not inherit Meshtastic's native TCP selection (`meshtastic.local:4403`).
  useEffect(() => {
    const loaded = loadLastConnection(protocol);
    setLastConnection(loaded);
    setConnectionHistory(loadConnectionHistory(protocol));
    setPendingBleReconnect(null);
    pendingHistoryRowIdRef.current = null;
    if (protocol === 'meshcore') {
      if (loaded?.type === 'http' && loaded.httpAddress) {
        const { host, port } = parseTcpAddress(loaded.httpAddress);
        setTcpHost(host);
        setTcpPortStr(String(port));
        setConnectionType('http');
      } else if (loaded?.type === 'ble' || loaded?.type === 'serial') {
        setConnectionType(loaded.type);
      } else {
        setConnectionType('ble');
      }
    } else if (protocol === 'meshcom') {
      // KISS is stored as `http`; mistyped tcp with a usable address rehydrates as http.
      // Meshtastic-only tcp bleed is ignored.
      const kissAddr = loaded ? resolveMeshcomKissReconnectAddress(loaded) : null;
      if (loaded?.type === 'netconsole' && loaded.httpAddress) {
        setHttpAddress(loaded.httpAddress);
        setConnectionType('netconsole');
      } else if (kissAddr) {
        setHttpAddress(kissAddr);
        setConnectionType('http');
      } else if (loaded?.type === 'udp' && loaded.httpAddress) {
        setHttpAddress(loaded.httpAddress);
        setConnectionType('udp');
      } else if (loaded?.type === 'ble' || loaded?.type === 'serial') {
        setConnectionType(loaded.type);
      } else {
        setConnectionType('ble');
        setHttpAddress('127.0.0.1:8001');
      }
    } else if (protocol === 'meshtastic') {
      if (loaded?.type === 'http' && loaded.httpAddress) {
        setHttpAddress(loaded.httpAddress);
        setConnectionType('http');
      } else if (loaded?.type === 'tcp' && loaded.httpAddress) {
        setTcpAddress(loaded.httpAddress);
        setConnectionType('tcp');
      } else if (loaded?.type === 'ble' || loaded?.type === 'serial') {
        setConnectionType(loaded.type);
      } else {
        setConnectionType('ble');
        setHttpAddress('meshtastic.local');
        setTcpAddress('meshtastic.local:4403');
      }
    }
  }, [protocol]);

  useEffect(() => {
    const handleBleSelectionCleared = (event: Event) => {
      const detail = (event as CustomEvent<BleSelectionClearedDetail>).detail;
      if (!detail?.protocol || !isConnectionHistoryProtocol(detail.protocol)) return;
      // Always remove the failed endpoint from that protocol's history (even if the panel
      // is showing a different protocol). Refresh the visible list only when it matches.
      const endpoint: LastConnection = {
        type: 'ble',
        bleDeviceId: detail.bleDeviceId,
        bleMac: detail.bleMac,
      };
      const key = connectionHistoryIdentityKey(endpoint, detail.protocol);
      if (key) {
        let next = loadConnectionHistory(detail.protocol);
        for (const entry of [...next]) {
          if (connectionHistoryIdentityKey(entry, detail.protocol) === key) {
            const deleted = deleteConnectionHistory(detail.protocol, entry.id);
            if (deleted) next = deleted;
          }
        }
        if (detail.protocol === protocol) {
          setConnectionHistory(next);
          setLastConnection(loadLastConnection(protocol));
        }
      } else if (detail.protocol === protocol) {
        setConnectionHistory(loadConnectionHistory(protocol));
      }
    };
    window.addEventListener(BLE_SELECTION_CLEARED_EVENT, handleBleSelectionCleared);
    return () => {
      window.removeEventListener(BLE_SELECTION_CLEARED_EVENT, handleBleSelectionCleared);
    };
  }, [protocol, setLastConnection, setConnectionHistory]);

  useEffect(() => {
    // ConnectionPanel is one instance for every protocol. A Windows Reconnect that is
    // still awaiting pair-state must not leave this panel stuck on Connecting.
    pendingPairBleDeviceRef.current = null;
    manualBleScanActiveRef.current = false;
    isAutoConnectingRef.current = false;
    setIsAutoConnecting(false);
    setConnecting(false);
    setConnectionStage('');
    return () => {
      pendingPairBleDeviceRef.current = null;
      manualBleScanActiveRef.current = false;
      windowsReconnectAttemptRef.current = null;
      isAutoConnectingRef.current = false;
    };
  }, [protocol]);

  // Update connection stage based on state transitions, and save last connection on success
  const prevProtocolForSaveRef = useRef(protocol);

  useEffect(() => {
    const protocolChanged = prevProtocolForSaveRef.current !== protocol;
    prevProtocolForSaveRef.current = protocol;

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
      // Persist only on a real configure transition for the visible protocol. Switching the shared
      // panel onto an already-configured radio (or rehydrate updating connectionType afterward)
      // must not rewrite lastConnection with a stale tcpHost/httpAddress.
      const becameConfigured = prevStoreStatusRef.current !== 'configured';
      if (state.connectionType && becameConfigured && !protocolChanged) {
        setPendingBleReconnect(null);
        // MeshCom KISS UI is `http` (`meshcomConnectionType`); never persist native `tcp`.
        const storedType: ConnectionType =
          protocol === 'meshcom' && state.connectionType === 'tcp' ? 'http' : state.connectionType;
        const conn: LastConnection = { type: storedType };
        if (
          state.connectionType === 'http' ||
          state.connectionType === 'tcp' ||
          state.connectionType === 'udp' ||
          state.connectionType === 'netconsole'
        ) {
          // Prefer the address field for the configured transport (not UI radio selection).
          // MeshCom KISS/EXTUDP/NET Console never use Meshtastic native TCP (`tcpAddress` / :4403).
          conn.httpAddress =
            protocol === 'meshcore'
              ? `${tcpHost}:${tcpPort}`
              : protocol === 'meshcom'
                ? httpAddress
                : state.connectionType === 'tcp'
                  ? tcpAddress
                  : httpAddress;
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
            const scanned = bleDevices.find((d) => d.deviceId === bleId)?.rssi;
            const rssiSeed =
              scanned != null && Number.isFinite(scanned)
                ? scanned
                : hostLinkMeter.rssi != null && Number.isFinite(hostLinkMeter.rssi)
                  ? hostLinkMeter.rssi
                  : prev?.bleRssi;
            if (rssiSeed != null && Number.isFinite(rssiSeed)) conn.bleRssi = rssiSeed;
          }
        } else if (state.connectionType === 'serial') {
          const serialId =
            lastConnectionRef.current?.serialPortId?.trim() || resolveLastSerialPortId(protocol);
          if (serialId) conn.serialPortId = serialId;
        }
        saveLastConnection(protocol, conn);
        setLastConnection(conn);
        // Auto-save into multi-device history (all transports); MRU stays in lastConnection.
        const replaceEntryId = pendingHistoryRowIdRef.current ?? undefined;
        pendingHistoryRowIdRef.current = null;
        const nextHistory = upsertConnectionHistory(
          protocol,
          conn,
          Date.now(),
          crypto.randomUUID(),
          {
            replaceEntryId,
          },
        );
        if (nextHistory) {
          setConnectionHistory(nextHistory);
        } else {
          console.warn(
            'mcL1498 [ConnectionPanel] connection history upsert failed after configure',
          );
        }
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
    tcpAddress,
    tcpHost,
    tcpPort,
    connectionType,
    connecting,
    protocol,
    bleDevices,
    hostLinkMeter.rssi,
  ]);

  // Recorder upserts localStorage without updating this panel's React state (e.g. mount
  // while already configured). Refresh Saved devices whenever we are configured or idle.
  useEffect(() => {
    if (protocol !== 'meshtastic' && protocol !== 'meshcore' && protocol !== 'meshcom') return;
    if (state.status !== 'configured' && state.status !== 'disconnected') return;
    setConnectionHistory(loadConnectionHistory(protocol));
    if (state.status === 'disconnected') {
      setLastConnection(loadLastConnection(protocol));
    }
  }, [protocol, state.status, setLastConnection, setConnectionHistory]);

  // Persist live / scan BLE RSSI onto lastConnection so reconnect can seed the host meter.
  // Pending reconnect RSSI stays in UI state only — do not promote to MRU before configure.
  useEffect(() => {
    if (state.connectionType !== 'ble' && !(connecting && connectionType === 'ble')) return;
    if (pendingBleReconnect?.type === 'ble') {
      const pendingTarget = pendingBleReconnect;
      const pendingId = resolveSavedBleConnectId(pendingTarget);
      if (!pendingId) return;
      const scanned = bleDevices.find((d) => d.deviceId === pendingId)?.rssi;
      const next =
        scanned != null && Number.isFinite(scanned)
          ? scanned
          : hostLinkMeter.rssi != null && Number.isFinite(hostLinkMeter.rssi)
            ? hostLinkMeter.rssi
            : null;
      if (next == null || pendingTarget.bleRssi === next) return;
      setPendingBleReconnect((current) => {
        if (current !== pendingTarget || current?.type !== 'ble') return current;
        return { ...current, bleRssi: next };
      });
      return;
    }
    const id = lastConnection?.bleDeviceId ?? loadLastBleDevice(protocol);
    if (!id) return;
    const scanned = bleDevices.find((d) => d.deviceId === id)?.rssi;
    const next =
      scanned != null && Number.isFinite(scanned)
        ? scanned
        : hostLinkMeter.rssi != null && Number.isFinite(hostLinkMeter.rssi)
          ? hostLinkMeter.rssi
          : null;
    if (next == null) return;
    if (lastConnection?.bleRssi === next) return;
    const updated: LastConnection = {
      ...(lastConnection ?? { type: 'ble', bleDeviceId: id }),
      type: 'ble',
      bleDeviceId: id,
      bleRssi: next,
    };
    saveLastConnection(protocol, updated);
    setLastConnection(updated);
  }, [
    bleDevices,
    connecting,
    connectionType,
    hostLinkMeter.rssi,
    lastConnection,
    pendingBleReconnect,
    protocol,
    state.connectionType,
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
          'mcL0402 [ConnectionPanel] BLE connect after selection failed ' + errLikeToLogString(err),
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

  /**
   * Windows: pair-state timed out or WinRT failed. Do not connect — that call wedges btleplug.
   * Offer Remove & Re-pair instead.
   */
  const showWindowsPairStateBlocked = useCallback(
    (deviceId: string) => {
      pendingPairBleDeviceRef.current = null;
      lastSelectedBleMacRef.current = deviceId;
      isAutoConnectingRef.current = false;
      setIsAutoConnecting(false);
      setShowPinPrompt(false);
      setShowBlePicker(false);
      setManualPairingFallback(false);
      setShowRePairButton(true);
      setConnecting(false);
      setConnectionStage('connectionPanel.stagePairingFailed');
      setError(t('connectionPanel.error.windowsPairStateBlocked'));
    },
    [t],
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

  const surfaceWindowsAutoReconnectSkip = useCallback(
    (deviceId: string, state: 'blocked' | 'unpaired') => {
      setConnectionType('ble');
      if (state === 'unpaired') {
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        setConnecting(false);
        promptWindowsPairing(deviceId);
        return;
      }
      showWindowsPairStateBlocked(deviceId);
    },
    [promptWindowsPairing, showWindowsPairStateBlocked],
  );

  useEffect(() => {
    if (!isWindows || !capabilities.hasGattBleScanning) return;
    const rememberedBleId = (): string | null => {
      const last = loadLastConnection(protocol);
      if (last?.type !== 'ble') return null;
      return last.bleDeviceId ?? loadLastBleDevice(protocol);
    };
    const apply = (peripheralId: string, state: 'blocked' | 'unpaired'): void => {
      const lastId = rememberedBleId();
      if (!lastId || !bleIdsMatch(lastId, peripheralId)) return;
      clearWindowsBleReconnectSkip(peripheralId);
      surfaceWindowsAutoReconnectSkip(peripheralId, state);
    };
    const unsubscribe = subscribeWindowsBleReconnectSkip((detail) => {
      apply(detail.peripheralId, detail.state);
    });
    const lastId = rememberedBleId();
    if (lastId) {
      const pending = peekWindowsBleReconnectSkip(lastId);
      if (pending) apply(pending.peripheralId, pending.state);
    }
    return unsubscribe;
  }, [isWindows, capabilities.hasGattBleScanning, protocol, surfaceWindowsAutoReconnectSkip]);

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
        saveLastBleDevice(protocol, deviceId);
        pendingPairBleDeviceRef.current = null;
        setShowPinPrompt(false);
        setPinInputValue('');
        setManualPairingFallback(false);
        setShowRePairButton(false);
        await connectSelectedBleDevice(deviceId);
      } catch (err) {
        if (pendingPairBleDeviceRef.current !== pendingDevice) return;
        console.warn(
          'mcL0403 [ConnectionPanel] Windows in-app pairing failed: ' + errLikeToLogString(err),
        );
        setError(windowsPairingFailureMessage(err, t));
        setManualPairingFallback(false);
        setShowPinPrompt(true);
        setConnectionStage('connectionPanel.stageEnterPinWindows');
        setConnecting(false);
      }
    },
    [connectSelectedBleDevice, protocol, t],
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
        } catch (e: unknown) {
          console.debug('[renderer/components/ConnectionPanel] catch:', e);
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
        console.warn(
          'mcL0404 [ConnectionPanel] BLE pre-connect pair failed: ' + errLikeToLogString(err),
        );
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
        } catch (e: unknown) {
          console.debug('[renderer/components/ConnectionPanel] catch:', e);
        }
        try {
          await window.electronAPI.bluetoothStartScan();
          scanStarted = true;
        } catch (e) {
          console.warn(
            'mcL0405 [ConnectionPanel] bluetoothStartScan warning: ' + errLikeToLogString(e),
          );
        }
        setConnectionStage('connectionPanel.stagePairingPin');
        await window.electronAPI.bluetoothPair(manualMac, normalizedPin);
        try {
          await window.electronAPI.bluetoothGetInfo(manualMac);
        } catch (e: unknown) {
          console.debug('[renderer/components/ConnectionPanel] catch:', e);
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
        console.warn('mcL0406 [ConnectionPanel] manual pair failed: ' + errLikeToLogString(err));
        setError(t('connectionPanel.error.pinPairingFailed', { msg }));
        setShowRePairButton(true);
        setConnecting(false);
        setConnectionStage('');
        return;
      } finally {
        if (scanStarted) {
          try {
            await window.electronAPI.bluetoothStopScan();
          } catch (e: unknown) {
            console.debug('[renderer/components/ConnectionPanel] catch:', e);
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
        // MeshCom: only match this protocol's remembered port — never the shared last-serial key
        // (that belongs to Meshtastic/MeshCore and would open the wrong USB radio).
        const lastId =
          lastConnectionRef.current?.serialPortId?.trim() || resolveLastSerialPortId(protocol);
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
  }, [isAutoConnecting, lastConnection, protocol]);

  const handleConnect = useCallback(async () => {
    clearPendingHistoryReplace();
    // Cancel deferred dual-Noble BLE auto-connect so it cannot race prepareRfConnect against
    // a manual TCP/serial/HTTP connect (orphan TCP socket + connectType flip).
    // Mount auto-connect lives in ProtocolAutoConnectCoordinator — cancel that gate too.
    // Serial: cancel every LoRa protocol so a background Meshtastic serial auto-connect cannot
    // re-grab the port while the MeshCore/MeshCom picker is open.
    if (connectionType === 'serial') {
      cancelAllLoraRfAutoConnect();
    } else {
      cancelProtocolRfAutoConnect(protocol);
    }
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
        clearPendingHistoryReplace();
        console.warn(
          'mcL0407 [ConnectionPanel] startGattScanning failed: ' + errLikeToLogString(err),
        );
        const bleErrMsg = humanizeBleError(err, t);
        if (bleErrMsg) setError(bleErrMsg);
        setConnecting(false);
        setConnectionStage('');
      }
      return;
    }

    try {
      console.debug('[ConnectionPanel] handleConnect', connectionType, activeHostAddress);
      if (
        protocol === 'meshcom' &&
        (connectionType === 'http' || connectionType === 'netconsole')
      ) {
        const authTransport = meshcomAuthTransportFromConnectionType(connectionType);
        if (authTransport) {
          void setMeshcomNodePasswd(authTransport, activeHostAddress, meshcomNodePassword).catch(
            (err: unknown) => {
              console.warn(
                'mcL0413 [ConnectionPanel] MeshCom node password persist failed ' +
                  errLikeToLogString(err),
              );
            },
          );
        }
      }
      if (connectionType === 'http') {
        await onConnect('http', activeHostAddress);
      } else if (connectionType === 'tcp') {
        await onConnect('tcp', activeHostAddress);
      } else if (connectionType === 'udp') {
        await onConnect('udp', activeHostAddress);
      } else if (connectionType === 'netconsole') {
        await onConnect('netconsole', activeHostAddress);
      } else {
        await onConnect('serial');
      }
    } catch (err) {
      clearPendingHistoryReplace();
      console.warn('mcL0408 [ConnectionPanel] handleConnect failed ' + errLikeToLogString(err));
      let errorMsg: string;
      if (connectionType === 'serial') {
        errorMsg = humanizeSerialError(err, t, {
          inAppHolders: listInAppSerialHolders(protocol, peekLastSerialClaimPort(protocol)),
        });
      } else if (
        connectionType === 'http' ||
        connectionType === 'tcp' ||
        connectionType === 'udp' ||
        connectionType === 'netconsole'
      ) {
        errorMsg = humanizeHttpError(activeHostAddress, err, t);
      } else {
        errorMsg = err instanceof Error ? err.message : t('connectionPanel.error.connectionFailed');
      }
      // Empty humanize = MeshCore setup AbortError (supersede/cancel); do not setError('').
      if (errorMsg) setError(errorMsg);
      setConnecting(false);
      setConnectionStage('');
    }
  }, [
    clearPendingHistoryReplace,
    connectionType,
    activeHostAddress,
    meshcomNodePassword,
    onConnect,
    protocol,
    t,
  ]);

  const handleCancelConnection = useCallback(() => {
    cancelProtocolRfAutoConnect(protocol);
    isAutoConnectingRef.current = false;
    setIsAutoConnecting(false);
    windowsReconnectAttemptRef.current = null;
    setPendingBleReconnect(null);
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
      // Persist scan RSSI immediately — CoreBluetooth rarely provides live GATT RSSI, and
      // reconnect clears bleDevices before the host meter can read the picker list.
      {
        const bleIdentity = resolveBlePickerIdentity({
          deviceId,
          address: lastSelectedBleAddressRef.current,
          cachedMac: getBleDeviceMac(deviceId) ?? lastConnectionBleMacFallbackRef.current,
        });
        const selected: LastConnection = {
          type: 'ble',
          bleDeviceId: deviceId,
          bleDeviceName: found?.deviceName ?? lastConnectionBleDeviceNameFallbackRef.current,
          ...(bleIdentity.isMac ? { bleMac: bleIdentity.display } : {}),
          ...(found?.rssi != null && Number.isFinite(found.rssi) ? { bleRssi: found.rssi } : {}),
        };
        saveLastConnection(protocol, selected);
        setLastConnection(selected);
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
        // OS-specific: BlueZ D-Bus pairing uses the PIN entered in this panel.
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
          if (pairState === 'blocked') {
            showWindowsPairStateBlocked(deviceId);
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
      showWindowsPairStateBlocked,
      protocol,
      capabilities.hasGattBleScanning,
      setLastConnection,
    ],
  );

  const handleSelectSerialPort = useCallback(
    (portId: string) => {
      // Keep the shared key for Meshtastic/MeshCore reconnect UX; MeshCom only stores per-protocol.
      if (protocol !== 'meshcom') {
        saveLastSerialPort(portId);
      }
      const conn: LastConnection = { type: 'serial', serialPortId: portId };
      saveLastConnection(protocol, conn);
      setLastConnection(conn);
      window.electronAPI.selectSerialPort(portId);
      setShowSerialPicker(false);
      setConnectionStage('connectionPanel.stageConnecting');
    },
    [protocol, setLastConnection],
  );

  // Cold-start RF auto-connect (serial/BLE/TCP/HTTP) is owned by
  // ProtocolAutoConnectCoordinator / useProtocolRfAutoConnect — not this panel.

  // Cleanup timeout on unmount
  useEffect(
    () => () => {
      if (autoConnectTimeoutRef.current) clearTimeout(autoConnectTimeoutRef.current);
    },
    [],
  );

  const reconnectFromSaved = useCallback(
    (target: LastConnection) => {
      // Same cancel as handleConnect — Reconnect must not race deferred ProtocolAutoConnectCoordinator
      // BLE/serial auto-connect (orphan socket / connectType flip).
      if (target.type === 'serial') {
        cancelAllLoraRfAutoConnect();
      } else {
        cancelProtocolRfAutoConnect(protocol);
      }
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
      // Discard stale pairing UI for any transport before branching — a new BLE attempt may set its own.
      pendingPairBleDeviceRef.current = null;
      setShowPinPrompt(false);
      setPinInputValue('');
      setManualPairingFallback(false);
      pendingHistoryRowIdRef.current =
        'id' in target && typeof (target as SavedConnection).id === 'string'
          ? (target as SavedConnection).id
          : null;
      // BLE reconnect stays pending until configure — do not overwrite persisted MRU early.
      if (target.type === 'ble') {
        setPendingBleReconnect(target);
      } else {
        setPendingBleReconnect(null);
        setLastConnection(target);
      }

      if (target.type === 'ble') {
        void (async () => {
          const bleConnectId = resolveSavedBleConnectId(target);
          if (!bleConnectId) {
            setPendingBleReconnect(null);
            return;
          }
          setConnectionType('ble');
          setBleDevices([]);
          setShowBlePicker(false);
          manualBleScanActiveRef.current = false;
          isAutoConnectingRef.current = true;
          setIsAutoConnecting(true);
          setConnecting(true);
          const matchIds = [bleConnectId, target.bleDeviceId, target.bleMac].filter(
            (id): id is string => typeof id === 'string' && id.trim().length > 0,
          );
          // Seed metadata from this row only — never reuse another attempt's MAC/address.
          lastSelectedBleNameRef.current = target.bleDeviceName ?? null;
          const knownMac =
            target.bleMac?.trim() && isTwelveHexBleMac(target.bleMac)
              ? normalizeBleMac(target.bleMac)
              : null;
          lastSelectedBleAddressRef.current = knownMac;
          lastSelectedBleMacRef.current = bleConnectId;
          const attempt = {};
          windowsReconnectAttemptRef.current = attempt;
          if (isWindows && capabilities.hasGattBleScanning) {
            // OS-specific: skip a doomed WinRT connect (wedges for ~41s) when the bond is gone.
            setConnectionStage('connectionPanel.stageCheckingPairing');
            const pairState = await getWindowsBlePairState(bleConnectId);
            // Cancel, manual connect, protocol change, or a newer Reconnect superseded this attempt.
            if (windowsReconnectAttemptRef.current !== attempt || !isAutoConnectingRef.current) {
              // Flags were set just before this await. A newer Reconnect or a manual scan
              // already owns them; clearing would stick that attempt. Otherwise this
              // return left Connecting on (the panel is not remounted on protocol change).
              const supersededByNewerReconnect =
                isAutoConnectingRef.current &&
                windowsReconnectAttemptRef.current !== null &&
                windowsReconnectAttemptRef.current !== attempt;
              if (!supersededByNewerReconnect && !manualBleScanActiveRef.current) {
                isAutoConnectingRef.current = false;
                setIsAutoConnecting(false);
                setConnecting(false);
                setConnectionStage('');
                setPendingBleReconnect(null);
                clearPendingHistoryReplace();
              }
              return;
            }
            if (pairState === 'unpaired') {
              windowsReconnectAttemptRef.current = null;
              isAutoConnectingRef.current = false;
              setIsAutoConnecting(false);
              setPendingBleReconnect(null);
              clearPendingHistoryReplace();
              promptWindowsPairing(bleConnectId);
              return;
            }
            if (pairState === 'blocked') {
              windowsReconnectAttemptRef.current = null;
              setPendingBleReconnect(null);
              clearPendingHistoryReplace();
              showWindowsPairStateBlocked(bleConnectId);
              return;
            }
          }
          setConnectionStage('connectionPanel.stageConnecting');
          try {
            await reconnectBleWithScan(
              protocol,
              bleConnectId,
              (resolvedId) => {
                if (
                  windowsReconnectAttemptRef.current !== attempt ||
                  !isAutoConnectingRef.current
                ) {
                  return Promise.resolve();
                }
                const connectId = resolvedId ?? bleConnectId;
                lastSelectedBleMacRef.current = connectId;
                const discoveredMac = getBleDeviceMac(connectId);
                if (discoveredMac) {
                  lastSelectedBleAddressRef.current = discoveredMac;
                } else if (!knownMac) {
                  lastSelectedBleAddressRef.current = null;
                }
                saveLastBleDevice(protocol, connectId);
                return onConnect('ble', undefined, connectId);
              },
              { matchIds },
            );
            if (windowsReconnectAttemptRef.current === attempt && !manualBleScanActiveRef.current) {
              windowsReconnectAttemptRef.current = null;
              isAutoConnectingRef.current = false;
              setIsAutoConnecting(false);
              setConnecting(false);
              setConnectionStage('');
            }
          } catch (err: unknown) {
            console.debug('[renderer/components/ConnectionPanel] catch:', err);

            if (windowsReconnectAttemptRef.current !== attempt) return;
            clearPendingHistoryReplace();
            windowsReconnectAttemptRef.current = null;
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            clearMeshcoreBleSelectionOnMissingServices(err, target);
            setPendingBleReconnect(null);
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
          }
        })();
      } else if (target.type === 'http' || target.type === 'udp' || target.type === 'netconsole') {
        const fallbackAddress = protocol === 'meshcore' ? tcpHost : httpAddress;
        const addr = target.httpAddress ?? fallbackAddress;
        if (protocol === 'meshcore') {
          const { host, port } = parseTcpAddress(addr);
          setTcpHost(host);
          setTcpPortStr(String(port));
        } else {
          setHttpAddress(addr);
        }
        setConnectionType(target.type);
        setConnecting(true);
        setBleDevices([]);
        setSerialPorts([]);
        setShowBlePicker(false);
        setShowSerialPicker(false);
        setConnectionStage('connectionPanel.stagePleaseWait');
        onConnect(target.type, addr).catch((err: unknown) => {
          console.debug('[renderer/components/ConnectionPanel] catch:', err);
          clearPendingHistoryReplace();
          // Empty humanize = MeshCore setup AbortError (supersede/cancel); do not setError('').
          const httpErr = humanizeHttpError(addr, err, t);
          if (httpErr) setError(httpErr);
          setConnecting(false);
          setConnectionStage('');
        });
      } else if (target.type === 'tcp') {
        // MeshCom KISS is stored as `http`. Mistyped tcp with a usable address reconnects
        // as http; Meshtastic-only tcp bleed is cleared.
        if (protocol === 'meshcom') {
          const kissAddr = resolveMeshcomKissReconnectAddress(target);
          if (!kissAddr) {
            const savedId =
              'id' in target && typeof (target as SavedConnection).id === 'string'
                ? (target as SavedConnection).id
                : null;
            if (savedId) {
              const next = deleteConnectionHistory(protocol, savedId);
              if (next) {
                setConnectionHistory(next);
                setLastConnection(loadLastConnection(protocol));
              }
            }
            return;
          }
          // Do not promote MRU until configure succeeds — only drive the connect attempt.
          setHttpAddress(kissAddr);
          setConnectionType('http');
          setConnecting(true);
          setBleDevices([]);
          setSerialPorts([]);
          setShowBlePicker(false);
          setShowSerialPicker(false);
          setConnectionStage('connectionPanel.stagePleaseWait');
          onConnect('http', kissAddr).catch((err: unknown) => {
            console.debug('[renderer/components/ConnectionPanel] catch:', err);
            const httpErr = humanizeHttpError(kissAddr, err, t);
            if (httpErr) setError(httpErr);
            setConnecting(false);
            setConnectionStage('');
            clearPendingHistoryReplace();
          });
          return;
        }
        const addr = target.httpAddress ?? tcpAddress;
        setTcpAddress(addr);
        setConnectionType('tcp');
        setConnecting(true);
        setBleDevices([]);
        setSerialPorts([]);
        setShowBlePicker(false);
        setShowSerialPicker(false);
        setConnectionStage('connectionPanel.stagePleaseWait');
        onConnect('tcp', addr).catch((err: unknown) => {
          console.debug('[renderer/components/ConnectionPanel] catch:', err);
          clearPendingHistoryReplace();
          // Empty humanize = MeshCore setup AbortError (supersede/cancel); do not setError('').
          const tcpErr = humanizeHttpError(addr, err, t);
          if (tcpErr) setError(tcpErr);
          setConnecting(false);
          setConnectionStage('');
        });
      } else if (target.type === 'serial') {
        isAutoConnectingRef.current = true;
        setIsAutoConnecting(true);
        setConnectionType('serial');
        setConnecting(true);
        setConnectionStage('connectionPanel.stagePleaseWait');
        onAutoConnect('serial', undefined, target.serialPortId).catch((err: unknown) => {
          isAutoConnectingRef.current = false;
          setIsAutoConnecting(false);
          clearPendingHistoryReplace();
          setError(
            humanizeSerialError(err, t, {
              inAppHolders: listInAppSerialHolders(protocol, peekLastSerialClaimPort(protocol)),
            }),
          );
          setConnecting(false);
          setConnectionStage('');
        });
      }
    },
    [
      clearPendingHistoryReplace,
      setLastConnection,
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
      showWindowsPairStateBlocked,
      clearMeshcoreBleSelectionOnMissingServices,
      t,
    ],
  );

  const handleDeleteSavedConnection = useCallback(
    (id: string) => {
      const removed = connectionHistory.find((entry) => entry.id === id);
      const next = deleteConnectionHistory(protocol, id);
      if (!next) return;
      setConnectionHistory(next);
      setLastConnection(loadLastConnection(protocol));
      if (removed?.type === 'ble') {
        const storedBleId = loadLastBleDevice(protocol);
        if (storedBleId) {
          const removedKey = connectionHistoryIdentityKey(removed, protocol);
          const storedKey = connectionHistoryIdentityKey(
            { type: 'ble', bleDeviceId: storedBleId },
            protocol,
          );
          if (removedKey && storedKey && removedKey === storedKey) {
            clearLastBleDevice(protocol);
          }
        }
      }
    },
    [protocol, connectionHistory, setLastConnection, setConnectionHistory],
  );

  /** Tear down radio and reset connect UI so Saved devices / transport picker reappear. */
  const disconnectRadio = useCallback(() => {
    cancelProtocolRfAutoConnect(protocol);
    isAutoConnectingRef.current = false;
    setIsAutoConnecting(false);
    windowsReconnectAttemptRef.current = null;
    setPendingBleReconnect(null);
    setAutoConnectBleTarget(null);
    if (autoConnectTimeoutRef.current) {
      clearTimeout(autoConnectTimeoutRef.current);
      autoConnectTimeoutRef.current = null;
    }
    setConnecting(false);
    setConnectionStage('');
    setShowBlePicker(false);
    setShowSerialPicker(false);
    manualBleScanActiveRef.current = false;
    onDisconnect().catch((err: unknown) => {
      console.warn('mcL0415 [ConnectionPanel] radio disconnect failed: ' + errLikeToLogString(err));
    });
  }, [protocol, onDisconnect]);

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
              const pendingId = pendingBleReconnect
                ? resolveSavedBleConnectId(pendingBleReconnect)
                : null;
              const targetId =
                pendingId ??
                lastConnection?.bleDeviceId ??
                loadLastBleDevice(protocol) ??
                undefined;
              const targetRssi =
                pendingBleReconnect?.bleRssi ??
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
                  {t('connectionPanel.devicesFound', { count: visibleBleDevices.length })}
                </span>
                {visibleBleDevices.length > 0 ? (
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
              {visibleBleDevices.length === 0 ? (
                <div className="text-muted px-4 py-6 text-center text-sm">
                  <SpinnerIcon className="text-muted mx-auto mb-2 h-5 w-5" />
                  {t('connectionPanel.scanningDevices', {
                    protocol:
                      protocol === 'meshcore'
                        ? 'MeshCore'
                        : protocol === 'meshcom'
                          ? 'MeshCom'
                          : 'Meshtastic',
                  })}
                </div>
              ) : (
                visibleBleDevices.map((device) => {
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
    const mqttProtocol =
      protocol === 'meshcore' ? 'meshcore' : protocol === 'meshcom' ? 'meshcom' : 'meshtastic';
    window.electronAPI.mqtt.disconnect(mqttProtocol).catch((err: unknown) => {
      console.warn(
        `mcL0409 [ConnectionPanel] mqtt.disconnect (${reason}) failed: ` + errLikeToLogString(err),
      );
    });
  };

  const mqttAuthDocsLink =
    protocol === 'meshcore' ? (
      <DocsSiteLink
        href={LETSMESH_MQTT_AUTH_DOCS_URL}
        labelKey="connectionPanel.mqttAuthDocsLink"
        className="hover:text-bright-green text-muted text-xs transition-colors"
      />
    ) : null;

  // ─── MeshCore analyzer feeds (publish-only extra brokers) ──────────
  const meshcoreConnectionStatus = (connectionId: string): MQTTStatus =>
    connectionId === MESHCORE_MQTT_CHAT_CONNECTION_ID
      ? mqttStatus
      : (meshcoreFeedStatuses[connectionId] ?? 'disconnected');

  const meshcoreFeedStatusLabel = (status: MQTTStatus): string => {
    switch (status) {
      case 'connected':
        return t('connectionPanel.meshcoreFeeds.statusConnected');
      case 'connecting':
        return t('connectionPanel.meshcoreFeeds.statusConnecting');
      case 'error':
        return t('connectionPanel.meshcoreFeeds.statusError');
      default:
        return t('connectionPanel.meshcoreFeeds.statusDisconnected');
    }
  };

  const disconnectMeshcoreFeed = (connectionId: string) => {
    if (connectionId === MESHCORE_MQTT_CHAT_CONNECTION_ID) {
      disconnectMqtt('feed-list');
      return;
    }
    // Feed drops must not suppress the chat broker's connection-loss notice.
    window.electronAPI.mqtt.disconnect('meshcore', connectionId).catch((err: unknown) => {
      console.warn(
        'mcL0409 [ConnectionPanel] mqtt.disconnect (feed) failed: ' + errLikeToLogString(err),
      );
    });
  };

  const connectMeshcoreFeedNow = (feed: MeshcoreMqttFeed) => {
    setMeshcoreFeedError(null);
    void connectMeshcoreMqttFeed(feed).catch((e: unknown) => {
      setMeshcoreFeedError(e instanceof Error ? e.message : String(e));
      console.warn('mcL1511 [ConnectionPanel] feed connect failed ' + errLikeToLogString(e));
    });
  };

  const setMeshcoreFeedEnabled = (feed: MeshcoreMqttFeed, enabled: boolean) => {
    setMeshcoreFeedError(null);
    if (enabled && !canEnableMeshcoreMqttFeed(meshcoreFeeds)) {
      setMeshcoreFeedError(
        t('connectionPanel.meshcoreFeeds.enabledLimit', {
          max: MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS,
        }),
      );
      return;
    }
    if (enabled && meshcoreFeedOverrideWarning(meshcoreFeeds, { ...feed, enabled: true })) {
      setMeshcoreFeedError(t('connectionPanel.meshcoreFeeds.duplicateWarning'));
    }
    setMeshcoreFeeds((prev) => updateMeshcoreMqttFeed(prev, feed.id, { enabled }));
    if (enabled) {
      connectMeshcoreFeedNow({ ...feed, enabled: true });
    } else {
      disconnectMeshcoreFeed(feed.id);
    }
  };

  const addMeshcoreFeed = () => {
    setMeshcoreFeedError(null);
    if (meshcoreFeeds.length >= MAX_MESHCORE_MQTT_PUBLISH_FEEDS) {
      setMeshcoreFeedError(
        t('connectionPanel.meshcoreFeeds.savedLimit', { max: MAX_MESHCORE_MQTT_PUBLISH_FEEDS }),
      );
      return;
    }
    const name = meshcoreFeedNameDraft.trim();
    if (!name) {
      setMeshcoreFeedError(t('connectionPanel.meshcoreFeeds.nameRequired'));
      return;
    }
    const preset: MeshcoreMqttPreset = 'meshmapper';
    const seed = applyMeshcoreMqttPreset(preset, {
      ...meshcoreMqttSettings,
      password: '',
      username: '',
      tokenExpiresAt: undefined,
      autoLaunch: false,
    });
    // Keep the mesh's regional topic prefix so feeds publish to the same stream as chat.
    const chatPrefix = parseMeshcoreIataTopicPrefix(meshcoreMqttSettings.topicPrefix);
    if (chatPrefix.ok) seed.topicPrefix = chatPrefix.normalized;
    const feed = createMeshcoreMqttFeed({
      name,
      preset,
      settings: { ...seed, meshcorePacketLoggerEnabled: true },
    });
    if (!feed) return;
    setMeshcoreFeeds((prev) => [...prev, feed]);
    setMeshcoreEditorTarget(feed.id);
    setMeshcoreFeedNameDraft('');
  };

  const deleteMeshcoreFeedNow = (feed: MeshcoreMqttFeed) => {
    if (meshcoreConnectionStatus(feed.id) !== 'disconnected') disconnectMeshcoreFeed(feed.id);
    setMeshcoreFeeds((prev) => deleteMeshcoreMqttFeed(prev, feed.id));
    if (meshcoreEditorTarget === feed.id) setMeshcoreEditorTarget(MESHCORE_MQTT_CHAT_CONNECTION_ID);
  };

  const meshcoreFeedsPanel =
    protocol === 'meshcore' ? (
      <div data-setting-anchor="connection.mqtt.meshcoreFeeds" className="space-y-2">
        <label htmlFor="meshcore-feed-editor" className="text-muted text-xs">
          {t('connectionPanel.meshcoreFeeds.editorLabel')}
        </label>
        <select
          id="meshcore-feed-editor"
          value={meshcoreEditorTarget}
          onChange={(e) => {
            setMeshcoreFeedError(null);
            setMeshcoreEditorTarget(e.target.value);
          }}
          className={SELECT_CLASS}
        >
          <option value={MESHCORE_MQTT_CHAT_CONNECTION_ID}>
            {t('connectionPanel.meshcoreFeeds.chatOption')}
          </option>
          {meshcoreFeeds.map((feed) => (
            <option key={feed.id} value={feed.id}>
              {feed.name}
            </option>
          ))}
        </select>
        {meshcoreFeedError && (
          <p role="status" className="text-xs text-orange-400">
            {meshcoreFeedError}
          </p>
        )}
        <ul className="space-y-1" aria-label={t('connectionPanel.meshcoreFeeds.listLabel')}>
          <li className="flex flex-wrap items-center gap-2 text-xs">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${
                meshcoreConnectionStatus(MESHCORE_MQTT_CHAT_CONNECTION_ID) === 'connected'
                  ? 'bg-green-500'
                  : meshcoreConnectionStatus(MESHCORE_MQTT_CHAT_CONNECTION_ID) === 'connecting'
                    ? 'bg-orange-400'
                    : meshcoreConnectionStatus(MESHCORE_MQTT_CHAT_CONNECTION_ID) === 'error'
                      ? 'bg-red-500'
                      : 'bg-ink-600'
              }`}
            />
            <span className="text-ink-200">{t('connectionPanel.meshcoreFeeds.chatOption')}</span>
            <span className="text-muted">
              {meshcoreFeedStatusLabel(meshcoreConnectionStatus(MESHCORE_MQTT_CHAT_CONNECTION_ID))}
            </span>
          </li>
          {meshcoreFeeds.map((feed) => {
            const status = meshcoreConnectionStatus(feed.id);
            return (
              <li key={feed.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  aria-hidden
                  className={`inline-block h-2 w-2 rounded-full ${
                    status === 'connected'
                      ? 'bg-green-500'
                      : status === 'connecting'
                        ? 'bg-orange-400'
                        : status === 'error'
                          ? 'bg-red-500'
                          : 'bg-ink-600'
                  }`}
                />
                <button
                  type="button"
                  className="text-ink-200 underline-offset-2 hover:underline"
                  aria-label={t('connectionPanel.meshcoreFeeds.editAria', { name: feed.name })}
                  onClick={() => {
                    setMeshcoreEditorTarget(feed.id);
                  }}
                >
                  {feed.name}
                </button>
                <span className="text-muted">{meshcoreFeedStatusLabel(status)}</span>
                <label className="text-muted flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={feed.enabled}
                    aria-label={t('connectionPanel.meshcoreFeeds.enabledAria', {
                      name: feed.name,
                    })}
                    onChange={(e) => {
                      setMeshcoreFeedEnabled(feed, e.target.checked);
                    }}
                    className={CHECKBOX_CLASS}
                  />
                  {t('connectionPanel.meshcoreFeeds.connectOnLaunch')}
                </label>
                {status === 'connected' || status === 'connecting' ? (
                  <Button
                    size="sm"
                    aria-label={t('connectionPanel.meshcoreFeeds.disconnectAria', {
                      name: feed.name,
                    })}
                    onClick={() => {
                      disconnectMeshcoreFeed(feed.id);
                    }}
                  >
                    {t('connectionPanel.meshcoreFeeds.disconnect')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    aria-label={t('connectionPanel.meshcoreFeeds.connectAria', {
                      name: feed.name,
                    })}
                    onClick={() => {
                      connectMeshcoreFeedNow(feed);
                    }}
                  >
                    {t('connectionPanel.meshcoreFeeds.connect')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  aria-label={t('connectionPanel.meshcoreFeeds.deleteAria', { name: feed.name })}
                  onClick={() => {
                    deleteMeshcoreFeedNow(feed);
                  }}
                >
                  {t('common.delete')}
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={meshcoreFeedNameDraft}
            maxLength={MESHCORE_MQTT_FEED_NAME_MAX_LENGTH}
            placeholder={t('connectionPanel.meshcoreFeeds.namePlaceholder')}
            aria-label={t('connectionPanel.meshcoreFeeds.nameAria')}
            onChange={(e) => {
              setMeshcoreFeedNameDraft(e.target.value);
            }}
            className={`${INPUT_CLASS} min-w-0 flex-1`}
          />
          <Button
            size="sm"
            aria-label={t('connectionPanel.meshcoreFeeds.addAria')}
            onClick={addMeshcoreFeed}
          >
            {t('connectionPanel.meshcoreFeeds.add')}
          </Button>
        </div>
        <p className="text-muted text-xs">
          {t('connectionPanel.meshcoreFeeds.help', {
            maxSaved: MAX_MESHCORE_MQTT_PUBLISH_FEEDS,
            maxEnabled: MAX_MESHCORE_MQTT_ENABLED_PUBLISH_FEEDS,
          })}
        </p>
      </div>
    ) : null;

  /** Connected card always summarises the chat broker, even while a feed is selected for editing. */
  const mqttSummarySettings = protocol === 'meshcore' ? meshcoreMqttSettings : activeMqttSettings;

  const mqttSection =
    mqttStatus === 'connected' ? (
      <Panel
        title={t('connectionPanel.mqttConnection')}
        actions={
          <>
            {mqttAuthDocsLink}
            <Button
              data-setting-anchor="connection.mqtt.disconnect"
              variant="danger"
              size="sm"
              icon={<Unplug aria-hidden className={ICON_MD} size={16} />}
              onClick={() => {
                disconnectMqtt('panel');
              }}
            >
              {t('connectionPanel.disconnectMqtt')}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {mqttError && (
            <div role="alert" className={NOTICE_CLASS.error}>
              {mqttError}
            </div>
          )}
          {mqttWarning && <div className={NOTICE_CLASS.warn}>{mqttWarning}</div>}
          {meshcoreFeedsPanel}
          <LabelValueGrid>
            <LabelValue label={t('connectionPanel.server')} mono>
              {mqttSummarySettings.server}:{mqttSummarySettings.port}
            </LabelValue>
            {protocol === 'meshcore' &&
              /^v1_[0-9a-f]{64}$/i.test(mqttSummarySettings.username ?? '') && (
                <LabelValue label={t('connectionPanel.from')} mono>
                  {mqttSummarySettings.username?.slice(3)}
                </LabelValue>
              )}
            {protocol === 'meshtastic' && state.myNodeNum > 0 && (
              <LabelValue label={t('connectionPanel.from')} mono>
                {formatMeshtasticNodeId(state.myNodeNum)}
              </LabelValue>
            )}
            <LabelValue label={t('connectionPanel.topic')} mono>
              {mqttSummarySettings.topicPrefix.endsWith('/')
                ? mqttSummarySettings.topicPrefix
                : `${mqttSummarySettings.topicPrefix}/`}
              #
            </LabelValue>
          </LabelValueGrid>
          {protocol === 'meshtastic' && mqttProfiles.length > 0 ? (
            <div data-setting-anchor="connection.mqtt.switchProfile" className="space-y-1">
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
          {protocol === 'meshcom' && meshcomMqttProfiles.length > 0 ? (
            <div data-setting-anchor="connection.mqtt.meshcomSwitchProfile" className="space-y-1">
              <p id="conn-meshcom-live-profile" className="text-muted text-xs">
                {t('mqttProfiles.switchLabel')}
              </p>
              <MqttNetworkPresetSelect
                id="conn-meshcom-live-profile-select"
                labelledById="conn-meshcom-live-profile"
                value={activeMqttProfile ? mqttProfileSelectValue(activeMqttProfile.id) : ''}
                options={[
                  ...(activeMqttProfile
                    ? []
                    : [{ value: '', label: t('mqttProfiles.noneSelected') }]),
                  ...meshcomMqttProfiles.map((p) => ({
                    value: mqttProfileSelectValue(p.id),
                    label: p.name,
                  })),
                ]}
                onSelect={(value) => {
                  const profileId = mqttProfileIdFromSelectValue(value);
                  const profile = meshcomMqttProfiles.find((p) => p.id === profileId);
                  if (profile) applyMeshcomMqttProfile(profile);
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
                : protocol === 'meshcom'
                  ? t('connectionPanel.maxRetriesHelpConnected.meshcom', {
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
      <Panel title={t('connectionPanel.mqttConnection')} actions={mqttAuthDocsLink}>
        <div className="max-w-3xl space-y-4">
          {mqttError && (
            <div role="alert" className={NOTICE_CLASS.error}>
              {mqttError}
            </div>
          )}
          {protocol === 'meshtastic' && (
            <div data-setting-anchor="connection.mqtt.meshtasticPreset" className="space-y-1">
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
          {protocol === 'meshcom' && (
            <div data-setting-anchor="connection.mqtt.meshcomProfiles" className="space-y-1">
              <p id="conn-meshcom-saved-profiles" className="text-muted text-xs">
                {t('mqttProfiles.listLabel')}
              </p>
              {meshcomMqttProfiles.length > 0 ? (
                <MqttNetworkPresetSelect
                  id="conn-meshcom-saved-profiles-select"
                  labelledById="conn-meshcom-saved-profiles"
                  disabled={mqttStatus === 'connecting'}
                  value={activeMqttProfile ? mqttProfileSelectValue(activeMqttProfile.id) : ''}
                  options={[
                    ...(activeMqttProfile
                      ? []
                      : [{ value: '', label: t('mqttProfiles.noneSelected') }]),
                    ...meshcomMqttProfiles.map((p) => ({
                      value: mqttProfileSelectValue(p.id),
                      label: t('mqttProfiles.optionLabel', { name: p.name }),
                    })),
                  ]}
                  onSelect={(value) => {
                    const profileId = mqttProfileIdFromSelectValue(value);
                    if (profileId == null) return;
                    const profile = meshcomMqttProfiles.find((p) => p.id === profileId);
                    if (profile) applyMeshcomMqttProfile(profile);
                  }}
                />
              ) : null}
              <MqttProfileControls
                activeProfile={activeMqttProfile}
                onSave={(name) => {
                  updateMeshcomMqttProfiles(
                    createMqttProfile(meshcomMqttProfiles, name, meshcomMqttSettings),
                  );
                }}
                onRename={(id, name) => {
                  updateMeshcomMqttProfiles(renameMqttProfile(meshcomMqttProfiles, id, name));
                }}
                onDelete={(id) => {
                  updateMeshcomMqttProfiles(deleteMqttProfile(meshcomMqttProfiles, id));
                }}
              />
            </div>
          )}
          {meshcoreFeedsPanel}
          {protocol === 'meshcore' && editingMeshcoreFeed && (
            <div data-setting-anchor="connection.mqtt.meshcoreFeedName" className="space-y-1">
              <label htmlFor="meshcore-feed-name" className="text-muted text-xs">
                {t('connectionPanel.meshcoreFeeds.nameLabel')}
              </label>
              <input
                id="meshcore-feed-name"
                type="text"
                value={editingMeshcoreFeed.name}
                maxLength={MESHCORE_MQTT_FEED_NAME_MAX_LENGTH}
                onChange={(e) => {
                  setMeshcoreFeeds((prev) =>
                    updateMeshcoreMqttFeed(prev, editingMeshcoreFeed.id, {
                      name: e.target.value,
                    }),
                  );
                }}
                className={INPUT_CLASS}
              />
            </div>
          )}
          {protocol === 'meshcore' && (
            <div data-setting-anchor="connection.mqtt.meshcorePreset" className="space-y-1">
              <p id="conn-meshcore-network-preset" className="text-muted text-xs">
                {t('connectionPanel.networkPreset')}
              </p>
              <MqttNetworkPresetSelect
                key={`meshcore-preset-${meshcorePresetSelectNonce}`}
                id="conn-meshcore-network-preset-select"
                labelledById="conn-meshcore-network-preset"
                value={activeMeshcorePreset}
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
                    setActiveMeshcorePreset(id);
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
                    setRendererStorageItem(COLORADO_MQTT_REGION_ACK_KEY, '1');
                  }
                  setActiveMeshcorePreset(id);
                  const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                  setActiveMqttSettings((prev) => ({
                    ...applyMeshcoreMqttPreset(id, prev),
                    username: fromIdentity || prev.username,
                  }));
                }}
              />
              {activeMeshcorePreset === 'coloradomesh' && (
                <p className="text-xs text-orange-400">{t('connectionPanel.coloradoServerNote')}</p>
              )}
              {activeMeshcorePreset === 'meshcoreca' && (
                <div
                  data-setting-anchor="connection.mqtt.meshcoreCaBroker"
                  className="flex flex-wrap items-center gap-2 pt-1"
                  role="group"
                  aria-label={t('connectionPanel.meshcoreCaBroker')}
                >
                  <span className="text-muted text-xs">{t('connectionPanel.broker')}</span>
                  <button
                    type="button"
                    aria-pressed={activeMqttSettings.server === MESHCORE_CA_HOST_PRIMARY}
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setActiveMqttSettings((prev) => ({
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
                    className={chipClass(activeMqttSettings.server === MESHCORE_CA_HOST_PRIMARY)}
                  >
                    {t('connectionPanel.meshcoreCaPrimary')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={activeMqttSettings.server === MESHCORE_CA_HOST_BACKUP}
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setActiveMqttSettings((prev) => ({
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
                    className={chipClass(activeMqttSettings.server === MESHCORE_CA_HOST_BACKUP)}
                  >
                    {t('connectionPanel.meshcoreCaBackup')}
                  </button>
                </div>
              )}
              {activeMeshcorePreset === 'letsmesh' && (
                <div
                  data-setting-anchor="connection.mqtt.letsMeshRegion"
                  className="flex flex-wrap items-center gap-2 pt-1"
                  role="group"
                  aria-label={t('connectionPanel.letsMeshRegion')}
                >
                  <span className="text-muted text-xs">{t('connectionPanel.region')}</span>
                  <button
                    type="button"
                    aria-pressed={activeMqttSettings.server === LETSMESH_HOST_US}
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setActiveMqttSettings((prev) => ({
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
                    className={chipClass(activeMqttSettings.server === LETSMESH_HOST_US)}
                  >
                    {t('connectionPanel.letsMeshRegionUs')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={activeMqttSettings.server === LETSMESH_HOST_EU}
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setActiveMqttSettings((prev) => ({
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
                    className={chipClass(activeMqttSettings.server === LETSMESH_HOST_EU)}
                  >
                    {t('connectionPanel.letsMeshRegionEu')}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <div data-setting-anchor="connection.mqtt.server" className="space-y-1">
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
            <div data-setting-anchor="connection.mqtt.port" className="space-y-1">
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
          <div data-setting-anchor="connection.mqtt.tls" className="flex items-center gap-2">
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
            <div
              data-setting-anchor="connection.mqtt.tlsInsecure"
              className={`flex items-center gap-2 ${NOTICE_CLASS.warn}`}
            >
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
          <div data-setting-anchor="connection.mqtt.webSocket" className="flex items-center gap-2">
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
            usesMeshcoreDeviceSigningMqtt(activeMeshcorePreset, activeMqttSettings) &&
            letsMeshPresetConfigurationDeviation(activeMqttSettings) && (
              <div className={NOTICE_CLASS.warn}>
                {meshcorePresetDeviationText(t, activeMeshcorePreset)}
              </div>
            )}
          {protocol === 'meshcore' &&
            usesMeshcoreDeviceSigningMqtt(activeMeshcorePreset, activeMqttSettings) && (
              <div className={hasPrivateKey ? NOTICE_CLASS.success : NOTICE_CLASS.warn}>
                {hasPrivateKey && readMeshcoreIdentity()?.public_key
                  ? t('connectionPanel.meshcoreMqttIdentity.hasPrivateKey')
                  : t('connectionPanel.meshcoreMqttIdentity.noPrivateKey')}
              </div>
            )}
          {protocol === 'meshcore' &&
            usesMeshcoreDeviceSigningMqtt(activeMeshcorePreset, activeMqttSettings) &&
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
          {protocol === 'meshcore' && editingMeshcoreFeed && (
            <div className={`flex items-start gap-2 ${NOTICE_CLASS.info}`}>
              <span className="leading-snug">
                {t('connectionPanel.meshcoreFeeds.packetLoggerAlwaysOn', {
                  topic: `{topicPrefix}/meshcore/packets`,
                })}
              </span>
            </div>
          )}
          {protocol === 'meshcore' && !editingMeshcoreFeed && (
            <div
              data-setting-anchor="connection.mqtt.meshcorePacketLogger"
              className={`flex items-start gap-2 ${NOTICE_CLASS.info}`}
            >
              <input
                type="checkbox"
                id="meshcore-packet-logger"
                checked={activeMqttSettings.meshcorePacketLoggerEnabled ?? false}
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
            <div data-setting-anchor="connection.mqtt.username" className="space-y-1">
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
            <div data-setting-anchor="connection.mqtt.password" className="space-y-1">
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
          <div data-setting-anchor="connection.mqtt.topicPrefix" className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label htmlFor="mqtt-topic-prefix" className="text-muted text-xs">
                {t('connectionPanel.topicPrefix')}
              </label>
              <HelpTooltip
                text={
                  protocol === 'meshtastic'
                    ? t('connectionPanel.topicPrefixHelp.meshtastic')
                    : protocol === 'meshcom'
                      ? t('connectionPanel.topicPrefixHelp.meshcom')
                      : isDeviceSigningMeshcorePreset(activeMeshcorePreset) ||
                          isIataScopedMeshcoreMqtt(activeMeshcorePreset, activeMqttSettings)
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
                if (!isIataScopedMeshcoreMqtt(activeMeshcorePreset, activeMqttSettings)) return;
                const parsed = parseMeshcoreIataTopicPrefix(activeMqttSettings.topicPrefix);
                if (parsed.ok && parsed.normalized !== activeMqttSettings.topicPrefix) {
                  updateMqtt('topicPrefix', parsed.normalized, false);
                }
              }}
              className={INPUT_CLASS}
              placeholder={t('connectionPanel.topicPrefixPlaceholder')}
              aria-invalid={
                protocol === 'meshcore' &&
                isIataScopedMeshcoreMqtt(activeMeshcorePreset, activeMqttSettings) &&
                !parseMeshcoreIataTopicPrefix(activeMqttSettings.topicPrefix).ok
              }
            />
            {protocol === 'meshcore' &&
            isIataScopedMeshcoreMqtt(activeMeshcorePreset, activeMqttSettings) &&
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
          <div data-setting-anchor="connection.mqtt.maxRetries">
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
                  : protocol === 'meshcom'
                    ? t('connectionPanel.maxRetriesHelp.meshcom', {
                        max: MQTT_MAX_RECONNECT_ATTEMPTS,
                      })
                    : t('connectionPanel.maxRetriesHelp.meshtastic', {
                        max: MQTT_MAX_RECONNECT_ATTEMPTS,
                      })
              }
            />
          </div>
          {protocol === 'meshtastic' && (
            <div data-setting-anchor="connection.mqtt.channelPsks" className="space-y-1">
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
          {!(protocol === 'meshcore' && editingMeshcoreFeed) && (
            <div
              data-setting-anchor="connection.mqtt.autoConnect"
              className="flex items-center gap-2"
            >
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
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              data-setting-anchor="connection.mqtt.connect"
              variant="primary"
              onClick={async () => {
                setMqttError(null);
                if (protocol === 'meshcore' && editingMeshcoreFeed) {
                  connectMeshcoreFeedNow(editingMeshcoreFeed);
                  return;
                }
                const committedPsks = commitChannelPskDraft();
                const settings: Parameters<typeof window.electronAPI.mqtt.connect>[0] = {
                  ...activeMqttSettings,
                  channelPsks:
                    protocol === 'meshtastic' && committedPsks.length > 0
                      ? committedPsks
                      : undefined,
                  mqttTransportProtocol:
                    protocol === 'meshcore'
                      ? 'meshcore'
                      : protocol === 'meshcom'
                        ? 'meshcom'
                        : 'meshtastic',
                };
                if (protocol === 'meshcore') {
                  const iataPrepared = prepareMeshcoreIataMqttTopicPrefix(
                    activeMeshcorePreset,
                    settings,
                  );
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
                  usesMeshcoreDeviceSigningMqtt(activeMeshcorePreset, settings)
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
                        'mcL0410 [ConnectionPanel] LetsMesh auth token generation failed ' +
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
                  console.warn(
                    'mcL0411 [ConnectionPanel] mqtt.connect failed: ' + errLikeToLogString(err),
                  );
                });
              }}
              disabled={
                mqttStatus === 'connecting' ||
                (protocol === 'meshcore' &&
                  isIataScopedMeshcoreMqtt(activeMeshcorePreset, activeMqttSettings) &&
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

  // MeshCom national brokers are typically node-gateway only — collapse the MQTT panel
  // unless the user already has broker data or an active MQTT session.
  const hasMeshcomMqttData = shouldOpenMeshcomMqttPanel({
    server: meshcomMqttSettings.server,
    profileCount: meshcomMqttProfiles.length,
    mqttStatus,
  });
  const mqttSectionWrapped =
    protocol === 'meshcom' ? (
      <SettingsCollapsible
        title={t('connectionPanel.mqttConnection')}
        description={t('connectionPanel.meshcomMqttGatewayHint')}
        defaultOpen={hasMeshcomMqttData}
        anchorId="connection.mqtt.meshcom"
      >
        {mqttSection}
      </SettingsCollapsible>
    ) : (
      mqttSection
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
              setRendererStorageItem(COLORADO_MQTT_REGION_ACK_KEY, '1');
              setColoradoRegionGateOpen(false);
              if (meshcoreMqttSettingsRef.current.autoLaunch) {
                void tryAutoLaunchMqtt('meshcore').catch((err: unknown) => {
                  console.warn(
                    'mcL0412 [ConnectionPanel] MQTT auto-launch after Colorado stay failed: ' +
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
                setRendererStorageItem('mesh-client:mqttPreset:meshcore', 'letsmesh');
                persistMqttSettingsIfChanged(getMqttSettingsStorageKey('meshcore'), next);
                setRendererStorageItem(COLORADO_MQTT_REGION_ACK_KEY, '1');
                setColoradoRegionGateOpen(false);
                if (mqttStatus === 'connected' || mqttStatus === 'connecting') {
                  markMqttUserDisconnect();
                  try {
                    await window.electronAPI.mqtt.disconnect('meshcore');
                  } catch (err: unknown) {
                    console.warn(
                      'mcL0413 [ConnectionPanel] mqtt.disconnect after Colorado switch failed: ' +
                        errLikeToLogString(err),
                    );
                  }
                }
                if (next.autoLaunch) {
                  try {
                    await tryAutoLaunchMqtt('meshcore');
                  } catch (err: unknown) {
                    console.warn(
                      'mcL0414 [ConnectionPanel] MQTT auto-launch after Colorado switch failed: ' +
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
  const meshcomNetworkTime = useSyncExternalStore(
    subscribeMeshcomNetworkTime,
    getMeshcomNetworkTime,
    getMeshcomNetworkTime,
  );
  const meshcomNetworkNowMs = useNowMs(
    capabilities.hasMeshcomNetworkTime && meshcomNetworkTime != null,
  );
  const meshcomNetworkTimeDetail =
    capabilities.hasMeshcomNetworkTime && meshcomNetworkTime && meshcomNetworkNowMs > 0
      ? (() => {
          const ageMs = Math.max(0, meshcomNetworkNowMs - meshcomNetworkTime.heardAtMs);
          const age =
            ageMs < 60_000
              ? t('connectionPanel.tiles.meshcomNetworkTimeJustNow')
              : t('connectionPanel.tiles.meshcomNetworkTimeAgeMinutes', {
                  count: Math.max(1, Math.round(ageMs / 60_000)),
                });
          return t('connectionPanel.tiles.meshcomNetworkTime', {
            time: meshcomNetworkTime.text,
            age,
          });
        })()
      : null;
  const radioTileDetail = isConnected
    ? [
        state.connectionType
          ? connectionPanelConnectionTypeLabel(t, state.connectionType, protocol)
          : null,
        state.myNodeNum > 0
          ? (myNodeLabel ??
            (protocol === 'meshtastic'
              ? formatMeshtasticNodeId(state.myNodeNum)
              : String(state.myNodeNum)))
          : null,
        meshcomNetworkTimeDetail,
      ]
        .filter((part): part is string => !!part)
        .join(' · ')
    : (meshcomNetworkTimeDetail ?? '');
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

  const docsLinkClass = 'hover:text-bright-green text-muted text-xs transition-colors';
  const protocolGuideUrl = protocol === 'meshcore' ? MESHCORE_DOCS_URL : MESHTASTIC_DOCS_URL;
  const docsLink = (
    <>
      <DocsSiteLink
        href={troubleshootingDocsUrl(protocol)}
        labelKey="diagnosticsPanel.docsLink"
        className={docsLinkClass}
      />
      <DocsSiteLink
        href={protocolGuideUrl}
        labelKey="connectionPanel.protocolGuideLink"
        className={docsLinkClass}
      />
    </>
  );

  if (connectingProgressView) {
    return (
      <div data-panel-anchor="Connection" className="w-full space-y-4">
        {statusTiles}
        {connectingProgressView}
        {mqttSectionWrapped}
        {coloradoRegionGateModal}
      </div>
    );
  }

  if (capabilities.hasReticulumInterfaceConfig) {
    return (
      <div data-panel-anchor="Connection" className="w-full space-y-4">
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

  // Saved devices: show whenever we have history, including while connected (manage /
  // switch endpoints). Hide only during an in-progress local connect on the
  // disconnected view so Reconnect is not duplicated under the spinner.
  const showSavedDevices =
    connectionHistory.length > 0 && (isConnected || (!connecting && !isAutoConnecting));
  const savedDevicesSection = showSavedDevices ? (
    <div
      data-setting-anchor="connection.savedDevices"
      className="bg-deep-black border-ink-800 space-y-3 rounded-xl border px-4.5 py-4"
    >
      <p className="text-muted text-xs">{t('connectionPanel.savedDevicesLabel')}</p>
      <ul className="space-y-2">
        {connectionHistory.map((entry) => {
          const primary =
            savedConnectionPrimaryLabel(entry) ??
            (entry.type === 'ble'
              ? t('connectionPanel.bluetoothDevice')
              : entry.type === 'serial'
                ? t('connectionPanel.serialDevice')
                : t('connectionPanel.wifiDevice'));
          const bleIdentity = entry.type === 'ble' ? resolveLastBleIdentity(entry, protocol) : null;
          const actionName = savedDeviceActionName(primary, bleIdentity);
          const canReconnectBle = entry.type !== 'ble' || resolveSavedBleConnectId(entry) != null;
          return (
            <li
              key={entry.id}
              className="border-ink-800 bg-ink-900 rounded-control flex flex-wrap items-center gap-3 border px-3 py-2.5"
            >
              <span className="bg-sidebar-active-bg text-ink-300 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]">
                <ConnectionIcon type={entry.type} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-ink-200 truncate text-sm font-semibold">{primary}</p>
                {bleIdentity ? (
                  <p className="text-muted font-mono text-xs">{bleIdentity.display}</p>
                ) : (
                  <p className="text-muted text-xs">
                    {connectionPanelConnectionTypeLabel(t, entry.type, protocol)}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canReconnectBle ? (
                  <Button
                    data-setting-anchor="connection.savedDevices.connect"
                    variant="primary"
                    size="sm"
                    aria-label={t('connectionPanel.savedDevicesConnectAria', {
                      name: actionName,
                    })}
                    onClick={() => {
                      reconnectFromSaved(entry);
                    }}
                  >
                    {t('connectionPanel.reconnect')}
                  </Button>
                ) : null}
                <Button
                  data-setting-anchor="connection.savedDevices.delete"
                  variant="ghost"
                  size="sm"
                  aria-label={t('connectionPanel.savedDevicesDeleteAria', { name: actionName })}
                  onClick={() => {
                    handleDeleteSavedConnection(entry.id);
                  }}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  ) : null;

  // ─── Connected View ────────────────────────────────────────────
  if (isConnected) {
    const mqttActive = mqttStatus === 'connected' || mqttStatus === 'connecting';
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
      <div data-panel-anchor="Connection" className="w-full space-y-4">
        {statusTiles}
        {renderAutoReconnectBanner()}
        {protocol === 'meshcom' ? <MeshComConnectionHints /> : null}
        {savedDevicesSection}

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
                    {myNodeLabel ??
                      (protocol === 'meshtastic'
                        ? formatMeshtasticNodeId(state.myNodeNum)
                        : String(state.myNodeNum))}
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
                          'mcL0416 [ConnectionPanel] manual contact approval toggle failed: ' +
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

          {mqttSectionWrapped}
        </div>
        {coloradoRegionGateModal}
      </div>
    );
  }

  // ─── Disconnected View ─────────────────────────────────────────
  const connectionTypeOptions: SegmentedOption<ConnectionType>[] = (
    protocol === 'meshtastic'
      ? (['ble', 'serial', 'http', 'tcp'] as const)
      : protocol === 'meshcom'
        ? (['udp', 'http', 'netconsole', 'ble', 'serial'] as const) // http = KISS :8001
        : (['ble', 'serial', 'http'] as const)
  ).map((type) => ({
    value: type,
    label: connectionPanelConnectionTypeLabel(t, type, protocol),
    icon: <ConnectionIcon type={type} />,
  }));
  return (
    <div data-panel-anchor="Connection" className="w-full space-y-4">
      {statusTiles}
      {renderAutoReconnectBanner()}
      {protocol === 'meshcom' ? <MeshComConnectionHints /> : null}
      {savedDevicesSection}

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

            <fieldset
              data-setting-anchor="connection.radio.connectionType"
              className="min-w-0 space-y-2 border-0 p-0"
            >
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
              <div
                data-setting-anchor="connection.radio.httpAddress"
                className="max-w-md space-y-1"
              >
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
              <div data-setting-anchor="connection.radio.tcpAddress" className="max-w-md space-y-1">
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
                  <div
                    data-setting-anchor="connection.radio.meshcoreHost"
                    className="min-w-0 flex-1 space-y-1"
                  >
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
                  <div
                    data-setting-anchor="connection.radio.meshcorePort"
                    className="w-24 space-y-1"
                  >
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
            {(connectionType === 'udp' ||
              (connectionType === 'http' && protocol === 'meshcom') ||
              (connectionType === 'netconsole' && protocol === 'meshcom')) && (
              <div
                data-setting-anchor="connection.radio.meshcomHost"
                className="max-w-md space-y-1"
              >
                <label htmlFor="connection-meshcom-host" className="text-muted text-xs">
                  {t('connectionPanel.deviceAddress')}
                </label>
                <input
                  id="connection-meshcom-host"
                  type="text"
                  value={httpAddress}
                  onChange={(e) => {
                    setHttpAddress(e.target.value);
                  }}
                  placeholder={
                    connectionType === 'udp'
                      ? '192.168.1.x'
                      : connectionType === 'netconsole'
                        ? '192.168.1.x:2323'
                        : '192.168.1.x:8001'
                  }
                  className={INPUT_CLASS}
                  autoComplete="off"
                  aria-label={t('connectionPanel.deviceAddress')}
                />
                <p className="text-muted text-xs">
                  {connectionType === 'udp'
                    ? t('meshcom.extUdpHint')
                    : connectionType === 'netconsole'
                      ? t('meshcom.netConsoleHint')
                      : t('meshcom.kissTcpHint')}
                </p>
                {(connectionType === 'http' || connectionType === 'netconsole') && (
                  <div
                    data-setting-anchor="connection.radio.meshcomNodePassword"
                    className="space-y-1 pt-2"
                  >
                    <label htmlFor="connection-meshcom-passwd" className="text-muted text-xs">
                      {t('connectionPanel.kissPassword')}
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="connection-meshcom-passwd"
                        type={showMeshcomNodePassword ? 'text' : 'password'}
                        value={meshcomNodePassword}
                        onChange={(e) => {
                          setMeshcomNodePassword(e.target.value.slice(0, 14));
                        }}
                        className={INPUT_CLASS}
                        autoComplete="off"
                        aria-label={t('connectionPanel.kissPasswordAria')}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={
                          showMeshcomNodePassword
                            ? t('connectionPanel.hidePassword')
                            : t('connectionPanel.showPassword')
                        }
                        onClick={() => {
                          setShowMeshcomNodePassword((v) => !v);
                        }}
                      >
                        {showMeshcomNodePassword
                          ? t('connectionPanel.hidePassword')
                          : t('connectionPanel.showPassword')}
                      </Button>
                    </div>
                    <p className="text-muted text-xs">{t('connectionPanel.kissPasswordHelp')}</p>
                  </div>
                )}
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
                data-setting-anchor="connection.radio.connect"
                variant={showSavedDevices ? 'secondary' : 'primary'}
                onClick={handleConnect}
                disabled={
                  connecting ||
                  state.status === 'connecting' ||
                  ((connectionType === 'http' ||
                    connectionType === 'tcp' ||
                    connectionType === 'udp') &&
                    !activeHostAddress.trim())
                }
              >
                {t('connectionPanel.connectButton')}
              </Button>
            </div>
          </div>
        </Panel>

        {mqttSectionWrapped}
      </div>
      {coloradoRegionGateModal}
    </div>
  );
}
