/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs */
import type { TFunction } from 'i18next';
import { PARENT_HOVER_ATTR } from 'lucide-react-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { ConnectionIcon, MqttGlobeIcon } from '@/renderer/lib/icons/connectionIcons';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { SpinnerIcon, SpinnerIconLg } from '@/renderer/lib/icons/spinnerIcon';
import { markMqttUserDisconnect } from '@/renderer/lib/mqttDisconnectIntent';
import { mqttUsesTls } from '@/renderer/lib/mqttTls';
import { parseTcpAddress } from '@/renderer/lib/parseTcpAddress';
import {
  MQTT_DEFAULT_RECONNECT_ATTEMPTS,
  MQTT_MAX_RECONNECT_ATTEMPTS,
} from '@/shared/meshtasticMqttReconnect';
import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import { MESHCORE_SETUP_ABORT_MESSAGE } from '../lib/bleConnectErrors';
import type { FirmwareCheckResult } from '../lib/firmwareCheck';
import {
  letsMeshPresetConfigurationDeviation,
  validateLetsMeshManualCredentials,
  validateLetsMeshPresetConnect,
} from '../lib/letsMeshConnectionGuards';
import {
  COLORADO_MESH_HOST,
  generateLetsMeshAuthToken,
  LETSMESH_HOST_EU,
  LETSMESH_HOST_US,
  letsMeshMqttUsernameFromIdentity,
  meshcoreIdentityHasFullKeyPair,
  meshcoreIdentityHasPrivateKey,
  MESHMAPPER_HOST,
  readMeshcoreIdentity,
  readMeshcoreIdentityAsync,
} from '../lib/letsMeshJwt';
import { readMeshcoreMqttSettingsFromStorage } from '../lib/meshcoreMqttSettingsStorage';
import { meshcoreMqttUserFacingHint } from '../lib/meshcoreMqttUserHint';
import {
  formatChannelPskInput,
  parseChannelPskInput,
  validateChannelPskEntries,
} from '../lib/meshtasticChannelPskInput';
import {
  MESHTASTIC_MQTT_SETTINGS_KEY,
  readMeshtasticMqttSettingsFromStorage,
} from '../lib/meshtasticMqttSettingsStorage';
import {
  isLiamBrokerSettings,
  isMeshtasticOfficialBrokerSettings,
  MESHTASTIC_LIAM_1883,
  MESHTASTIC_OFFICIAL_1883,
  meshtasticMqttErrorUserHint,
} from '../lib/meshtasticMqttTlsMigration';
import { parseStoredJson } from '../lib/parseStoredJson';
import { LAST_SERIAL_PORT_KEY } from '../lib/serialPortSignature';
import type {
  ConnectionType,
  DeviceState,
  MeshProtocol,
  MQTTSettings,
  MQTTStatus,
  NobleBleDevice,
  SerialPortInfo,
} from '../lib/types';
import ConnectionBatteryGauge from './ConnectionBatteryGauge';
import FirmwareStatusIndicator from './FirmwareStatusIndicator';
import { HelpTooltip } from './HelpTooltip';
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

function humanizeSerialError(err: unknown, t: TFunction): string {
  const msg = err instanceof Error ? err.message : String(err);
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  if (/access denied|permission|not allowed/i.test(msg)) {
    const hint = isWindows
      ? t('connectionPanel.humanize.serial.accessDeniedWindowsHint')
      : t('connectionPanel.humanize.serial.accessDeniedLinuxHint');
    return t('connectionPanel.humanize.prefixedHint', { message: msg, hint });
  }
  if (/no port|not found|disconnected|device not found/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.serial.disconnectedHint'),
    });
  }
  if (/timed out/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.serial.timeoutHint'),
    });
  }
  if (/already open|locked stream|cannot cancel a locked/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.serial.portStillOpenHint'),
    });
  }
  return msg;
}

function hostFromAddressInput(address: string): string {
  const raw = address.trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    // catch-no-log-ok user-typed host/IP without scheme
    return raw.split('/')[0]?.split(':')[0]?.toLowerCase() ?? '';
  }
}

function isMeshtasticLocalAddress(address: string): boolean {
  const host = hostFromAddressInput(address);
  return host === 'meshtastic.local' || host.endsWith('.meshtastic.local');
}

function humanizeHttpError(address: string, err: unknown, t: TFunction): string {
  const msg = err instanceof Error ? err.message : String(err);
  const isMdns = isMeshtasticLocalAddress(address);
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  if (/timed out|timeout|aborted/i.test(msg)) {
    const hint = isMdns
      ? isWindows
        ? t('connectionPanel.humanize.http.timeoutMdnsWindows')
        : t('connectionPanel.humanize.http.timeoutMdnsNonWindows')
      : t('connectionPanel.humanize.http.timeoutGeneric');
    return t('connectionPanel.humanize.prefixedHint', { message: msg, hint });
  }
  if (/401|403|unauthorized/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.http.unauthorizedHint'),
    });
  }
  if (/econnrefused|connection refused|failed to fetch|network/i.test(msg)) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.http.econnrefusedHint'),
    });
  }
  if (isMdns) {
    const suffix = isWindows
      ? t('connectionPanel.humanize.http.suffixMdnsWindows')
      : t('connectionPanel.humanize.http.suffixMdnsNonWindows');
    return t('connectionPanel.humanize.prefixedHint', { message: msg, hint: suffix });
  }
  return msg;
}

function humanizeBleError(err: unknown, t: TFunction): string {
  if (
    err instanceof DOMException &&
    err.name === 'AbortError' &&
    err.message === MESHCORE_SETUP_ABORT_MESSAGE
  ) {
    return '';
  }
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              // catch-no-log-ok stringify fallback for arbitrary renderer error shapes
              return String(err);
            }
          })();
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  const isLinux = navigator.userAgent.toLowerCase().includes('linux');
  if (msg.includes('Bluetooth adapter not found') || msg.includes('adapter is not available')) {
    const hint = isWindows
      ? t('connectionPanel.humanize.ble.adapterWindowsHint')
      : isLinux
        ? t('connectionPanel.humanize.ble.adapterLinuxHint')
        : t('connectionPanel.humanize.ble.adapterGenericHint');
    return t('connectionPanel.humanize.prefixedHint', { message: msg, hint });
  }
  if (msg.includes('SecurityError') || msg.includes('not allowed to access')) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.ble.securityPermissionHint'),
    });
  }
  if (msg.includes('GATT Server is disconnected')) {
    return t('connectionPanel.humanize.prefixedHint', {
      message: msg,
      hint: t('connectionPanel.humanize.ble.gattDisconnectedHint'),
    });
  }
  // Web Bluetooth on Linux: "GATT Error: Not supported" means the device requires pairing
  // before GATT operations are allowed. This is common with Meshtastic devices.
  if (msg.includes('GATT Error: Not supported')) {
    let enhanced = `${msg} ${t('connectionPanel.humanize.ble.gattNotSupportedBase')}`;
    if (isLinux) {
      enhanced += t('connectionPanel.humanize.ble.gattNotSupportedLinuxPin');
    }
    return enhanced;
  }
  // Check error.name directly for DOMException types that indicate pairing issues
  if (err instanceof DOMException) {
    if (err.name === 'SecurityError') {
      let enhanced = t('connectionPanel.humanize.ble.authFailedBase', { message: err.message });
      if (isLinux) {
        enhanced += t('connectionPanel.humanize.ble.authFailedLinuxPin');
      }
      return enhanced;
    }
    if (err.name === 'NetworkError') {
      let enhanced = t('connectionPanel.humanize.ble.networkFailedBase', { message: err.message });
      if (isLinux) {
        enhanced += t('connectionPanel.humanize.ble.networkFailedLinuxHint');
      } else {
        enhanced += t('connectionPanel.humanize.ble.networkFailedNonLinuxHint');
      }
      return enhanced;
    }
  }
  // Web Bluetooth on Linux: connection failed often means device not paired properly
  if (msg.includes('Connection Error: Connection attempt failed')) {
    let enhanced = `${msg} ${t('connectionPanel.humanize.ble.connectionAttemptFailedBase')}`;
    if (isLinux) {
      enhanced += t('connectionPanel.humanize.ble.connectionAttemptFailedLinuxHint');
    }
    return enhanced;
  }
  if (/Bluetooth connected but MeshCore protocol handshake did not complete/i.test(msg)) {
    let enhanced = `${msg} ${t('connectionPanel.humanize.ble.meshcoreHandshakeHint')}`;
    if (isWindows) {
      enhanced += t('connectionPanel.humanize.ble.meshcoreHandshakeWindowsExtra');
    }
    return enhanced;
  }
  if (/Bluetooth connection timed out while opening MeshCore over Noble IPC/i.test(msg)) {
    let enhanced = `${msg} ${t('connectionPanel.humanize.ble.meshcoreHandshakeHint')}`;
    if (isWindows) {
      enhanced += t('connectionPanel.humanize.ble.meshcoreHandshakeWindowsExtra');
    }
    return enhanced;
  }
  return msg;
}

function shouldShowLinuxRePairFromBleError(err: unknown, bleErrMsg: string): boolean {
  const rawMessage = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const pairingFlag =
    err instanceof Error &&
    (err as Error & { isPairingRelated?: boolean }).isPairingRelated === true;
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

function getSerialPortNodeName(portId: string): string | null {
  const cache =
    parseStoredJson<Record<string, string>>(
      localStorage.getItem('mesh-client:serialPortNodeNames'),
      'ConnectionPanel serialPortNodeNames',
    ) ?? {};
  return cache[portId] ?? null;
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

function migrateMqttSettingsOnce(): void {
  if (localStorage.getItem('mesh-client:mqttSettings:meshcore') !== null) return;
  const raw = localStorage.getItem('mesh-client:mqttSettings');
  if (!raw) return;
  const parsed = parseStoredJson<Partial<MQTTSettings>>(raw, 'migrateMqttSettingsOnce');
  if (!parsed) return;
  if (typeof parsed.topicPrefix === 'string' && parsed.topicPrefix.startsWith('meshcore')) {
    localStorage.setItem('mesh-client:mqttSettings:meshcore', raw);
    localStorage.removeItem('mesh-client:mqttSettings');
  }
}
migrateMqttSettingsOnce();

function migrateMeshcoreTopicIataOnce(): void {
  const MIGRATION_KEY = 'mesh-client:migrated:meshcore-topic-iata-v1';
  if (localStorage.getItem(MIGRATION_KEY) !== null) return;
  const raw = localStorage.getItem('mesh-client:mqttSettings:meshcore');
  if (raw) {
    const parsed = parseStoredJson<Partial<MQTTSettings>>(raw, 'migrateMeshcoreTopicIataOnce');
    if (parsed?.topicPrefix === 'meshcore' && typeof parsed.server === 'string') {
      const iata = parsed.server.trim() === COLORADO_MESH_HOST ? 'DEN' : 'test';
      localStorage.setItem(
        'mesh-client:mqttSettings:meshcore',
        JSON.stringify({ ...parsed, topicPrefix: `meshcore/${iata}` }),
      );
    }
  }
  localStorage.setItem(MIGRATION_KEY, '1');
}
migrateMeshcoreTopicIataOnce();

const MESHCORE_MQTT_SETTINGS_KEY = 'mesh-client:mqttSettings:meshcore';

function persistMqttSettingsIfChanged(key: string, settings: MQTTSettings): void {
  const serialized = JSON.stringify(settings);
  if (localStorage.getItem(key) === serialized) return;
  localStorage.setItem(key, serialized);
}

function flushPendingMqttSave(
  timerRef: { current: ReturnType<typeof setTimeout> | null },
  key: string,
  settings: MQTTSettings,
): void {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
  persistMqttSettingsIfChanged(key, settings);
}

function loadMqttSettings(): MQTTSettings {
  return readMeshtasticMqttSettingsFromStorage();
}

function loadMeshcoreMqttSettings(): MQTTSettings {
  return readMeshcoreMqttSettingsFromStorage();
}

interface Props {
  state: DeviceState;
  onConnect: (
    type: ConnectionType,
    httpAddress?: string,
    blePeripheralId?: string,
  ) => Promise<void>;
  onAutoConnect: (
    type: ConnectionType,
    httpAddress?: string,
    lastSerialPortId?: string | null,
    blePeripheralId?: string,
  ) => Promise<void>;
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
}: Props) {
  const { t } = useTranslation();
  const parentIconTrigger = useParentIconTrigger();
  const [connectionType, setConnectionType] = useState<ConnectionType>('ble');
  const [httpAddress, setHttpAddress] = useState(() => {
    const last = loadLastConnection(protocol);
    return last?.type === 'http' && last.httpAddress ? last.httpAddress : 'meshtastic.local';
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
  const tcpPort = (() => {
    const n = parseInt(tcpPortStr, 10);
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 5000;
  })();
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionStage, setConnectionStage] = useState('');
  const [showRePairButton, setShowRePairButton] = useState(false);
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const showPinPromptRef = useRef(false);
  const [manualPairingFallback, setManualPairingFallback] = useState(false);
  const [pinInputValue, setPinInputValue] = useState('');
  const pinPromptSeenSinceRePairRef = useRef(false);
  const [pinCountdown, setPinCountdown] = useState<number | null>(null);
  const pinCountdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeHostAddress = protocol === 'meshcore' ? `${tcpHost}:${tcpPort}` : httpAddress;

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
  const [meshcorePreset, setMeshcorePreset] = useState<
    'letsmesh' | 'coloradomesh' | 'meshmapper' | 'ripple' | 'custom'
  >(() => {
    const saved = localStorage.getItem('mesh-client:mqttPreset:meshcore');
    if (
      saved === 'letsmesh' ||
      saved === 'coloradomesh' ||
      saved === 'meshmapper' ||
      saved === 'ripple'
    )
      return saved;
    return 'custom';
  });
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

  // Persist MeshCore MQTT settings with debounce
  useEffect(() => {
    if (meshcoreMqttSaveTimerRef.current) clearTimeout(meshcoreMqttSaveTimerRef.current);
    meshcoreMqttSaveTimerRef.current = setTimeout(() => {
      persistMqttSettingsIfChanged(MESHCORE_MQTT_SETTINGS_KEY, meshcoreMqttSettingsRef.current);
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
        MESHCORE_MQTT_SETTINGS_KEY,
        meshcoreMqttSettingsRef.current,
      );
    };
    window.addEventListener('beforeunload', flushMeshcoreMqtt);
    return () => {
      window.removeEventListener('beforeunload', flushMeshcoreMqtt);
      flushPendingMqttSave(
        meshcoreMqttSaveTimerRef,
        MESHCORE_MQTT_SETTINGS_KEY,
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
          ? meshcoreMqttUserFacingHint(error)
          : meshtasticMqttErrorUserHint(error),
      );
    });
  }, [protocol]);
  useEffect(() => {
    return window.electronAPI.mqtt.onWarning(({ warning, protocol: mqttProtocol }) => {
      if (mqttProtocol !== protocol) return;
      setMqttWarning(protocol === 'meshcore' ? meshcoreMqttUserFacingHint(warning) : warning);
    });
  }, [protocol]);

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
    syncLetsMeshUsername();
    window.addEventListener('meshclient:meshcoreIdentityUpdated', syncLetsMeshUsername);
    return () => {
      window.removeEventListener('meshclient:meshcoreIdentityUpdated', syncLetsMeshUsername);
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
        persistMqttSettingsIfChanged(
          protocol === 'meshcore' ? MESHCORE_MQTT_SETTINGS_KEY : MESHTASTIC_MQTT_SETTINGS_KEY,
          next,
        );
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
  const isLinux = navigator.userAgent.toLowerCase().includes('linux');
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
  const isAutoConnectingRef = useRef(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
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
      if (autoConnectTimeoutRef.current) {
        clearTimeout(autoConnectTimeoutRef.current);
        autoConnectTimeoutRef.current = null;
      }
      // Persist connection details for next startup
      if (state.connectionType) {
        const conn: LastConnection = { type: state.connectionType };
        if (state.connectionType === 'http') {
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
        if (prev.find((d) => d.deviceId === device.deviceId)) return prev;
        return [...prev, device];
      });
      if (isAutoConnectingRef.current) {
        const lastId = lastConnection?.bleDeviceId ?? loadLastBleDevice(protocol);
        if (lastId && device.deviceId === lastId) {
          if (autoConnectTimeoutRef.current) {
            clearTimeout(autoConnectTimeoutRef.current);
            autoConnectTimeoutRef.current = null;
          }
          void window.electronAPI.stopNobleBleScanning(protocol);
          saveLastBleDevice(protocol, device.deviceId);
          lastSelectedBleNameRef.current = device.deviceName ?? null;
          setConnectionStage('connectionPanel.stageConnecting');
          onConnect('ble', undefined, device.deviceId).catch((err: unknown) => {
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            const bleErrMsg = humanizeBleError(err, t);
            if (bleErrMsg) setError(bleErrMsg);
            setConnecting(false);
            setConnectionStage('');
          });
          return;
        }
      }
      if (connectionTypeRef.current === 'ble') {
        setShowBlePicker(true);
        setConnectionStage('connectionPanel.stageScanning');
      }
    });
  }, [lastConnection, onConnect, protocol, t]); // isAutoConnecting intentionally omitted — ref handles it

  // Listen for Bluetooth devices discovered by main process (Linux Web Bluetooth)
  useEffect(() => {
    return window.electronAPI.onBluetoothDevicesDiscovered((devices) => {
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
      window.electronAPI.cancelBluetoothSelection();
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
          return;
        }
      }
      // Noble: start scanning — actual connection triggered when user selects a device
      setConnectionStage('connectionPanel.stageScanning');
      try {
        await window.electronAPI.startNobleBleScanning(protocol);
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
      await onConnect(connectionType, activeHostAddress);
    } catch (err) {
      console.warn('[ConnectionPanel] handleConnect failed ' + errLikeToLogString(err));
      let errorMsg: string;
      if (connectionType === 'serial') {
        errorMsg = humanizeSerialError(err, t);
      } else if (connectionType === 'http') {
        errorMsg = humanizeHttpError(activeHostAddress, err, t);
      } else {
        errorMsg = err instanceof Error ? err.message : t('connectionPanel.error.connectionFailed');
      }
      setError(errorMsg);
      setConnecting(false);
      setConnectionStage('');
    }
  }, [connectionType, activeHostAddress, onConnect, protocol, isLinux, t]);

  const handleCancelConnection = useCallback(async () => {
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
          window.electronAPI.cancelBluetoothSelection();
        }
        pendingMeshcoreLinuxWbMacRef.current = null;
        setShowPinPrompt(false);
        setManualPairingFallback(false);
        if (webBluetoothDevice) {
          setWebBluetoothDevice(null);
        }
      } else {
        void window.electronAPI.stopNobleBleScanning(protocol);
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
        void window.electronAPI.stopNobleBleScanning(protocol);
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
    if (autoConnectFiredRef.current) return;
    if (deviceStateRef.current.status !== 'disconnected') return;
    const lc = lastConnectionRef.current;
    if (!lc) return;

    autoConnectFiredRef.current = true;

    const startAutoConnectTimeout = () => {
      if (autoConnectTimeoutRef.current) clearTimeout(autoConnectTimeoutRef.current);
      autoConnectTimeoutRef.current = setTimeout(() => {
        console.warn('[ConnectionPanel] auto-connect timed out after 30s');
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        setError(t('connectionPanel.error.autoConnectTimeout'));
        setConnecting(false);
        setConnectionStage('');
      }, 30_000);
    };

    const onAutoConnectFailed = (err: unknown) => {
      if (autoConnectTimeoutRef.current) {
        clearTimeout(autoConnectTimeoutRef.current);
        autoConnectTimeoutRef.current = null;
      }
      isAutoConnectingRef.current = false;
      setIsAutoConnecting(false);
      setError(err instanceof Error ? err.message : t('connectionPanel.error.autoConnectFailed'));
      setConnecting(false);
      setConnectionStage('');
    };

    if (lc.type === 'serial') {
      setConnectionType('serial');
      isAutoConnectingRef.current = true;
      setIsAutoConnecting(true);
      setConnecting(true);
      setConnectionStage('connectionPanel.stagePleaseWait');
      startAutoConnectTimeout();
      void onAutoConnectRef
        .current('serial', undefined, lc.serialPortId)
        .catch(onAutoConnectFailed);
    } else if (lc.type === 'ble') {
      setConnectionType('ble');
      if (lc.bleDeviceId && !isLinux) {
        // Noble: auto-scan on startup — no user gesture required.
        // onNobleBleDeviceDiscovered will auto-connect when the known device appears.
        // On Linux, Web Bluetooth requires a user gesture; skip auto-scan and let user click Connect.
        isAutoConnectingRef.current = true;
        setIsAutoConnecting(true);
        setConnecting(true);
        setConnectionStage('connectionPanel.stageScanningLast');
        startAutoConnectTimeout();
        void window.electronAPI.startNobleBleScanning(protocol).catch(onAutoConnectFailed);
      }
    }
    // HTTP: do not auto-trigger — show one-click reconnect card instead
  }, [protocol, isLinux, t]);

  // Cleanup timeout on unmount
  useEffect(
    () => () => {
      if (autoConnectTimeoutRef.current) clearTimeout(autoConnectTimeoutRef.current);
    },
    [],
  );

  const handleReconnect = useCallback(() => {
    if (!lastConnection) return;
    setError(null);

    if (lastConnection.type === 'ble') {
      if (lastConnection.bleDeviceId) {
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
          void onConnect('ble', undefined).catch((err: unknown) => {
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
          });
        } else {
          // Noble: start scanning — no user gesture required.
          // onNobleBleDeviceDiscovered will auto-connect when the known device appears.
          setConnectionStage('connectionPanel.stageScanningLast');
          if (autoConnectTimeoutRef.current) {
            clearTimeout(autoConnectTimeoutRef.current);
            autoConnectTimeoutRef.current = null;
          }
          autoConnectTimeoutRef.current = setTimeout(() => {
            console.warn('[ConnectionPanel] auto-connect timed out after 30s');
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            setError(t('connectionPanel.error.autoConnectTimeout'));
            setConnecting(false);
            setConnectionStage('');
          }, 30_000);
          void window.electronAPI.startNobleBleScanning(protocol).catch((err: unknown) => {
            if (autoConnectTimeoutRef.current) {
              clearTimeout(autoConnectTimeoutRef.current);
              autoConnectTimeoutRef.current = null;
            }
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            const bleErrMsg = humanizeBleError(err, t);
            if (bleErrMsg) setError(bleErrMsg);
            setConnecting(false);
            setConnectionStage('');
          });
        }
      }
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
        setError(humanizeHttpError(addr, err, t));
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
  }, [lastConnection, onConnect, onAutoConnect, httpAddress, protocol, tcpHost, isLinux, t]);

  const isConnected =
    state.status === 'connected' ||
    state.status === 'configured' ||
    state.status === 'stale' ||
    state.status === 'reconnecting';

  const handleExitApp = useCallback(
    async (variant: 'connected' | 'idle' | 'connecting') => {
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
        void window.electronAPI.mqtt.disconnect();
      }
      await window.electronAPI.quitApp();
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
  if (connecting && !isConnected) {
    return (
      <div className="flex w-full flex-col items-center justify-center space-y-6 py-16">
        <div className="w-full">{renderExitActions('connecting')}</div>
        <SpinnerIconLg className="text-bright-green" />
        <div className="space-y-2 text-center">
          <h2 className="text-xl font-semibold text-gray-200">
            {showPinPrompt
              ? t('connectionPanel.pairWithDevice')
              : showBlePicker
                ? t('connectionPanel.scanningBluetooth')
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
              {connectionStage ? t(connectionStage) : ''}
            </p>
            <p className="text-muted/80 mt-1 text-xs">{t('connectionPanel.stayOnTab')}</p>
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
                    const bleAriaLabel = `${displayName} ${device.deviceId}`;
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
                          {displayName}
                        </div>
                        <div className="text-muted ml-7 font-mono text-xs">{device.deviceId}</div>
                      </button>
                    );
                  });
                })()
              )}
            </div>
            {bleDevices.some((d) => d.deviceName === 'AdaDFU') && (
              <p className="text-muted border-t border-gray-700 px-4 py-2 text-xs">
                On macOS, if a device shows as &quot;AdaDFU&quot;, pair it first in System Settings
                → Bluetooth to see its Meshtastic name.
              </p>
            )}
            {protocol === 'meshcore' && (
              <p className="border-t border-gray-700 px-4 py-2 text-xs text-yellow-400">
                Pair your MeshCore device in <strong>system Bluetooth settings</strong> before
                connecting. Use a PIN code if prompted — if your system does not ask for a PIN, the
                connection will fail and you may need to remove the pairing and re-pair with a PIN.
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
          Cancel
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
                : 'text-gray-500'
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
            /^v1_[0-9A-Fa-f]{64}$/i.test(activeMqttSettings.username ?? '') && (
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
                    ? `Reconnect tries before giving up (1–${MQTT_MAX_RECONNECT_ATTEMPTS}). Saved with settings; press Connect again after changing so the main process picks it up.`
                    : `Both protocols allow 1–${MQTT_MAX_RECONNECT_ATTEMPTS}. Saved with settings; disconnect and Connect again so the running session uses the new value.`
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
                const fallback = MQTT_DEFAULT_RECONNECT_ATTEMPTS;
                const cap = MQTT_MAX_RECONNECT_ATTEMPTS;
                const n = parseInt(e.target.value, 10);
                const v = Number.isFinite(n) ? Math.min(cap, Math.max(1, n)) : fallback;
                updateMqtt('maxRetries', v, false);
              }}
              className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
            />
          </div>
          <button
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
                    { id: 'official-plain' as const, label: 'MQTT :1883' },
                    { id: 'liam' as const, label: "Liam's" },
                    { id: 'custom' as const, label: 'Custom' },
                  ] as const
                ).map(({ id, label }) => (
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
                        : 'bg-secondary-dark border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {label}
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
                    { id: 'letsmesh', label: 'LetsMesh' },
                    { id: 'coloradomesh', label: 'Colorado Mesh' },
                    { id: 'meshmapper', label: 'MeshMapper' },
                    { id: 'ripple', label: 'Ripple Networks' },
                    { id: 'custom', label: 'Custom' },
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setMeshcorePreset(id);
                      if (id === 'letsmesh') {
                        const fromIdentity =
                          letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                        setMeshcoreMqttSettings((prev) => ({
                          ...prev,
                          server: LETSMESH_HOST_US,
                          port: 443,
                          topicPrefix: 'meshcore/test',
                          useWebSocket: true,
                          keepalive: 30,
                          username: fromIdentity || prev.username,
                          password: '',
                        }));
                      } else if (id === 'coloradomesh') {
                        const fromIdentity =
                          letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                        setMeshcoreMqttSettings((prev) => ({
                          ...prev,
                          server: COLORADO_MESH_HOST,
                          port: 1883,
                          topicPrefix: 'meshcore/DEN',
                          useWebSocket: true,
                          tlsEnabled: true,
                          wsPath: '/ws',
                          keepalive: 30,
                          username: fromIdentity || prev.username,
                          password: '',
                        }));
                      } else if (id === 'meshmapper') {
                        const fromIdentity =
                          letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                        setMeshcoreMqttSettings((prev) => ({
                          ...prev,
                          server: MESHMAPPER_HOST,
                          port: 443,
                          topicPrefix: 'meshcore/test',
                          useWebSocket: true,
                          keepalive: 30,
                          username: fromIdentity || prev.username,
                          password: '',
                        }));
                      } else if (id === 'ripple') {
                        if (!window.confirm(t('connectionPanel.ripplePresetConfirm'))) return;
                        setMeshcoreMqttSettings((prev) => ({
                          ...prev,
                          server: 'mqtt.ripplenetworks.com.au',
                          port: 8883,
                          username: 'nswmesh',
                          password: 'nswmesh',
                          topicPrefix: 'meshcore',
                          tlsInsecure: true,
                          useWebSocket: false,
                        }));
                      }
                    }}
                    className={`flex-1 rounded border px-2 py-1.5 text-xs font-medium transition-colors ${
                      meshcorePreset === id
                        ? 'bg-brand-green/20 border-brand-green text-brand-green'
                        : 'bg-secondary-dark border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
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
                        : 'bg-secondary-dark border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200'
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
                        : 'bg-secondary-dark border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200'
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
                  updateMqtt(
                    'port',
                    Math.max(1, Math.min(65535, parseInt(e.target.value) || 1883)),
                  );
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
                  ? 'LetsMesh needs WebSocket on port 443 and server mqtt-us-v1.letsmesh.net or mqtt-eu-v1.letsmesh.net. Use Region (US/EU), or switch to Custom for other brokers.'
                  : meshcorePreset === 'coloradomesh'
                    ? 'Colorado Mesh needs WebSocket on port 1883 with TLS enabled, server mqtt.meshcore.coloradomesh.org, path /ws. Reset the preset or switch to Custom for other brokers.'
                    : 'MeshMapper needs WebSocket on port 443 and server mqtt.meshmapper.cc. Reset the preset or switch to Custom for other brokers.'}
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
                  ? 'Auth token (meshcore-decoder format) will be generated when you connect. Username is v1_ plus your 64-character public key (hex). JWT audience matches the Server hostname.'
                  : 'No full identity — import your MeshCore config in the Radio panel (public and private keys), or paste username (v1_<public key>) and token manually. JWT audience in the token must match the Server hostname.'}
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
                Packet logger — when connected to your radio and MQTT, forward RX packet summaries
                to <code className="text-gray-400">{`{topicPrefix}/meshcore/packets`}</code> in the
                same JSON shape as meshcoretomqtt. Off by default; only enable if you intend to
                share heard air traffic with a packet analyzer.
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
                    ? 'msh/[Country]/[State], e.g. msh/CO/US'
                    : meshcorePreset === 'letsmesh' || meshcorePreset === 'meshmapper'
                      ? 'meshcore/{IATA}, e.g. meshcore/DEN'
                      : 'MESHCORE/[Country]/[State], e.g. MESHCORE/US/CO'
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
              className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
              placeholder="msh/US/"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label htmlFor="mqtt-max-retries" className="text-muted text-xs">
                {t('connectionPanel.maxRetries')}
              </label>
              <HelpTooltip
                text={
                  protocol === 'meshcore'
                    ? 'Reconnect attempts (1–20) before giving up.'
                    : `Reconnect attempts (1–${MQTT_MAX_RECONNECT_ATTEMPTS}) before giving up.`
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
                const fallback = MQTT_DEFAULT_RECONNECT_ATTEMPTS;
                const cap = MQTT_MAX_RECONNECT_ATTEMPTS;
                const n = parseInt(e.target.value, 10);
                const v = Number.isFinite(n) ? Math.min(cap, Math.max(1, n)) : fallback;
                updateMqtt('maxRetries', v, false);
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
              onClick={async () => {
                setMqttError(null);
                const committedPsks = commitChannelPskDraft();
                const settings: Parameters<typeof window.electronAPI.mqtt.connect>[0] = {
                  ...activeMqttSettings,
                  channelPsks: committedPsks.length > 0 ? committedPsks : undefined,
                  mqttTransportProtocol: protocol === 'meshcore' ? 'meshcore' : 'meshtastic',
                };
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
                      setMqttError(`Auth token generation failed: ${msg}`);
                      console.warn(
                        '[ConnectionPanel] LetsMesh auth token generation failed ' +
                          errLikeToLogString(e),
                      );
                      return;
                    }
                  } else if (!settings.password) {
                    setMqttError(
                      identity?.private_key && !identity?.public_key
                        ? 'Public key missing from identity. Import your MeshCore config JSON in the Radio panel (must include public and private keys), or paste a broker token in the password field.'
                        : identity
                          ? 'Could not build LetsMesh username. Import your MeshCore config JSON in the Radio panel, or paste username (v1_<public key>) and token manually.'
                          : 'No device identity found. Import your MeshCore config JSON in the Radio panel, or paste username and token manually.',
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
              disabled={mqttStatus === 'connecting'}
              className={`rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-400 disabled:opacity-40 ${mqttStatus === 'connecting' ? 'flex-1' : 'w-full'}`}
            >
              {t('connectionPanel.connectMqtt')}
            </button>
          </div>
        </div>
      </div>
    );

  // ─── Connected View ────────────────────────────────────────────
  if (isConnected) {
    return (
      <div className="w-full space-y-6">
        {renderExitActions('connected')}

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
                className="text-muted hover:text-brand-green text-xs transition-colors"
              >
                Docs ↗
              </a>
              <span
                className={`text-xs font-medium ${
                  state.status === 'reconnecting'
                    ? 'animate-pulse text-orange-400'
                    : 'text-brand-green'
                }`}
              >
                ● {state.status}
              </span>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted">{t('connectionPanel.connectionType')}</span>
              <span className="text-gray-200 uppercase">{state.connectionType}</span>
            </div>
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
                  {new Date(state.lastDataReceived).toLocaleTimeString()}
                </span>
              </div>
            )}
            <button
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
      </div>
    );
  }

  // ─── Disconnected View ─────────────────────────────────────────
  return (
    <div className="w-full space-y-6">
      {renderExitActions('idle')}

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
              className="rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-400"
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
            className="text-xs text-gray-600 transition-colors hover:text-gray-400"
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
              className="text-muted hover:text-brand-green text-xs transition-colors"
            >
              Docs ↗
            </a>
            <span className="text-xs font-medium text-gray-500">
              {t('connectionPanel.disconnected')}
            </span>
          </div>
        </div>

        {/* Inline error */}
        {error && (
          <div className="border-b border-red-800 bg-red-900/50 px-4 py-2 text-xs text-red-300">
            {error}
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
                        ? 'ring-bright-green bg-green-500 text-white ring-2'
                        : 'bg-secondary-dark text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    <ConnectionIcon type={type} trigger={parentIconTrigger} />
                    {type === 'ble' && t('connectionPanel.bluetooth')}
                    {type === 'serial' && t('connectionPanel.usbSerial')}
                    {type === 'http' && t('connectionPanel.wifiHttp')}
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
                placeholder="meshtastic.local or 192.168.1.x"
                className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none"
                autoComplete="off"
              />
              <p className="text-muted text-xs">{t('connectionPanel.deviceAddressHint')}</p>
              {navigator.userAgent.toLowerCase().includes('windows') && (
                <p className="text-xs text-yellow-400">{t('connectionPanel.windowsMdnsNote')}</p>
              )}
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
                    placeholder="localhost or 192.168.1.x"
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
          <div className="text-muted bg-secondary-dark space-y-1 rounded-lg p-3 text-xs">
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
                (connectionType === 'http' && !activeHostAddress.trim())
              }
              className="w-full rounded-lg bg-green-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('connectionPanel.connectButton')}
            </button>
          </div>
        </div>
      </div>

      {mqttSection}
    </div>
  );
}
