/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs */
import { PARENT_HOVER_ATTR } from 'lucide-react-motion';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trans, useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatDisplayTime } from '@/renderer/lib/formatDisplayTime';
import { ConnectionIcon, MqttGlobeIcon } from '@/renderer/lib/icons/connectionIcons';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { SpinnerIcon, SpinnerIconLg } from '@/renderer/lib/icons/spinnerIcon';
import {
  awaitNobleBlePrimaryAutoConnectSettled,
  dualNobleBleBothRadiosConfigured,
  getNobleBleDualRadioPrimaryProtocol,
  initNobleBleDualRadioStartup,
  isNobleBleDualRadioSecondary,
  isRendererNobleBlePlatform,
  meshcoreTargetsSharedMeshtasticBlePeripheral,
  notifyNobleBlePrimaryAutoConnectSettled,
} from '@/renderer/lib/meshcoreDualNobleBleInit';
import { markMqttUserDisconnect } from '@/renderer/lib/mqttDisconnectIntent';
import { mqttUsesTls } from '@/renderer/lib/mqttTls';
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
import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';
import { clampTcpPort, parseTcpPortFromString } from '@/shared/tcpPort';

import { useActiveMeshIdentity } from '../hooks/useActiveMeshIdentity';
import { useHostLinkMeter } from '../hooks/useHostLinkMeter';
import { useNobleBleConnectMutexWait } from '../hooks/useNobleBleConnectMutexWait';
import {
  flushPendingMqttSave,
  getMqttSettingsStorageKey,
  loadProtocolMqttSettings,
  persistMqttSettingsIfChanged,
} from '../hooks/useProtocolMqttSettings';
import { reconnectBleWithScan, startNobleBleScanningWithRetry } from '../lib/bleReconnectHelper';
import {
  humanizeBleError,
  humanizeHttpError,
  humanizeReticulumSidecarError,
  humanizeSerialError,
} from '../lib/connectionPanelErrorHumanize';
import {
  COLORADO_MQTT_REGION_ACK_KEY,
  meshcoreMqttNeedsColoradoRegionAck,
  runConnectionPanelStorageMigrations,
} from '../lib/connectionPanelStorageMigrations';
import type { FirmwareCheckResult } from '../lib/firmwareCheck';
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
  meshcoreIdentityHasFullKeyPair,
  meshcoreIdentityHasPrivateKey,
  readMeshcoreIdentity,
  readMeshcoreIdentityAsync,
} from '../lib/letsMeshJwt';
import { translateMeshcoreUserMessage } from '../lib/meshcore/meshcoreMessageI18n';
import {
  applyMeshcoreMqttPreset,
  type MeshcoreMqttPreset,
  readStoredMeshcoreMqttPreset,
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
import { parseStoredJson } from '../lib/parseStoredJson';
import { getSerialPortNodeName } from '../lib/serialPortNodeNames';
import { LAST_SERIAL_PORT_KEY } from '../lib/serialPortSignature';
import { isWeakBleRssi } from '../lib/signal';
import { getStoredMeshProtocol } from '../lib/storedMeshProtocol';
import { POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS } from '../lib/timeConstants';
import type {
  ConnectionType,
  DeviceState,
  MeshProtocol,
  MQTTSettings,
  MQTTStatus,
  NobleBleDevice,
  SerialPortInfo,
} from '../lib/types';
import { useDeviceStore } from '../stores/deviceStore';
import { useTimeFormatStore } from '../stores/timeFormatStore';
import { BleWeakSignalBanner } from './BleWeakSignalBanner';
import { ConfirmModal } from './ConfirmModal';
import ConnectionBatteryGauge from './ConnectionBatteryGauge';
import ConnectionLinkMeter from './ConnectionLinkMeter';
import FirmwareStatusIndicator from './FirmwareStatusIndicator';
import { HelpTooltip } from './HelpTooltip';
import { ReticulumStackPanel } from './ReticulumStackPanel';
import SignalBars from './SignalBars';
// ─── Last Connection (localStorage) ───────────────────────────────
interface LastConnection {
  type: ConnectionType;
  httpAddress?: string;
  bleDeviceId?: string;
  bleDeviceName?: string;
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
const STAGE_WAITING_NOBLE_BLE_MESHTASTIC = 'connectionPanel.stageWaitingNobleBleMeshtastic';
const STAGE_WAITING_NOBLE_BLE_MESHCORE = 'connectionPanel.stageWaitingNobleBleMeshcore';

function resolveBleAutoConnectLabel(
  bleId: string,
  lc?: LastConnection | null,
  fallbackName?: string | null,
): string {
  return lc?.bleDeviceName ?? getBleDeviceName(bleId) ?? fallbackName ?? bleId;
}

function resolveConnectionStageText(
  stage: string,
  autoConnectTarget: string | null,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  if (!stage) return '';
  if (autoConnectTarget) {
    if (stage === STAGE_WAITING_NOBLE_BLE_MESHCORE) {
      return t('connectionPanel.stageWaitingNobleBleMeshcore', { deviceName: autoConnectTarget });
    }
    if (stage === STAGE_WAITING_NOBLE_BLE_MESHTASTIC) {
      return t('connectionPanel.stageWaitingNobleBleMeshtastic', { deviceName: autoConnectTarget });
    }
    if (
      stage === 'connectionPanel.stageConnecting' ||
      stage === 'connectionPanel.stageConnectingLast'
    ) {
      return t('connectionPanel.stageAutoConnectingBle', { deviceName: autoConnectTarget });
    }
  }
  return t(stage);
}

function shouldForgetGrantedWebBluetoothDevice(
  device: BluetoothDevice,
  macAddress: string,
  selectedName?: string | null,
): boolean {
  const normalizedMac = macAddress.replace(/:/g, '').toLowerCase();
  const macTail4 = normalizedMac.slice(-4);
  const devId = (device.id ?? '').toLowerCase();
  const devName = (device.name ?? '').toLowerCase();
  const selectedNameNorm = (selectedName ?? '').toLowerCase();
  return (
    devId.includes(normalizedMac) ||
    (macTail4.length === 4 && devName.includes(macTail4)) ||
    (selectedNameNorm.length > 0 && devName === selectedNameNorm)
  );
}

/** BLE pairing PIN: 1–6 digits (Linux Web Bluetooth / bluetoothctl; MeshCore may show shorter codes). */
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

function MqttGlobeStatusIcon({ status }: { status: MQTTStatus }) {
  const color =
    status === 'connected'
      ? 'text-brand-green'
      : status === 'connecting'
        ? 'text-yellow-400'
        : status === 'error'
          ? 'text-red-400'
          : 'text-gray-400';
  return <MqttGlobeIcon className={`h-5 w-5 ${color}`} />;
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
  /** Auto-connect is owned by ProtocolAutoConnectCoordinator when panels are tab-mounted. */
  suppressMountAutoConnect?: boolean;
}

export default function ConnectionPanel({
  state,
  onConnect,
  onAutoConnect,
  onDisconnect,
  mqttStatus,
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
  suppressMountAutoConnect = false,
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
  const nobleBleMutexWait = useNobleBleConnectMutexWait(protocol);
  const [showRePairButton, setShowRePairButton] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const showPinPromptRef = useRef(false);
  const [manualPairingFallback, setManualPairingFallback] = useState(false);
  const [pinInputValue, setPinInputValue] = useState('');
  const pinPromptSeenSinceRePairRef = useRef(false);
  const [pinCountdown, setPinCountdown] = useState<number | null>(null);
  const pinCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
      if (
        protocol !== 'meshcore' ||
        (meshcorePreset !== 'letsmesh' &&
          meshcorePreset !== 'meshmapper' &&
          meshcorePreset !== 'coloradomesh')
      )
        return;
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
  const [bleDevices, setBleDevices] = useState<NobleBleDevice[]>([]);
  const [showBlePicker, setShowBlePicker] = useState(false);
  const isLinux = window.electronAPI.getPlatform() === 'linux';
  const [webBluetoothDevice, setWebBluetoothDevice] = useState<{
    deviceId: string;
    deviceName: string;
  } | null>(null);

  // ─── Serial port picker state ─────────────────────────────────
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [showSerialPicker, setShowSerialPicker] = useState(false);

  // ─── Last connection + auto-connect state ─────────────────────
  const [lastConnection, setLastConnection] = useState<LastConnection | null>(() =>
    loadLastConnection(protocol),
  );
  const autoConnectFiredRef = useRef(false);
  const autoConnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set when the user starts a manual connect so deferred BLE auto-connect must not call onAutoConnect. */
  const autoConnectCancelRef = useRef(false);
  const isAutoConnectingRef = useRef(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [autoConnectBleTarget, setAutoConnectBleTarget] = useState<string | null>(null);
  const [sharedBleNotice, setSharedBleNotice] = useState(false);
  // Tracks BLE device name at selection time, used when saving LastConnection
  const lastSelectedBleNameRef = useRef<string | null>(null);
  // Tracks BLE device MAC for potential re-pairing on Linux
  const lastSelectedBleMacRef = useRef<string | null>(null);
  /**
   * Linux MeshCore Web Bluetooth: when `bluetoothctl` reports not paired, we must `pair` + PIN
   * before resolving `requestDevice()` — otherwise GATT connects without OS pairing and fails.
   */
  const pendingMeshcoreLinuxWbMacRef = useRef<string | null>(null);
  /** Linux Web Bluetooth: after the user picks a device, discovery must not reopen the embedded picker. */
  const bleLinuxPickerSelectionResolvedRef = useRef(false);
  /** Linux Web Bluetooth chooser generation from main — scopes cancelBluetoothSelection. */
  const linuxBleChooserGenerationRef = useRef<number | null>(null);
  /** MeshCore Linux reconnect: dedupe concurrent bluetoothGetInfo checks from repeated discovery events. */
  const meshcoreLinuxReconnectPairingCheckRef = useRef(false);
  const lastConnectionBleDeviceNameFallbackRef = useRef(lastConnection?.bleDeviceName);
  lastConnectionBleDeviceNameFallbackRef.current = lastConnection?.bleDeviceName;
  /** Prior store status for distinguishing pre-connect BLE scan from failed RF attempts. */
  const prevStoreStatusRef = useRef(state.status);
  /** Mount-only auto-connect reads latest props/state via refs so the effect can stay `[]`. */
  const deviceStateRef = useRef(state);
  deviceStateRef.current = state;
  const lastConnectionRef = useRef(lastConnection);
  lastConnectionRef.current = lastConnection;
  const connectionTypeRef = useRef(connectionType);
  connectionTypeRef.current = connectionType;
  const onAutoConnectRef = useRef(onAutoConnect);
  onAutoConnectRef.current = onAutoConnect;

  // Reload last connection when protocol switches (each protocol has its own key)
  useEffect(() => {
    setLastConnection(loadLastConnection(protocol));
  }, [protocol]);

  useEffect(() => {
    pendingMeshcoreLinuxWbMacRef.current = null;
  }, [protocol]);

  useEffect(() => {
    showPinPromptRef.current = showPinPrompt;
  }, [showPinPrompt]);

  const stopPinCountdown = useCallback(() => {
    if (pinCountdownIntervalRef.current) {
      clearInterval(pinCountdownIntervalRef.current);
      pinCountdownIntervalRef.current = null;
    }
    setPinCountdown(null);
  }, []);

  // Clear PIN countdown when prompt is dismissed - intentional sync setState for cleanup

  useEffect(() => {
    if (!showPinPrompt) stopPinCountdown();
  }, [showPinPrompt, stopPinCountdown]);

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
          const bleId = loadLastBleDevice(protocol);
          if (bleId) {
            conn.bleDeviceId = bleId;
            conn.bleDeviceName =
              getBleDeviceName(bleId) ??
              lastSelectedBleNameRef.current ??
              lastConnectionBleDeviceNameFallbackRef.current ??
              undefined;
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

  // Listen for BLE devices discovered by noble in main process
  useEffect(() => {
    return window.electronAPI.onNobleBleDeviceDiscovered((device) => {
      setBleDevices((prev) => {
        const idx = prev.findIndex((d) => d.deviceId === device.deviceId);
        if (idx >= 0) {
          const existing = prev[idx];
          if (!existing) return prev;
          const nextRssi = device.rssi !== undefined ? device.rssi : existing.rssi;
          if (existing.deviceName === device.deviceName && existing.rssi === nextRssi) {
            return prev;
          }
          const next = [...prev];
          next[idx] = { ...existing, deviceName: device.deviceName, rssi: nextRssi };
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
      if (connectionTypeRef.current === 'ble' && !isAutoConnectingRef.current) {
        setShowBlePicker(true);
        setConnectionStage('connectionPanel.stageScanning');
      }
    });
  }, [lastConnection, onConnect, protocol, t]); // isAutoConnecting intentionally omitted — ref handles it

  // Listen for Bluetooth devices discovered by main process (Linux Web Bluetooth)
  useEffect(() => {
    return window.electronAPI.onBluetoothDevicesDiscovered((devices, generation) => {
      if (typeof generation === 'number' && Number.isFinite(generation)) {
        linuxBleChooserGenerationRef.current = generation;
      }
      setBleDevices(devices);
      const lastId = lastConnectionRef.current?.bleDeviceId ?? loadLastBleDevice(protocol);
      if (
        isLinux &&
        isAutoConnectingRef.current &&
        lastId &&
        devices.some((d) => d.deviceId === lastId)
      ) {
        // MeshCore must OS-pair before GATT (same as handleSelectBleDevice). Auto-selecting here
        // skipped that gate and left reconnect stuck or broken for unpaired devices.
        if (protocol === 'meshcore') {
          if (meshcoreLinuxReconnectPairingCheckRef.current) return;
          meshcoreLinuxReconnectPairingCheckRef.current = true;
          void (async () => {
            try {
              const info = await window.electronAPI.bluetoothGetInfo(lastId);
              const paired = parseBluetoothctlPairedState(info);
              if (paired === 'yes') {
                bleLinuxPickerSelectionResolvedRef.current = true;
                setShowBlePicker(false);
                setConnectionStage('connectionPanel.stageConnectingSaved');
                window.electronAPI.selectBluetoothDevice(lastId);
                return;
              }
            } catch {
              // catch-no-log-ok — show picker to complete MeshCore pairing flow
            } finally {
              meshcoreLinuxReconnectPairingCheckRef.current = false;
            }
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            setShowBlePicker(true);
            setConnectionStage('connectionPanel.stageLinuxUnpaired');
          })();
          return;
        }
        bleLinuxPickerSelectionResolvedRef.current = true;
        setShowBlePicker(false);
        setConnectionStage('connectionPanel.stageConnectingSaved');
        window.electronAPI.selectBluetoothDevice(lastId);
        return;
      }
      const shouldShowEmbeddedPicker =
        connectionTypeRef.current === 'ble' &&
        !bleLinuxPickerSelectionResolvedRef.current &&
        !showPinPromptRef.current &&
        !pendingMeshcoreLinuxWbMacRef.current;
      if (shouldShowEmbeddedPicker) {
        setShowBlePicker(true);
        setConnectionStage('connectionPanel.stageSelectBluetooth');
      }
    });
  }, [protocol, isLinux]);

  // Listen for Bluetooth PIN required event (Linux Web Bluetooth pairing)
  useEffect(() => {
    if (!isLinux) return;
    return window.electronAPI.onBluetoothPinRequired((data) => {
      console.debug('[ConnectionPanel] Bluetooth PIN required for', data.deviceId);
      pinPromptSeenSinceRePairRef.current = true;
      setShowPinPrompt(true);
      setManualPairingFallback(false);
      setPinInputValue('');
      setConnectionStage('connectionPanel.stageEnterPin');
      // Start countdown: BlueZ pairing window is ~30s. Warn the user to enter quickly.
      const CHROMIUM_PAIRING_COUNTDOWN_SECS = 25;
      stopPinCountdown();
      setPinCountdown(CHROMIUM_PAIRING_COUNTDOWN_SECS);
      pinCountdownIntervalRef.current = setInterval(() => {
        setPinCountdown((prev) => {
          if (prev === null || prev <= 1) {
            if (pinCountdownIntervalRef.current) {
              clearInterval(pinCountdownIntervalRef.current);
              pinCountdownIntervalRef.current = null;
            }
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    });
  }, [isLinux, stopPinCountdown]);

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
    pinPromptSeenSinceRePairRef.current = false;
    console.debug('[ConnectionPanel] handleRePair END');
  }, [protocol, t]);

  // Handle PIN submission for pairing
  const handlePinSubmit = useCallback(async () => {
    stopPinCountdown();
    const normalizedPin = normalizePairingPin(pinInputValue);
    if (!normalizedPin) {
      setError(t('connectionPanel.error.pinFormat'));
      return;
    }
    const pendingWbMac = pendingMeshcoreLinuxWbMacRef.current;
    if (pendingWbMac && protocol === 'meshcore' && isLinux && !manualPairingFallback) {
      try {
        setError(null);
        setConnecting(true);
        setConnectionStage('connectionPanel.stagePairingBluetooth');
        await window.electronAPI.bluetoothPair(pendingWbMac, normalizedPin);
        try {
          await window.electronAPI.bluetoothGetInfo(pendingWbMac);
        } catch {
          // catch-no-log-ok -- diagnostics only
        }
        pendingMeshcoreLinuxWbMacRef.current = null;
        setShowPinPrompt(false);
        setPinInputValue('');
        setConnectionStage('connectionPanel.stageConnecting');
        window.electronAPI.selectBluetoothDevice(pendingWbMac);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          '[ConnectionPanel] MeshCore pre-connect pair failed: ' + errLikeToLogString(err),
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
        } catch {
          // catch-no-log-ok -- untrust is best-effort, ignore all failures
        }
        if (navigator.bluetooth) {
          try {
            const devices = await navigator.bluetooth.getDevices();
            for (const device of devices) {
              if (
                shouldForgetGrantedWebBluetoothDevice(
                  device,
                  manualMac,
                  lastSelectedBleNameRef.current ?? null,
                )
              ) {
                await device.forget();
              }
            }
          } catch (e) {
            console.warn(
              '[ConnectionPanel] Failed to forget Web Bluetooth device: ' + errLikeToLogString(e),
            );
          }
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
    console.debug('[ConnectionPanel] Providing PIN for pairing');
    window.electronAPI.provideBluetoothPin(normalizedPin);
    setConnectionStage('connectionPanel.stagePairing');
    setShowPinPrompt(false);
    setPinInputValue('');
  }, [pinInputValue, manualPairingFallback, isLinux, protocol, stopPinCountdown, t]);

  // Handle PIN prompt cancel
  const handlePinCancel = useCallback(() => {
    stopPinCountdown();
    if (pendingMeshcoreLinuxWbMacRef.current) {
      pendingMeshcoreLinuxWbMacRef.current = null;
      bleLinuxPickerSelectionResolvedRef.current = false;
      const generation = linuxBleChooserGenerationRef.current;
      linuxBleChooserGenerationRef.current = null;
      void window.electronAPI.cancelBluetoothSelection(generation).catch((e: unknown) => {
        console.debug('[ConnectionPanel] cancelBluetoothSelection failed ' + errLikeToLogString(e));
      });
      setShowPinPrompt(false);
      setPinInputValue('');
      setConnecting(false);
      setConnectionStage('');
      return;
    }
    console.debug('[ConnectionPanel] Cancelling pairing');
    if (!manualPairingFallback) {
      window.electronAPI.cancelBluetoothPairing();
    }
    setShowPinPrompt(false);
    setManualPairingFallback(false);
    setPinInputValue('');
    setConnecting(false);
    setConnectionStage('');
  }, [manualPairingFallback, stopPinCountdown]);

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
    // Panel-local autoConnectCancelRef is inert when suppressMountAutoConnect — also cancel the
    // ProtocolAutoConnectCoordinator path.
    autoConnectCancelRef.current = true;
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
    bleLinuxPickerSelectionResolvedRef.current = false;
    setConnectionStage('connectionPanel.stagePleaseWait');

    if (connectionType === 'ble') {
      if (isLinux) {
        console.debug('[ConnectionPanel] handleConnect Linux BLE path');
        setConnectionStage('connectionPanel.stageSelectBluetoothDots');
        // Same-tick IPC: select-bluetooth-device can fire before React commits connectionType;
        // discovery uses connectionTypeRef for shouldShowEmbeddedPicker.
        connectionTypeRef.current = 'ble';
        // Clear any stale Chromium chooser session before a new requestDevice().
        // Must await: fire-and-forget cancel raced behind select-bluetooth-device and
        // cancelled the new chooser (immediate "User cancelled the requestDevice() chooser").
        // Pass the prior generation when known so a delayed cancel cannot hit the next chooser;
        // omit generation only when we have no tracked session (force-clear orphans).
        const priorGeneration = linuxBleChooserGenerationRef.current;
        linuxBleChooserGenerationRef.current = null;
        try {
          await window.electronAPI.cancelBluetoothSelection(priorGeneration);
        } catch (e: unknown) {
          console.debug(
            '[ConnectionPanel] cancelBluetoothSelection failed ' + errLikeToLogString(e),
          );
          setConnecting(false);
          setConnectionStage('');
          return;
        }
        pendingMeshcoreLinuxWbMacRef.current = null;
        bleLinuxPickerSelectionResolvedRef.current = false;
        setShowBlePicker(false);
        try {
          console.debug('[ConnectionPanel] handleConnect calling onConnect');
          await onConnect('ble', undefined);
          console.debug('[ConnectionPanel] handleConnect onConnect succeeded');
          setConnecting(false);
          setConnectionStage('');
          return;
        } catch (err) {
          // catch-no-log-ok -- error is humanized and surfaced via setError
          const bleErrMsg = humanizeBleError(err, t);
          const mac = lastSelectedBleMacRef.current;
          if (mac) {
            try {
              await window.electronAPI.bluetoothGetInfo(mac);
            } catch {
              // catch-no-log-ok -- diagnostics only
            }
          }
          if (bleErrMsg) setError(bleErrMsg);
          const showRePairFromBleError = shouldShowLinuxRePairFromBleError(err, bleErrMsg);
          if (showRePairFromBleError) {
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
          return;
        }
      }
      // Noble (macOS/Windows): manual Connect always opens the scanner so the user can pick any device.
      // Reconnect to the last device uses handleReconnect / startup auto-connect instead.
      setConnectionStage('connectionPanel.stageScanning');
      try {
        await startNobleBleScanningWithRetry(protocol);
      } catch (err) {
        console.warn('[ConnectionPanel] startNobleBleScanning failed: ' + errLikeToLogString(err));
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
  }, [connectionType, activeHostAddress, onConnect, protocol, isLinux, t]);

  const handleCancelConnection = useCallback(async () => {
    autoConnectCancelRef.current = true;
    cancelProtocolRfAutoConnect(protocol);
    isAutoConnectingRef.current = false;
    setIsAutoConnecting(false);
    if (autoConnectTimeoutRef.current) {
      clearTimeout(autoConnectTimeoutRef.current);
      autoConnectTimeoutRef.current = null;
    }
    if (showBlePicker || connectionType === 'ble') {
      if (isLinux) {
        if (showBlePicker || pendingMeshcoreLinuxWbMacRef.current) {
          // Cancel in-flight requestDevice() (picker or MeshCore pre-connect PIN gate)
          const generation = linuxBleChooserGenerationRef.current;
          linuxBleChooserGenerationRef.current = null;
          void window.electronAPI.cancelBluetoothSelection(generation).catch((e: unknown) => {
            console.debug(
              '[ConnectionPanel] cancelBluetoothSelection failed ' + errLikeToLogString(e),
            );
          });
        }
        pendingMeshcoreLinuxWbMacRef.current = null;
        setShowPinPrompt(false);
        setManualPairingFallback(false);
        if (webBluetoothDevice) {
          setWebBluetoothDevice(null);
        }
      } else {
        void window.electronAPI.stopNobleBleScanning(protocol).catch((e: unknown) => {
          console.debug('[ConnectionPanel] stopNobleBleScanning failed ' + errLikeToLogString(e));
        });
      }
    }
    if (showSerialPicker) {
      window.electronAPI.cancelSerialSelection();
    }
    setShowBlePicker(false);
    setShowSerialPicker(false);
    bleLinuxPickerSelectionResolvedRef.current = false;
    setConnecting(false);
    setConnectionStage('');
    // Ensure the underlying connection attempt is properly torn down
    try {
      console.debug('[ConnectionPanel] handleCancelConnection onDisconnect');
      await onDisconnect();
    } catch (e) {
      console.debug('[ConnectionPanel] onDisconnect best-effort cleanup ' + errLikeToLogString(e));
    }
  }, [
    showBlePicker,
    showSerialPicker,
    onDisconnect,
    connectionType,
    protocol,
    isLinux,
    webBluetoothDevice,
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
      // Store MAC address for potential re-pairing on Linux
      lastSelectedBleMacRef.current = deviceId;
      setShowBlePicker(false);
      if (isLinux) {
        bleLinuxPickerSelectionResolvedRef.current = true;
      }
      setShowRePairButton(false);
      if (isLinux && protocol === 'meshcore') {
        setConnectionStage('connectionPanel.stageCheckingPairing');
        void (async () => {
          try {
            const info = await window.electronAPI.bluetoothGetInfo(deviceId);
            const paired = parseBluetoothctlPairedState(info);
            if (paired === 'yes') {
              setConnectionStage('connectionPanel.stageConnecting');
              window.electronAPI.selectBluetoothDevice(deviceId);
              return;
            }
          } catch {
            // catch-no-log-ok -- if bluetoothctl info fails, continue to explicit PIN pairing flow
          }
          pendingMeshcoreLinuxWbMacRef.current = deviceId;
          setManualPairingFallback(false);
          setPinInputValue('');
          setShowPinPrompt(true);
          setConnectionStage('connectionPanel.stageEnterPinLinux');
        })();
        return;
      }
      setConnectionStage('connectionPanel.stageConnecting');
      if (isLinux) {
        // Web Bluetooth path: requestDevice() is pending. Resolve the deferred promise
        // so that the original onConnect's requestDevice() returns and proceeds to connect().
        console.debug(
          '[ConnectionPanel] handleSelectBleDevice Linux: resolving pending requestDevice',
        );
        window.electronAPI.selectBluetoothDevice(deviceId);
        // Don't call onConnect again - the original onConnect will continue from requestDevice()
        // and proceed to connect(), which triggers the pairing handler.
      } else {
        void window.electronAPI.stopNobleBleScanning(protocol).catch((e: unknown) => {
          console.debug('[ConnectionPanel] stopNobleBleScanning failed ' + errLikeToLogString(e));
        });
        // Trigger the actual connection with the peripheral ID
        onConnect('ble', undefined, deviceId).catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.warn(`[ConnectionPanel] BLE connect after selection failed ${errMsg}`);
          const bleErrMsg = humanizeBleError(err, t);
          if (bleErrMsg) setError(bleErrMsg);
          setConnecting(false);
          setConnectionStage('');
        });
      }
    },
    [bleDevices, isLinux, onConnect, protocol, t],
  );

  const handleSelectSerialPort = useCallback((portId: string) => {
    saveLastSerialPort(portId);
    window.electronAPI.selectSerialPort(portId);
    setShowSerialPicker(false);
    setConnectionStage('connectionPanel.stageConnecting');
  }, []);

  // Auto-connect on mount: fires once per session using saved last connection.
  // Serial and BLE use gesture-free reconnect when the platform remembers the device.
  // HTTP still uses the one-click reconnect card (no autoconnect on mount).
  useEffect(() => {
    if (suppressMountAutoConnect) return;
    initNobleBleDualRadioStartup();

    const notifyPrimaryAutoConnectSettledIfNeeded = () => {
      if (
        dualNobleBleBothRadiosConfigured() &&
        getNobleBleDualRadioPrimaryProtocol() === protocol
      ) {
        notifyNobleBlePrimaryAutoConnectSettled();
      }
    };

    if (capabilities.hasReticulumInterfaceConfig) {
      notifyPrimaryAutoConnectSettledIfNeeded();
      return;
    }

    if (autoConnectFiredRef.current) return;
    if (deviceStateRef.current.status !== 'disconnected') {
      notifyPrimaryAutoConnectSettledIfNeeded();
      return;
    }
    const lc = lastConnectionRef.current;
    if (!lc) {
      notifyPrimaryAutoConnectSettledIfNeeded();
      return;
    }

    autoConnectFiredRef.current = true;
    autoConnectCancelRef.current = false;

    const lastBleId = lc.bleDeviceId ?? loadLastBleDevice(protocol);

    const startAutoConnectTimeout = () => {
      if (autoConnectTimeoutRef.current) clearTimeout(autoConnectTimeoutRef.current);
      autoConnectTimeoutRef.current = setTimeout(() => {
        console.warn('[ConnectionPanel] auto-connect timed out after 30s');
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        setAutoConnectBleTarget(null);
        setError(t('connectionPanel.error.autoConnectTimeout'));
        setConnecting(false);
        setConnectionStage('');
      }, 30_000);
    };

    const onAutoConnectFailed = (err: unknown, transport: 'serial' | 'ble' = 'ble') => {
      if (autoConnectTimeoutRef.current) {
        clearTimeout(autoConnectTimeoutRef.current);
        autoConnectTimeoutRef.current = null;
      }
      isAutoConnectingRef.current = false;
      setIsAutoConnecting(false);
      setAutoConnectBleTarget(null);
      setConnecting(false);
      setConnectionStage('');
      // Setup AbortError is intentional (disconnect / superseded connect) — not a user-facing failure.
      if (transport === 'ble' && humanizeBleError(err, t) === '') {
        console.debug('[ConnectionPanel] auto-connect cancelled ' + errLikeToLogString(err));
        return;
      }
      const errMsg =
        err instanceof Error
          ? transport === 'serial'
            ? humanizeSerialError(err, t)
            : humanizeBleError(err, t)
          : t('connectionPanel.error.autoConnectFailed');
      setError(errMsg || t('connectionPanel.error.autoConnectFailed'));
    };

    const maybeNotifyPrimaryBleAutoConnectSettled = notifyPrimaryAutoConnectSettledIfNeeded;

    const startBleNobleAutoConnect = (): boolean => {
      if (!lastBleId || isLinux) {
        maybeNotifyPrimaryBleAutoConnectSettled();
        return false;
      }
      void (async () => {
        if (autoConnectCancelRef.current) {
          maybeNotifyPrimaryBleAutoConnectSettled();
          return;
        }
        const bleTargetLabel = resolveBleAutoConnectLabel(
          lastBleId,
          lc,
          lastConnectionBleDeviceNameFallbackRef.current,
        );
        setAutoConnectBleTarget(bleTargetLabel);
        setConnectionType('ble');
        isAutoConnectingRef.current = true;
        setIsAutoConnecting(true);
        setConnecting(true);
        setShowBlePicker(false);
        setConnectionStage('connectionPanel.stageConnecting');
        // Primary: notify secondary after the first connect attempt (not after scan fallback).
        await reconnectBleWithScan(protocol, lastBleId, () => {
          if (autoConnectCancelRef.current) {
            return Promise.reject(new DOMException('Auto-connect cancelled', 'AbortError'));
          }
          const attempt = onAutoConnectRef.current('ble', undefined, undefined, lastBleId);
          if (
            dualNobleBleBothRadiosConfigured() &&
            getNobleBleDualRadioPrimaryProtocol() === protocol
          ) {
            // `finally` returns a new promise; voiding it without catch surfaces the same
            // rejection again as unhandledrejection even when `attempt` is awaited below.
            void attempt.finally(maybeNotifyPrimaryBleAutoConnectSettled).catch(() => {
              // catch-no-log-ok — rejection is handled by reconnectBleWithScan's await of `attempt`
            });
          }
          return attempt;
        });
        if (autoConnectCancelRef.current) {
          maybeNotifyPrimaryBleAutoConnectSettled();
          return;
        }
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        setConnecting(false);
        setConnectionStage('');
      })().catch(onAutoConnectFailed);
      return true;
    };

    const skipMeshcoreSharedMeshtasticBleAutoConnect = (): boolean => {
      if (protocol !== 'meshcore' || !meshcoreTargetsSharedMeshtasticBlePeripheral(lastBleId)) {
        return false;
      }
      console.debug(
        `[ConnectionPanel] meshcore BLE auto-connect skipped — same peripheral as Meshtastic (${lastBleId})`,
      );
      if (autoConnectTimeoutRef.current) {
        clearTimeout(autoConnectTimeoutRef.current);
        autoConnectTimeoutRef.current = null;
      }
      isAutoConnectingRef.current = false;
      setIsAutoConnecting(false);
      setConnecting(false);
      setConnectionStage('');
      maybeNotifyPrimaryBleAutoConnectSettled();
      if (getStoredMeshProtocol() === 'meshcore') {
        setSharedBleNotice(true);
      }
      return true;
    };

    const runSecondaryBleAutoConnect = async (bleId: string) => {
      const primary = getNobleBleDualRadioPrimaryProtocol();
      const bleTargetLabel = resolveBleAutoConnectLabel(
        bleId,
        lc,
        lastConnectionBleDeviceNameFallbackRef.current,
      );
      setAutoConnectBleTarget(bleTargetLabel);
      setConnectionType('ble');
      isAutoConnectingRef.current = true;
      setIsAutoConnecting(true);
      setConnecting(true);
      setShowBlePicker(false);
      setConnectionStage(
        primary === 'meshtastic'
          ? STAGE_WAITING_NOBLE_BLE_MESHTASTIC
          : STAGE_WAITING_NOBLE_BLE_MESHCORE,
      );
      await awaitNobleBlePrimaryAutoConnectSettled(POWER_RESUME_MESHCORE_MESHTASTIC_SETTLE_MS);
      if (autoConnectCancelRef.current) {
        console.debug(
          `[ConnectionPanel] ${protocol} secondary BLE auto-connect cancelled after primary settle`,
        );
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        setAutoConnectBleTarget(null);
        setConnecting(false);
        setConnectionStage('');
        return;
      }
      setConnectionStage('connectionPanel.stageConnecting');
      void reconnectBleWithScan(protocol, bleId, () => {
        if (autoConnectCancelRef.current) {
          return Promise.reject(new DOMException('Auto-connect cancelled', 'AbortError'));
        }
        return onAutoConnectRef.current('ble', undefined, undefined, bleId);
      })
        .then(() => {
          if (autoConnectCancelRef.current) return;
          isAutoConnectingRef.current = false;
          setIsAutoConnecting(false);
          setConnecting(false);
          setConnectionStage('');
        })
        .catch(onAutoConnectFailed);
    };

    const runBleAutoConnectWithDefer = async () => {
      if (skipMeshcoreSharedMeshtasticBleAutoConnect()) return;
      const bleId = lastBleId;
      const secondary = isNobleBleDualRadioSecondary(protocol);
      if (secondary) {
        if (!bleId) {
          console.warn(`[ConnectionPanel] ${protocol} dual-radio auto-connect skipped — no BLE id`);
          return;
        }
        await runSecondaryBleAutoConnect(bleId);
        return;
      }
      const started = startBleNobleAutoConnect();
      if (!started) {
        console.warn(
          `[ConnectionPanel] BLE auto-connect skipped for ${protocol} — no remembered device`,
        );
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        setConnecting(false);
        setConnectionStage('');
      }
    };

    const migrateLastConnectionToBle = (bleDeviceId: string) => {
      const bleLast: LastConnection = {
        type: 'ble',
        bleDeviceId,
        bleDeviceName:
          lc.bleDeviceName ?? lastConnectionBleDeviceNameFallbackRef.current ?? undefined,
      };
      saveLastConnection(protocol, bleLast);
      setLastConnection(bleLast);
    };

    if (lc.type === 'serial') {
      setConnectionType('serial');
      isAutoConnectingRef.current = true;
      setIsAutoConnecting(true);
      setConnecting(true);
      setConnectionStage('connectionPanel.stagePleaseWait');
      startAutoConnectTimeout();
      void onAutoConnectRef.current('serial', undefined, lc.serialPortId).catch((err: unknown) => {
        if (lastBleId && !isLinux) {
          console.warn(
            `[ConnectionPanel] serial auto-connect failed for ${protocol}; falling back to BLE noble scan: ${errLikeToLogString(err)}`,
          );
          migrateLastConnectionToBle(lastBleId);
          void runBleAutoConnectWithDefer();
          return;
        }
        onAutoConnectFailed(err, 'serial');
        maybeNotifyPrimaryBleAutoConnectSettled();
      });
    } else if (lc.type === 'ble') {
      if (lastBleId && !isLinux) {
        void runBleAutoConnectWithDefer();
      } else {
        maybeNotifyPrimaryBleAutoConnectSettled();
      }
    } else {
      maybeNotifyPrimaryBleAutoConnectSettled();
    }
    // HTTP/TCP launch auto-connect is owned by ProtocolAutoConnectCoordinator /
    // useProtocolRfAutoConnect; this panel path only settles (reconnect card if needed).
  }, [protocol, isLinux, t, capabilities.hasReticulumInterfaceConfig, suppressMountAutoConnect]);

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
    autoConnectCancelRef.current = true;
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
        bleLinuxPickerSelectionResolvedRef.current = false;
        meshcoreLinuxReconnectPairingCheckRef.current = false;
        isAutoConnectingRef.current = true;
        setIsAutoConnecting(true);
        setConnecting(true);
        if (isLinux) {
          // Web Bluetooth path: use onConnect directly (NOT connectAutomatic which skips BLE for MeshCore)
          // This is a user gesture, so requestDevice() is allowed.
          setConnectionStage('connectionPanel.stageReconnecting');
          // Same-tick IPC: discovery may run before setConnectionType('ble') commits; picker gating uses connectionTypeRef.
          connectionTypeRef.current = 'ble';
          // Mirror handleConnect: await cancel so a stale chooser cannot merge into the new requestDevice().
          const priorGeneration = linuxBleChooserGenerationRef.current;
          linuxBleChooserGenerationRef.current = null;
          try {
            await window.electronAPI.cancelBluetoothSelection(priorGeneration);
          } catch (e: unknown) {
            console.debug(
              '[ConnectionPanel] cancelBluetoothSelection failed ' + errLikeToLogString(e),
            );
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            setConnecting(false);
            setConnectionStage('');
            return;
          }
          pendingMeshcoreLinuxWbMacRef.current = null;
          bleLinuxPickerSelectionResolvedRef.current = false;
          try {
            await onConnect('ble', undefined);
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            setConnecting(false);
            setConnectionStage('');
          } catch (err: unknown) {
            // catch-no-log-ok reconnect errors surfaced via setError/humanizeBleError
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            const bleErrMsg = humanizeBleError(err, t);
            if (bleErrMsg) setError(bleErrMsg);
            const isPairingRelatedError = shouldShowLinuxRePairFromBleError(err, bleErrMsg);
            if (isPairingRelatedError) {
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
        } else {
          const bleDeviceId = lastConnection.bleDeviceId;
          setConnectionStage('connectionPanel.stageConnecting');
          try {
            await reconnectBleWithScan(protocol, bleDeviceId, () =>
              onConnect('ble', undefined, bleDeviceId),
            );
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            setConnecting(false);
            setConnectionStage('');
          } catch (err: unknown) {
            // catch-no-log-ok reconnect errors surfaced via setError/humanizeBleError
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            const bleErrMsg = humanizeBleError(err, t);
            if (bleErrMsg) setError(bleErrMsg);
            setConnecting(false);
            setConnectionStage('');
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
    t,
  ]);

  const isConnected =
    state.status === 'connected' ||
    state.status === 'configured' ||
    state.status === 'stale' ||
    state.status === 'reconnecting';

  useEffect(() => {
    const rfBusy =
      connecting ||
      isAutoConnecting ||
      state.status === 'connecting' ||
      state.status === 'reconnecting';
    if (!rfBusy || !isRendererNobleBlePlatform()) return;

    if (nobleBleMutexWait.waitingOnNobleBlePeer) {
      // Mutex peer wait: show who holds the mutex (`active`), not dual-radio primary.
      // Using primaryProtocol alone made MeshCore show "Waiting for MeshCore… Meshtastic will
      // connect" while MeshCore itself was queued behind Meshtastic GATT.
      const waitingFor =
        nobleBleMutexWait.waitingForPeer && nobleBleMutexWait.active
          ? nobleBleMutexWait.active
          : nobleBleMutexWait.primaryProtocol;
      if (waitingFor === 'meshtastic') {
        setConnectionStage(STAGE_WAITING_NOBLE_BLE_MESHTASTIC);
      } else if (waitingFor === 'meshcore') {
        setConnectionStage(STAGE_WAITING_NOBLE_BLE_MESHCORE);
      }
      return;
    }

    if (
      nobleBleMutexWait.active === protocol &&
      (connectionStage === STAGE_WAITING_NOBLE_BLE_MESHTASTIC ||
        connectionStage === STAGE_WAITING_NOBLE_BLE_MESHCORE)
    ) {
      setConnectionStage('connectionPanel.stageConnecting');
    }
  }, [
    connecting,
    isAutoConnecting,
    state.status,
    protocol,
    nobleBleMutexWait.waitingOnNobleBlePeer,
    nobleBleMutexWait.waitingForPeer,
    nobleBleMutexWait.active,
    nobleBleMutexWait.primaryProtocol,
    connectionStage,
  ]);

  const handleExitApp = useCallback(
    async (variant: 'connected' | 'idle' | 'connecting') => {
      try {
        if (variant === 'connecting') {
          await handleCancelConnection();
        } else if (isConnected) {
          await Promise.race([
            onDisconnect(),
            new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
          ]);
        }
        if (isConnected || variant === 'connecting' || mqttStatus === 'connected') {
          markMqttUserDisconnect();
          void window.electronAPI.mqtt.disconnect().catch((err: unknown) => {
            // catch-no-log-ok quit path — disconnect failure must not block quitApp
            console.warn(
              '[ConnectionPanel] mqtt.disconnect before quit failed:',
              err instanceof Error ? err.message : String(err),
            );
          });
        }
      } catch (err) {
        console.warn(
          '[ConnectionPanel] handleExitApp disconnect failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
      try {
        await window.electronAPI.quitApp();
      } catch (err) {
        console.error(
          '[ConnectionPanel] quitApp failed:',
          err instanceof Error ? err.message : String(err),
        );
      }
    },
    [handleCancelConnection, isConnected, mqttStatus, onDisconnect],
  );

  const renderExitActions = (variant: 'connected' | 'idle' | 'connecting') => {
    const useDisconnectAndQuit =
      isConnected || variant === 'connecting' || mqttStatus === 'connected';
    const labelKey = useDisconnectAndQuit
      ? 'connectionPanel.disconnectAndQuit'
      : 'connectionPanel.quit';
    return (
      <button
        type="button"
        onClick={() => {
          void handleExitApp(variant);
        }}
        className="w-full rounded-lg border border-red-700 px-6 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-900/30 hover:text-red-300"
        aria-label={t(labelKey)}
      >
        {t(labelKey)}
      </button>
    );
  };

  // ─── Connecting Progress View ───────────────────────────────────
  const rfSessionPending =
    connecting ||
    isAutoConnecting ||
    state.status === 'connecting' ||
    state.status === 'reconnecting';
  const showNobleBleWaitNotice =
    nobleBleMutexWait.waitingOnNobleBlePeer && rfSessionPending && isRendererNobleBlePlatform();

  const showAutoReconnectBanner =
    isAutoConnecting ||
    state.status === 'reconnecting' ||
    connecting ||
    nobleBleMutexWait.waitingForPrimaryAutoConnect;

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
  if (
    !capabilities.hasReticulumInterfaceConfig &&
    ((connecting && !isConnected) || (showNobleBleWaitNotice && state.status !== 'configured'))
  ) {
    connectingProgressView = (
      <div className="flex w-full flex-col items-center justify-center space-y-6 py-16">
        <div className="w-full">{renderExitActions('connecting')}</div>
        {renderAutoReconnectBanner()}
        <SpinnerIconLg className="text-bright-green" />
        <div className="space-y-2 text-center">
          <h2 className="text-xl font-semibold text-gray-200">
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
                  ? 'rounded-lg border border-amber-500/45 bg-amber-950/40 px-4 py-3 text-sm text-amber-200'
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
                  className="mt-2 rounded-lg border border-amber-800/60 bg-amber-900/40 px-3 py-2 text-xs text-amber-200"
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
            className="bg-deep-black w-full overflow-hidden rounded-lg border border-gray-600"
          >
            <div className="bg-secondary-dark flex items-center justify-between border-b border-gray-600 px-4 py-2.5">
              <span id="ble-device-picker-heading" className="text-sm font-medium text-gray-200">
                {t('connectionPanel.selectBluetoothDevice')}
              </span>
              <span className="text-xs text-gray-300" aria-live="polite">
                {t('connectionPanel.devicesFound', { count: bleDevices.length })}
              </span>
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
                (() => {
                  const bleDeviceNamesCache =
                    parseStoredJson<Record<string, string>>(
                      localStorage.getItem('mesh-client:bleDeviceNames'),
                      'ConnectionPanel bleDeviceNames list',
                    ) ?? {};
                  return bleDevices.map((device) => {
                    const cached = bleDeviceNamesCache[device.deviceId];
                    const advertisedName = device.deviceName || null;
                    const displayName = cached
                      ? advertisedName && advertisedName !== cached
                        ? `${cached} (${advertisedName})`
                        : cached
                      : (advertisedName ?? device.deviceId);
                    const hasRssi = device.rssi != null && Number.isFinite(device.rssi);
                    const bleAriaLabel = hasRssi
                      ? `${displayName} ${device.deviceId} ${Math.round(device.rssi!)} dBm`
                      : `${displayName} ${device.deviceId}`;
                    return (
                      <button
                        key={device.deviceId}
                        type="button"
                        aria-label={bleAriaLabel}
                        {...{ [PARENT_HOVER_ATTR]: '' }}
                        onClick={() => {
                          handleSelectBleDevice(device.deviceId);
                        }}
                        className="hover:bg-secondary-dark w-full border-b border-gray-700 px-4 py-3 text-left transition-colors last:border-b-0"
                      >
                        <div className="flex items-center gap-2 text-sm text-gray-200">
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
                        <div className="text-muted ml-7 font-mono text-xs">{device.deviceId}</div>
                      </button>
                    );
                  });
                })()
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
              <p className="text-muted border-t border-gray-700 px-4 py-2 text-xs">
                {t('connectionPanel.hintAdaDfuBle')}
              </p>
            )}
            {protocol === 'meshcore' && (
              <p className="border-t border-gray-700 px-4 py-2 text-xs text-yellow-400">
                <Trans
                  i18nKey="connectionPanel.meshcoreBlePairingHint"
                  components={{ strong: <strong /> }}
                />
              </p>
            )}
          </div>
        )}

        {/* Embedded Serial Port Picker */}
        {showSerialPicker && (
          <div
            role="region"
            aria-labelledby="serial-port-picker-heading"
            className="bg-deep-black w-full overflow-hidden rounded-lg border border-gray-600"
          >
            <div className="bg-secondary-dark flex items-center justify-between border-b border-gray-600 px-4 py-2.5">
              <span id="serial-port-picker-heading" className="text-sm font-medium text-gray-200">
                {t('connectionPanel.selectSerialPort')}
              </span>
              <span className="text-xs text-gray-300" aria-live="polite">
                {t('connectionPanel.devicesFound', { count: serialPorts.length })}
              </span>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {serialPorts.length === 0 ? (
                <div className="text-muted px-4 py-6 text-center text-sm">
                  {t('connectionPanel.noSerialPorts')}
                </div>
              ) : (
                serialPorts.map((port) => {
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
                      className="hover:bg-secondary-dark w-full border-b border-gray-700 px-4 py-3 text-left transition-colors last:border-b-0"
                    >
                      <div className="flex items-center gap-2 text-sm text-gray-200">
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
          <div className="w-full rounded-lg border border-red-700 bg-red-900/50 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Re-pair button for Linux BLE pairing issues */}
        {showRePairButton && (
          <div className="flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={handleRePair}
              className="rounded-lg bg-orange-600 px-4 py-2 font-medium text-white transition-colors hover:bg-orange-700"
            >
              {t('connectionPanel.rePairDevice')}
            </button>
          </div>
        )}

        {/* PIN input prompt for Linux BLE pairing (connecting view) */}
        {showPinPrompt && (
          <div className="w-full rounded-lg border border-blue-700 bg-blue-900/50 px-4 py-3 text-blue-300">
            <p className="mb-2 text-sm">{t('connectionPanel.enterPin')}</p>
            {pinCountdown !== null && (
              <p
                className={`mb-2 text-xs ${pinCountdown <= 10 ? 'font-semibold text-red-400' : 'text-blue-400'}`}
              >
                {t('connectionPanel.pinExpiring', { count: pinCountdown })}
              </p>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={pinInputValue}
                onChange={(e) => {
                  setPinInputValue(e.target.value.replace(/\D/g, '').slice(0, 6));
                }}
                placeholder={t('connectionPanel.pinPlaceholder')}
                className="flex-1 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <button
                type="button"
                onClick={handlePinSubmit}
                disabled={!normalizePairingPin(pinInputValue)}
                className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {t('connectionPanel.submit')}
              </button>
              <button
                type="button"
                onClick={handlePinCancel}
                className="rounded bg-gray-600 px-4 py-1.5 font-medium text-white hover:bg-gray-700"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleCancelConnection}
          className="bg-secondary-dark rounded-lg px-6 py-2.5 font-medium text-gray-300 transition-colors hover:bg-gray-600"
        >
          {t('common.cancel')}
        </button>
      </div>
    );
  }

  // ─── Shared MQTT section ────────────────────────────────────────
  const mqttHeaderBar = (
    <div className="bg-secondary-dark flex items-center justify-between border-b border-gray-700 px-4 py-3">
      <div className="flex items-center gap-2">
        <MqttGlobeStatusIcon status={mqttStatus} />
        <span className="font-medium text-gray-200">{t('connectionPanel.mqttConnection')}</span>
      </div>
      <span
        className={`text-xs font-medium ${
          mqttStatus === 'connected'
            ? 'text-brand-green'
            : mqttStatus === 'connecting'
              ? 'animate-pulse text-yellow-400'
              : mqttStatus === 'error'
                ? 'text-red-400'
                : 'text-gray-300'
        }`}
        aria-live="polite"
      >
        <span aria-hidden="true">● </span>
        {mqttStatus === 'connected'
          ? t('connectionPanel.mqttStatusConnected')
          : mqttStatus === 'connecting'
            ? t('connectionPanel.mqttStatusConnecting')
            : mqttStatus === 'error'
              ? t('connectionPanel.mqttStatusError')
              : t('connectionPanel.mqttStatusDisconnected')}
      </span>
    </div>
  );

  const mqttSection =
    mqttStatus === 'connected' ? (
      <div className="bg-deep-black overflow-hidden rounded-lg border border-gray-700">
        {mqttHeaderBar}
        {mqttError && (
          <div className="border-b border-red-800 bg-red-900/50 px-4 py-2 text-xs text-red-300">
            {mqttError}
          </div>
        )}
        {mqttWarning && (
          <div className="border-b border-amber-800/60 bg-amber-900/40 px-4 py-2 text-xs text-amber-200">
            {mqttWarning}
          </div>
        )}
        <div className="space-y-3 p-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t('connectionPanel.server')}</span>
            <span className="text-gray-200">
              {activeMqttSettings.server}:{activeMqttSettings.port}
            </span>
          </div>
          {protocol === 'meshcore' &&
            /^v1_[0-9a-f]{64}$/i.test(activeMqttSettings.username ?? '') && (
              <div className="flex justify-between text-sm">
                <span className="text-muted">{t('connectionPanel.from')}</span>
                <span className="font-mono text-xs text-gray-200">
                  {activeMqttSettings.username?.slice(3)}
                </span>
              </div>
            )}
          {protocol === 'meshtastic' && state.myNodeNum > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted">{t('connectionPanel.from')}</span>
              <span className="font-mono text-xs text-gray-200">
                {formatMeshtasticNodeId(state.myNodeNum)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t('connectionPanel.topic')}</span>
            <span className="font-mono text-xs text-gray-200">
              {activeMqttSettings.topicPrefix.endsWith('/')
                ? activeMqttSettings.topicPrefix
                : `${activeMqttSettings.topicPrefix}/`}
              #
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label htmlFor="mqtt-max-retries-when-connected" className="text-muted text-xs">
                {t('connectionPanel.maxReconnectAttempts')}
              </label>
              <HelpTooltip
                text={
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
            <input
              id="mqtt-max-retries-when-connected"
              type="number"
              aria-label={t('connectionPanel.maxReconnectAttempts')}
              min={1}
              max={MQTT_MAX_RECONNECT_ATTEMPTS}
              value={activeMqttSettings.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS}
              onChange={(e) => {
                updateMqtt('maxRetries', clampMqttMaxRetries(e.target.value), false);
              }}
              className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              markMqttUserDisconnect();
              window.electronAPI.mqtt
                .disconnect(protocol === 'meshcore' ? 'meshcore' : 'meshtastic')
                .catch((err: unknown) => {
                  console.warn(
                    '[ConnectionPanel] mqtt.disconnect failed: ' + errLikeToLogString(err),
                  );
                });
            }}
            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500"
          >
            {t('connectionPanel.disconnectMqtt')}
          </button>
        </div>
      </div>
    ) : (
      <div className="bg-deep-black overflow-hidden rounded-lg border border-gray-700">
        {mqttHeaderBar}
        {mqttError && (
          <div className="border-b border-red-800 bg-red-900/50 px-4 py-2 text-xs text-red-300">
            {mqttError}
          </div>
        )}
        <div className="space-y-3 p-4">
          {protocol !== 'meshcore' && (
            <div className="space-y-1">
              <p id="conn-meshtastic-network-preset" className="text-muted text-xs">
                {t('connectionPanel.networkPreset')}
              </p>
              <div
                className="flex gap-2"
                role="group"
                aria-labelledby="conn-meshtastic-network-preset"
              >
                {(
                  [
                    {
                      id: 'official-plain' as const,
                      labelKey: 'connectionPanel.meshtasticPreset.officialPlain',
                    },
                    { id: 'liam' as const, labelKey: 'connectionPanel.meshtasticPreset.liam' },
                    { id: 'custom' as const, labelKey: 'connectionPanel.meshtasticPreset.custom' },
                  ] as const
                ).map(({ id, labelKey }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
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
                    className={`flex-1 rounded border px-2 py-1.5 text-xs font-medium transition-colors ${
                      meshtasticPreset === id
                        ? 'bg-brand-green/20 border-brand-green text-brand-green'
                        : 'bg-secondary-dark border-gray-600 text-gray-300 hover:border-gray-400 hover:text-gray-100'
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
              {meshtasticPreset === 'liam' && (
                <p className="text-xs text-amber-400">{t('connectionPanel.liamServerNote')}</p>
              )}
            </div>
          )}
          {protocol === 'meshcore' && (
            <div className="space-y-1">
              <p id="conn-meshcore-network-preset" className="text-muted text-xs">
                {t('connectionPanel.networkPreset')}
              </p>
              <div
                className="flex gap-2"
                role="group"
                aria-labelledby="conn-meshcore-network-preset"
              >
                {(
                  [
                    { id: 'letsmesh', labelKey: 'connectionPanel.meshcorePreset.letsmesh' },
                    { id: 'meshmapper', labelKey: 'connectionPanel.meshcorePreset.meshmapper' },
                    { id: 'coloradomesh', labelKey: 'connectionPanel.meshcorePreset.coloradomesh' },
                    { id: 'ripple', labelKey: 'connectionPanel.meshcorePreset.ripple' },
                    { id: 'custom', labelKey: 'connectionPanel.meshcorePreset.custom' },
                  ] as const
                ).map(({ id, labelKey }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      if (id === 'custom') {
                        setMeshcorePreset(id);
                        return;
                      }
                      if (id === 'ripple') {
                        if (!window.confirm(t('connectionPanel.ripplePresetConfirm'))) return;
                      }
                      if (id === 'coloradomesh') {
                        if (!window.confirm(t('connectionPanel.coloradoPresetConfirm'))) return;
                        localStorage.setItem(COLORADO_MQTT_REGION_ACK_KEY, '1');
                      }
                      setMeshcorePreset(id);
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setMeshcoreMqttSettings((prev) => ({
                        ...applyMeshcoreMqttPreset(id, prev),
                        username: fromIdentity || prev.username,
                      }));
                    }}
                    className={`flex-1 rounded border px-2 py-1.5 text-xs font-medium transition-colors ${
                      meshcorePreset === id
                        ? 'bg-brand-green/20 border-brand-green text-brand-green'
                        : 'bg-secondary-dark border-gray-600 text-gray-300 hover:border-gray-400 hover:text-gray-100'
                    }`}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
              {meshcorePreset === 'coloradomesh' && (
                <p className="text-xs text-amber-400">{t('connectionPanel.coloradoServerNote')}</p>
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
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setMeshcoreMqttSettings((prev) => ({
                        ...prev,
                        server: LETSMESH_HOST_US,
                        port: 443,
                        useWebSocket: true,
                        keepalive: 60,
                        username: fromIdentity || prev.username,
                      }));
                    }}
                    className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                      meshcoreMqttSettings.server === LETSMESH_HOST_US
                        ? 'bg-brand-green/20 border-brand-green text-brand-green'
                        : 'bg-secondary-dark border-gray-600 text-gray-300 hover:border-gray-400 hover:text-gray-100'
                    }`}
                  >
                    US
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setMeshcoreMqttSettings((prev) => ({
                        ...prev,
                        server: LETSMESH_HOST_EU,
                        port: 443,
                        useWebSocket: true,
                        keepalive: 60,
                        username: fromIdentity || prev.username,
                      }));
                    }}
                    className={`rounded border px-2 py-1 text-xs font-medium transition-colors ${
                      meshcoreMqttSettings.server === LETSMESH_HOST_EU
                        ? 'bg-brand-green/20 border-brand-green text-brand-green'
                        : 'bg-secondary-dark border-gray-600 text-gray-300 hover:border-gray-400 hover:text-gray-100'
                    }`}
                  >
                    EU
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <div className="col-span-2 space-y-1">
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
                className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
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
                className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
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
              className="accent-brand-green"
            />
            <label htmlFor="mqtt-tls-enabled" className="cursor-pointer text-xs text-gray-300">
              {t('connectionPanel.mqttTlsEnabled')}
            </label>
          </div>
          {activeMqttTls && (
            <div className="flex items-center gap-2 rounded border border-amber-700/50 bg-amber-900/20 px-2 py-2">
              <input
                type="checkbox"
                id="mqtt-tls-insecure"
                checked={activeMqttSettings.tlsInsecure ?? false}
                onChange={(e) => {
                  updateMqtt('tlsInsecure', e.target.checked);
                }}
                className="accent-brand-green"
              />
              <label
                htmlFor="mqtt-tls-insecure"
                className="cursor-pointer text-xs text-amber-200/90"
              >
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
              className="accent-brand-green"
            />
            <label htmlFor="mqtt-websocket" className="cursor-pointer text-xs text-gray-300">
              {t('connectionPanel.useWebSocket')}{' '}
              <span className="text-gray-500">{t('connectionPanel.wsRequired')}</span>
            </label>
          </div>
          {protocol === 'meshcore' &&
            (meshcorePreset === 'letsmesh' ||
              meshcorePreset === 'coloradomesh' ||
              meshcorePreset === 'meshmapper') &&
            letsMeshPresetConfigurationDeviation(meshcoreMqttSettings) && (
              <div className="rounded border border-amber-700/50 bg-amber-900/20 px-2 py-2 text-xs text-amber-200/90">
                {meshcorePreset === 'letsmesh'
                  ? t('connectionPanel.meshcorePresetDeviation.letsmesh')
                  : meshcorePreset === 'coloradomesh'
                    ? t('connectionPanel.meshcorePresetDeviation.coloradomesh')
                    : t('connectionPanel.meshcorePresetDeviation.meshmapper')}
              </div>
            )}
          {protocol === 'meshcore' &&
            (meshcorePreset === 'letsmesh' ||
              meshcorePreset === 'coloradomesh' ||
              meshcorePreset === 'meshmapper') && (
              <div
                className={`flex items-start gap-2 rounded border px-2 py-2 text-xs ${
                  hasPrivateKey
                    ? 'border-brand-green/40 bg-brand-green/10 text-brand-green/90'
                    : 'border-amber-700/50 bg-amber-900/20 text-amber-200/90'
                }`}
              >
                {hasPrivateKey && readMeshcoreIdentity()?.public_key
                  ? t('connectionPanel.meshcoreMqttIdentity.hasPrivateKey')
                  : t('connectionPanel.meshcoreMqttIdentity.noPrivateKey')}
              </div>
            )}
          {protocol === 'meshcore' && (
            <div className="bg-secondary-dark/40 flex items-start gap-2 rounded border border-gray-600/50 px-2 py-2 text-xs text-gray-300">
              <input
                type="checkbox"
                id="meshcore-packet-logger"
                checked={meshcoreMqttSettings.meshcorePacketLoggerEnabled ?? false}
                onChange={(e) => {
                  updateMqtt('meshcorePacketLoggerEnabled', e.target.checked);
                }}
                className="accent-brand-green mt-0.5 shrink-0"
              />
              <label htmlFor="meshcore-packet-logger" className="cursor-pointer leading-snug">
                {t('connectionPanel.meshcorePacketLogger.label', {
                  topic: `{topicPrefix}/meshcore/packets`,
                })}
              </label>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
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
                className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
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
                  className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 pr-8 text-sm text-gray-200 focus:outline-none"
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
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-300"
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
                    : meshcorePreset === 'letsmesh' ||
                        meshcorePreset === 'meshmapper' ||
                        meshcorePreset === 'coloradomesh' ||
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
              className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
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
              <p className="text-xs text-amber-400" role="alert">
                {t('connectionPanel.topicPrefixInvalidIata')}
              </p>
            ) : null}
            {radioMqttRootDiverges ? (
              <p className="text-xs text-amber-400" role="status">
                {t('connectionPanel.radioMqttRootDivergesWarning', {
                  radioRoot: radioMqttRoot,
                  appPrefix: normalizeMeshtasticMqttTopicPrefix(activeMqttSettings.topicPrefix),
                })}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label htmlFor="mqtt-max-retries" className="text-muted text-xs">
                {t('connectionPanel.maxRetries')}
              </label>
              <HelpTooltip
                text={
                  protocol === 'meshcore'
                    ? t('connectionPanel.maxRetriesHelp.meshcore')
                    : t('connectionPanel.maxRetriesHelp.meshtastic', {
                        max: MQTT_MAX_RECONNECT_ATTEMPTS,
                      })
                }
              />
            </div>
            <input
              id="mqtt-max-retries"
              type="number"
              min={1}
              max={MQTT_MAX_RECONNECT_ATTEMPTS}
              value={activeMqttSettings.maxRetries ?? MQTT_DEFAULT_RECONNECT_ATTEMPTS}
              onChange={(e) => {
                updateMqtt('maxRetries', clampMqttMaxRetries(e.target.value), false);
              }}
              className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
            />
          </div>
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
                className="bg-secondary-dark focus:border-brand-green w-full resize-none rounded border border-gray-600 px-2 py-1.5 font-mono text-sm text-gray-200 focus:outline-none"
                placeholder={t('connectionPanel.channelPsksPlaceholder')}
                spellCheck={false}
              />
              {channelPskWarn && (
                <p className="text-xs text-amber-300/90" role="status">
                  {channelPskWarn}
                </p>
              )}
              {showMqttOnlyChannelPskIndexHint && (
                <p className="text-xs text-amber-300/90" role="status">
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
              className="accent-brand-green"
            />
            <label htmlFor="mqttAutoLaunch" className="cursor-pointer text-sm text-gray-300">
              {t('connectionPanel.autoConnect')}
            </label>
          </div>
          <div className={`flex pt-1 ${mqttStatus === 'connecting' ? 'gap-2' : 'flex-col'}`}>
            {mqttStatus === 'connecting' && (
              <button
                type="button"
                aria-label={t('connectionPanel.cancelMqttConnect')}
                onClick={() => {
                  markMqttUserDisconnect();
                  window.electronAPI.mqtt
                    .disconnect(protocol === 'meshcore' ? 'meshcore' : 'meshtastic')
                    .catch((err: unknown) => {
                      console.warn(
                        '[ConnectionPanel] mqtt.disconnect (cancel) failed: ' +
                          errLikeToLogString(err),
                      );
                    });
                }}
                className="bg-secondary-dark flex-1 rounded-lg border border-gray-600 px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:border-gray-500 hover:bg-gray-700"
              >
                {t('connectionPanel.cancelMqttConnect')}
              </button>
            )}
            <button
              type="button"
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
                  (meshcorePreset === 'letsmesh' ||
                    meshcorePreset === 'coloradomesh' ||
                    meshcorePreset === 'meshmapper')
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
              className={`bg-readable-green hover:bg-readable-green/90 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-40 ${mqttStatus === 'connecting' ? 'flex-1' : 'w-full'}`}
            >
              {t('connectionPanel.connectMqtt')}
            </button>
          </div>
        </div>
      </div>
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

  if (connectingProgressView) {
    return (
      <div className="w-full space-y-6">
        {connectingProgressView}
        {mqttSection}
        {coloradoRegionGateModal}
      </div>
    );
  }

  if (capabilities.hasReticulumInterfaceConfig) {
    const exitVariant = isConnected
      ? 'connected'
      : state.status === 'connecting'
        ? 'connecting'
        : 'idle';
    return (
      <div className="w-full space-y-6">
        {renderExitActions(exitVariant)}
        <ReticulumStackPanel
          connecting={state.status === 'connecting'}
          stackError={reticulumStackError}
          onOpenReticulumRmapSettings={onOpenReticulumRmapSettings}
          onOpenAppGpsSettings={onOpenAppGpsSettings}
          onOpenAdminBluetooth={onOpenAdminBluetooth}
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
    return (
      <div className="w-full space-y-6">
        {renderExitActions('connected')}
        {renderAutoReconnectBanner()}

        <div className="bg-deep-black overflow-hidden rounded-lg border border-gray-700">
          <div className="bg-secondary-dark flex items-center justify-between border-b border-gray-700 px-4 py-3">
            <div className="flex items-center gap-2">
              <ConnectionIcon type={state.connectionType!} />
              <span className="font-medium text-gray-200">
                {t('connectionPanel.radioConnection')}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/Colorado-Mesh/mesh-client/blob/main/docs/troubleshooting.md"
                target="_blank"
                rel="noreferrer"
                className="hover:text-brand-green text-xs text-gray-300 transition-colors"
              >
                Docs ↗
              </a>
              <span
                className={`inline-flex items-center gap-1 text-xs font-medium ${
                  state.status === 'reconnecting' ? 'text-orange-200' : 'text-brand-green'
                }`}
              >
                {state.status === 'reconnecting' ? (
                  <span aria-hidden className="inline-block animate-pulse">
                    ●
                  </span>
                ) : (
                  <>●</>
                )}{' '}
                {state.status}
              </span>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted">{t('connectionPanel.connectionType')}</span>
              <span className="text-gray-200 uppercase">{state.connectionType}</span>
            </div>
            {hostLinkMeter.kind != null && (
              <ConnectionLinkMeter
                kind={hostLinkMeter.kind}
                rssi={hostLinkMeter.rssi}
                rttMs={hostLinkMeter.rttMs}
                level={hostLinkMeter.level}
              />
            )}
            {state.myNodeNum > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted">{t('connectionPanel.myNode')}</span>
                <span className="font-mono text-gray-200">
                  {myNodeLabel ?? formatMeshtasticNodeId(state.myNodeNum)}
                </span>
              </div>
            )}
            {state.myNodeNum > 0 && state.batteryPercent !== undefined && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{t('connectionPanel.battery')}</span>
                <ConnectionBatteryGauge
                  percent={state.batteryPercent}
                  charging={state.batteryCharging === true}
                />
              </div>
            )}
            {state.firmwareVersion && (
              <div className="flex justify-between text-sm">
                <span className="text-muted">{t('connectionPanel.firmware')}</span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="font-mono text-xs text-gray-300">{state.firmwareVersion}</span>
                  {firmwareCheckState && onOpenFirmwareReleases && (
                    <FirmwareStatusIndicator
                      phase={firmwareCheckState.phase}
                      latestVersion={firmwareCheckState.latestVersion}
                      onOpenReleases={onOpenFirmwareReleases}
                    />
                  )}
                </span>
              </div>
            )}
            {state.lastDataReceived && (
              <div className="flex justify-between text-sm">
                <span className="text-muted">{t('connectionPanel.lastData')}</span>
                <span className="text-xs text-gray-300">
                  {formatDisplayTime(state.lastDataReceived, { use24Hour: use24HourTime })}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={onDisconnect}
              className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500"
            >
              {t('connectionPanel.disconnectRadio')}
            </button>
          </div>
        </div>

        {onToggleManualContacts !== undefined && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-gray-700 p-4">
            <div id="manual-contact-approval-label">
              <div className="text-sm font-medium text-gray-200">
                {t('connectionPanel.manualContactApproval')}
              </div>
              <div className="text-muted mt-0.5 text-xs">
                {t('connectionPanel.manualContactApprovalDesc')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onToggleManualContacts(!manualAddContacts)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                manualAddContacts ? 'bg-purple-500' : 'bg-gray-600'
              }`}
              role="switch"
              aria-checked={manualAddContacts}
              aria-labelledby="manual-contact-approval-label"
            >
              <span
                aria-hidden="true"
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  manualAddContacts ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}

        {mqttSection}
        {coloradoRegionGateModal}
      </div>
    );
  }

  // ─── Disconnected View ─────────────────────────────────────────
  return (
    <div className="w-full space-y-6">
      {renderExitActions('idle')}
      {renderAutoReconnectBanner()}

      {/* Last Connection — one-click reconnect card */}
      {lastConnection && !connecting && (
        <div className="bg-deep-black space-y-3 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ConnectionIcon type={lastConnection.type} />
              <div>
                <p className="text-sm font-medium text-gray-200">
                  {lastConnection.type === 'ble'
                    ? (lastConnection.bleDeviceName ?? t('connectionPanel.bluetoothDevice'))
                    : lastConnection.type === 'serial'
                      ? t('connectionPanel.serialDevice')
                      : (lastConnection.httpAddress ?? t('connectionPanel.wifiDevice'))}
                </p>
                <p className="text-muted text-xs uppercase">{lastConnection.type}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleReconnect}
              className="bg-readable-green hover:bg-readable-green/90 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
            >
              {t('connectionPanel.reconnect')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              clearLastConnection(protocol);
              setLastConnection(null);
            }}
            className="text-xs text-gray-400 transition-colors hover:text-gray-200"
          >
            {t('connectionPanel.forgetDevice')}
          </button>
        </div>
      )}

      {/* Radio Connection card */}
      <div className="bg-deep-black overflow-hidden rounded-lg border border-gray-700">
        {/* Header */}
        <div className="bg-secondary-dark flex items-center justify-between border-b border-gray-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <ConnectionIcon type={connectionType} />
            <span className="font-medium text-gray-200">
              {t('connectionPanel.radioConnection')}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/Colorado-Mesh/mesh-client/blob/main/docs/troubleshooting.md"
              target="_blank"
              rel="noreferrer"
              className="hover:text-brand-green text-xs text-gray-300 transition-colors"
            >
              Docs ↗
            </a>
            <span className="text-xs font-medium text-gray-400">
              {t('connectionPanel.disconnected')}
            </span>
          </div>
        </div>

        {/* Inline error */}
        {sharedBleNotice && (
          <div
            className="border-b border-amber-700 bg-amber-900/30 px-4 py-2 text-xs text-amber-200"
            role="status"
          >
            <p>{t('connectionPanel.sharedBleWithMeshtastic')}</p>
            <p className="text-muted/80 mt-1">{t('connectionPanel.sharedBleWithMeshtasticHint')}</p>
          </div>
        )}
        {error && (
          <div className="border-b border-red-800 bg-red-900/50 px-4 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
        {showAutoReconnectBanner && (
          <div className="border-b border-cyan-800/60 bg-cyan-950/30 px-4 py-2 text-xs text-cyan-100">
            {t('connectionPanel.autoReconnectInProgress')}
          </div>
        )}

        {showRePairButton && isLinux && connectionType === 'ble' && (
          <div className="border-b border-orange-800 bg-orange-900/30 px-4 py-2">
            <button
              type="button"
              onClick={handleRePair}
              className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-orange-700"
            >
              {t('connectionPanel.rePairDevice')}
            </button>
          </div>
        )}

        {/* PIN input prompt for Linux BLE pairing (disconnected view) */}
        {showPinPrompt && (
          <div className="border-b border-blue-800 bg-blue-900/30 px-4 py-3 text-blue-200">
            <p className="mb-2 text-sm">{t('connectionPanel.enterPin')}:</p>
            {pinCountdown !== null && (
              <p
                className={`mb-2 text-xs ${pinCountdown <= 10 ? 'font-semibold text-red-400' : 'text-blue-400'}`}
              >
                {t('connectionPanel.pinExpiring', { count: pinCountdown })}
              </p>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={pinInputValue}
                onChange={(e) => {
                  setPinInputValue(e.target.value.replace(/\D/g, '').slice(0, 6));
                }}
                placeholder={t('connectionPanel.pinPlaceholder')}
                className="flex-1 rounded border border-gray-600 bg-gray-800 px-3 py-1.5 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <button
                type="button"
                onClick={() => {
                  void handlePinSubmit();
                }}
                disabled={!normalizePairingPin(pinInputValue)}
                className="rounded bg-blue-600 px-4 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {t('connectionPanel.submit')}
              </button>
              <button
                type="button"
                onClick={handlePinCancel}
                className="rounded bg-gray-600 px-4 py-1.5 font-medium text-white hover:bg-gray-700"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="space-y-3 p-4">
          {/* Connection type selector */}
          <fieldset className="min-w-0 space-y-2 border-0 p-0">
            <legend id="connection-type-legend" className="text-muted text-xs">
              {t('connectionPanel.connectionType')}
            </legend>
            {protocol === 'meshtastic' ? (
              <div
                role="radiogroup"
                aria-labelledby="connection-type-legend"
                className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
              >
                {(['ble', 'serial', 'http', 'tcp'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={connectionType === type}
                    {...{ [PARENT_HOVER_ATTR]: '' }}
                    onClick={() => {
                      setConnectionType(type);
                    }}
                    className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                      connectionType === type
                        ? 'ring-bright-green bg-readable-green text-white ring-2'
                        : 'bg-secondary-dark text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    <ConnectionIcon type={type} trigger={parentIconTrigger} />
                    {type === 'ble' && t('connectionPanel.bluetooth')}
                    {type === 'serial' && t('connectionPanel.usbSerial')}
                    {type === 'http' && t('connectionPanel.wifiHttp')}
                    {type === 'tcp' && t('connectionPanel.wifiTcp')}
                  </button>
                ))}
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-labelledby="connection-type-legend"
                className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
              >
                {(['ble', 'serial', 'http'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={connectionType === type}
                    {...{ [PARENT_HOVER_ATTR]: '' }}
                    onClick={() => {
                      setConnectionType(type);
                    }}
                    className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-all ${
                      connectionType === type
                        ? 'bg-violet-600 text-white ring-2 ring-purple-500'
                        : 'bg-secondary-dark text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    <ConnectionIcon type={type} trigger={parentIconTrigger} />
                    {type === 'ble' && t('connectionPanel.bluetooth')}
                    {type === 'serial' && t('connectionPanel.usbSerial')}
                    {type === 'http' && t('connectionPanel.tcpIp')}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {/* HTTP / TCP address input */}
          {connectionType === 'http' && protocol === 'meshtastic' && (
            <div className="space-y-1">
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
                className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
                autoComplete="off"
              />
              <p className="text-muted text-xs">{t('connectionPanel.deviceAddressHint')}</p>
              {navigator.userAgent.toLowerCase().includes('windows') && (
                <p className="text-xs text-yellow-400">{t('connectionPanel.windowsMdnsNote')}</p>
              )}
            </div>
          )}
          {connectionType === 'tcp' && protocol === 'meshtastic' && (
            <div className="space-y-1">
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
                className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
                autoComplete="off"
              />
              <p className="text-muted text-xs">{t('connectionPanel.tcpAddressHint')}</p>
            </div>
          )}
          {connectionType === 'http' && protocol === 'meshcore' && (
            <div className="space-y-1">
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
                    className="bg-secondary-dark w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:border-purple-500 focus:outline-none"
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
                    className="bg-secondary-dark w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:border-purple-500 focus:outline-none"
                    aria-label={t('connectionPanel.meshcorePort')}
                  />
                </div>
              </div>
              <p className="text-muted text-xs">{t('connectionPanel.meshcoreHostHint')}</p>
            </div>
          )}

          {/* Connection hints */}
          <div className="bg-secondary-dark space-y-1 rounded-lg p-3 text-xs text-gray-300">
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

          {/* Connect button */}
          <div className="pt-1">
            <button
              type="button"
              onClick={handleConnect}
              disabled={
                connecting ||
                state.status === 'connecting' ||
                ((connectionType === 'http' || connectionType === 'tcp') &&
                  !activeHostAddress.trim())
              }
              className="bg-readable-green hover:bg-readable-green/90 w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('connectionPanel.connectButton')}
            </button>
          </div>
        </div>
      </div>

      {mqttSection}
      {coloradoRegionGateModal}
    </div>
  );
}
