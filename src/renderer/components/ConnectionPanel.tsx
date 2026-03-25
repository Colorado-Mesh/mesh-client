import { useCallback, useEffect, useRef, useState } from 'react';

import { MESHCORE_SETUP_ABORT_MESSAGE } from '../lib/bleConnectErrors';
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
  readMeshcoreIdentity,
} from '../lib/letsMeshJwt';
import { meshcoreMqttUserFacingHint } from '../lib/meshcoreMqttUserHint';
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

function humanizeSerialError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  if (/access denied|permission|not allowed/i.test(msg)) {
    if (isWindows) {
      return `${msg} — Ensure the correct USB driver is installed (CH340, CP210x, or FTDI). Check Device Manager for a yellow warning on the COM port.`;
    }
    return `${msg} — On Linux, add your user to the dialout group: sudo usermod -aG dialout $USER (then log out and back in)`;
  }
  if (/no port|not found|disconnected|device not found/i.test(msg)) {
    return `${msg} — Ensure the USB cable is connected and the device is powered on.`;
  }
  if (/timed out/i.test(msg)) {
    return `${msg} — If the port appeared briefly, try reconnecting the USB cable.`;
  }
  return msg;
}

function humanizeHttpError(address: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const isMdns = address.toLowerCase().includes('meshtastic.local');
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
  if (/timed out|timeout|aborted/i.test(msg)) {
    const hint = isMdns
      ? isWindows
        ? "On Windows, meshtastic.local requires Bonjour (installed with iTunes). Use the device's IP address instead."
        : "mDNS may not resolve — try the device's IP address instead."
      : 'Ensure the device is powered on and reachable.';
    return `${msg} — ${hint}`;
  }
  if (/401|403|unauthorized/i.test(msg)) {
    return `${msg} — Check device authentication settings.`;
  }
  if (/econnrefused|connection refused|failed to fetch|network/i.test(msg)) {
    return `${msg} — Ensure the device is powered on and connected to the same network.`;
  }
  if (isMdns) {
    const suffix = isWindows
      ? "On Windows, meshtastic.local requires Bonjour (installed with iTunes). Use the device's IP address instead."
      : "mDNS may not resolve on your network; try the device's IP address instead.";
    return `${msg} — ${suffix}`;
  }
  return msg;
}

function humanizeBleError(err: unknown): string {
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
  if (msg.includes('BLE_LINUX_CAPABILITY_MISSING')) {
    return "Linux BLE permissions are missing. Preferred for npm start: launch with ambient capability using sudo setpriv --reuid=$USER --regid=$(id -g) --init-groups --inh-caps +net_raw --ambient-caps +net_raw --reset-env bash -lc 'npm start'. If setcap was previously applied to local Electron, remove it with sudo setcap -r ./node_modules/electron/dist/electron. For releases: run setcap on the extracted executable (AppImage must be extracted first), then restart the app.";
  }
  if (isLinux && /operation not permitted|permission denied|\beperm\b/i.test(msg)) {
    return `${msg} — Linux BLE may be missing permissions. Preferred for npm start: sudo setpriv --reuid=$USER --regid=$(id -g) --init-groups --inh-caps +net_raw --ambient-caps +net_raw --reset-env bash -lc 'npm start'`;
  }
  if (msg.includes('Bluetooth adapter not found') || msg.includes('adapter is not available')) {
    if (isWindows) {
      return `${msg} — Check Settings > Bluetooth & devices. If Bluetooth is on but unavailable, update your Bluetooth driver in Device Manager.`;
    }
    return `${msg} — Make sure Bluetooth is enabled. On Linux, run: systemctl status bluetooth`;
  }
  if (msg.includes('SecurityError') || msg.includes('not allowed to access')) {
    return `${msg} — Bluetooth permission denied. Ensure the app has access to the Bluetooth device.`;
  }
  if (msg.includes('GATT Server is disconnected')) {
    return `${msg} — GATT connection dropped. Try moving closer to the device and reconnecting.`;
  }
  if (/Bluetooth connected but MeshCore protocol handshake did not complete/i.test(msg)) {
    if (isWindows) {
      return `${msg} On Windows, toggle Bluetooth off/on, confirm no stale pairing is holding the device, then retry.`;
    }
    if (isLinux) {
      return `${msg} On Linux/BlueZ, run bluetoothctl power off; power on, then retry with the device awake and nearby.`;
    }
    return msg;
  }
  if (/Bluetooth connection timed out while opening MeshCore over Noble IPC/i.test(msg)) {
    if (isWindows) {
      return `${msg} On Windows, pair in Bluetooth settings first and clear stale pairings before retrying.`;
    }
    if (isLinux) {
      return `${msg} On Linux/BlueZ, run bluetoothctl power off; power on, then retry.`;
    }
    return msg;
  }
  if (isWindows && /disconnected|timed out/i.test(msg) && /MeshCore/i.test(msg)) {
    return `${msg} On Windows, toggle Bluetooth off/on and update the adapter driver in Device Manager if disconnects persist.`;
  }
  return msg;
}

function loadLastConnection(p: MeshProtocol): LastConnection | null {
  const loaded = parseStoredJson<LastConnection>(
    localStorage.getItem(lastConnectionKey(p)),
    'ConnectionPanel loadLastConnection',
  );
  return loaded;
}

function saveLastConnection(p: MeshProtocol, c: LastConnection) {
  try {
    localStorage.setItem(lastConnectionKey(p), JSON.stringify(c));
  } catch (e) {
    console.debug('[ConnectionPanel] saveLastConnection', e);
  }
}

function clearLastConnection(p: MeshProtocol) {
  try {
    localStorage.removeItem(lastConnectionKey(p));
  } catch (e) {
    console.debug('[ConnectionPanel] clearLastConnection', e);
  }
}

function loadLastBleDevice(protocol: MeshProtocol): string | null {
  try {
    return localStorage.getItem(lastBleDeviceKey(protocol));
  } catch (e) {
    console.debug('[ConnectionPanel] loadLastBleDevice', e);
    return null;
  }
}

function saveLastBleDevice(protocol: MeshProtocol, id: string) {
  try {
    localStorage.setItem(lastBleDeviceKey(protocol), id);
  } catch (e) {
    console.debug('[ConnectionPanel] saveLastBleDevice', e);
  }
}

function loadLastSerialPort(): string | null {
  try {
    return localStorage.getItem(LAST_SERIAL_PORT_KEY);
  } catch (e) {
    console.debug('[ConnectionPanel] loadLastSerialPort', e);
    return null;
  }
}

function saveLastSerialPort(id: string) {
  try {
    localStorage.setItem(LAST_SERIAL_PORT_KEY, id);
  } catch (e) {
    console.debug('[ConnectionPanel] saveLastSerialPort', e);
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

/** Inline SVG icon for each connection type */
function ConnectionIcon({ type }: { type: ConnectionType }) {
  const cls = 'w-5 h-5 shrink-0';
  switch (type) {
    case 'ble':
      return (
        <svg
          aria-hidden="true"
          className={cls}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 7l6 5-6 5M12 2l5 5-5 5 5 5-5 5V2z"
          />
        </svg>
      );
    case 'serial':
      return (
        <svg
          aria-hidden="true"
          className={cls}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
          />
        </svg>
      );
    case 'http':
      return (
        <svg
          aria-hidden="true"
          className={cls}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0"
          />
        </svg>
      );
  }
}

/** Animated spinner */
function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

const MQTT_DEFAULTS: MQTTSettings = {
  server: 'mqtt.meshtastic.org',
  port: 1883,
  username: 'meshdev',
  password: 'large4cats',
  topicPrefix: 'msh/US/',
  autoLaunch: false,
  maxRetries: 5,
};

const MESHCORE_MQTT_DEFAULTS: MQTTSettings = {
  server: '',
  port: 1883,
  username: '',
  password: '',
  topicPrefix: 'meshcore',
  autoLaunch: false,
  maxRetries: 5,
  meshcorePacketLoggerEnabled: false,
};

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

function loadMqttSettings(): MQTTSettings {
  const raw = localStorage.getItem('mesh-client:mqttSettings');
  const parsed = parseStoredJson<Partial<MQTTSettings>>(raw, 'ConnectionPanel loadMqttSettings');
  return parsed ? { ...MQTT_DEFAULTS, ...parsed } : MQTT_DEFAULTS;
}

function loadMeshcoreMqttSettings(): MQTTSettings {
  const raw = localStorage.getItem('mesh-client:mqttSettings:meshcore');
  const parsed = parseStoredJson<Partial<MQTTSettings>>(
    raw,
    'ConnectionPanel loadMeshcoreMqttSettings',
  );
  return parsed ? { ...MESHCORE_MQTT_DEFAULTS, ...parsed } : MESHCORE_MQTT_DEFAULTS;
}

function MqttGlobeIcon({ connected }: { connected: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`w-5 h-5 ${connected ? 'text-brand-green' : 'text-gray-400'}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20M2 12h20" />
      <path d="M2 7h20M2 17h20" />
    </svg>
  );
}

interface Props {
  state: DeviceState;
  onConnect: (
    type: ConnectionType,
    httpAddress?: string,
    blePeripheralId?: string,
  ) => Promise<void>;
  onRefreshContacts?: () => Promise<void>;
  onSendAdvert?: () => Promise<void>;
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
  onProtocolChange: (p: MeshProtocol) => void;
  manualAddContacts?: boolean;
  onToggleManualContacts?: (manual: boolean) => Promise<void>;
}

export default function ConnectionPanel({
  state,
  onConnect,
  onRefreshContacts,
  onSendAdvert,
  onAutoConnect,
  onDisconnect,
  mqttStatus,
  myNodeLabel,
  protocol,
  onProtocolChange,
  manualAddContacts,
  onToggleManualContacts,
}: Props) {
  const [connectionType, setConnectionType] = useState<ConnectionType>('ble');
  const [httpAddress, setHttpAddress] = useState(() => {
    const last = loadLastConnection(protocol);
    return last?.type === 'http' && last.httpAddress ? last.httpAddress : 'meshtastic.local';
  });
  const [tcpHost, setTcpHost] = useState('localhost');
  const [error, setError] = useState<string | null>(null);
  const [linuxBleCapabilityWarning, setLinuxBleCapabilityWarning] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionStage, setConnectionStage] = useState('');
  const activeHostAddress = protocol === 'meshcore' ? tcpHost : httpAddress;

  // ─── MQTT settings state ───────────────────────────────────────
  const [mqttSettings, setMqttSettings] = useState<MQTTSettings>(loadMqttSettings);
  const [meshcoreMqttSettings, setMeshcoreMqttSettings] =
    useState<MQTTSettings>(loadMeshcoreMqttSettings);
  const [showMqttPassword, setShowMqttPassword] = useState(false);
  const [mqttError, setMqttError] = useState<string | null>(null);
  const [mqttWarning, setMqttWarning] = useState<string | null>(null);
  const [mqttClientId, setMqttClientId] = useState('');
  const mqttSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meshcoreMqttSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [meshcorePreset, setMeshcorePreset] = useState<'letsmesh' | 'ripple' | 'custom'>(() => {
    const saved = localStorage.getItem('mesh-client:mqttPreset:meshcore');
    if (saved === 'letsmesh' || saved === 'ripple') return saved;
    return 'custom';
  });
  const [meshtasticPreset, setMeshtasticPreset] = useState<'official' | 'custom'>(() => {
    const s = loadMqttSettings();
    return s.server === MQTT_DEFAULTS.server ? 'official' : 'custom';
  });

  // Persist Meshtastic MQTT settings with debounce
  useEffect(() => {
    if (mqttSaveTimerRef.current) clearTimeout(mqttSaveTimerRef.current);
    mqttSaveTimerRef.current = setTimeout(() => {
      localStorage.setItem('mesh-client:mqttSettings', JSON.stringify(mqttSettings));
    }, 300);
    return () => {
      if (mqttSaveTimerRef.current) clearTimeout(mqttSaveTimerRef.current);
    };
  }, [mqttSettings]);

  // Persist MeshCore preset selection
  useEffect(() => {
    localStorage.setItem('mesh-client:mqttPreset:meshcore', meshcorePreset);
  }, [meshcorePreset]);

  // Persist MeshCore MQTT settings with debounce
  useEffect(() => {
    if (meshcoreMqttSaveTimerRef.current) clearTimeout(meshcoreMqttSaveTimerRef.current);
    meshcoreMqttSaveTimerRef.current = setTimeout(() => {
      localStorage.setItem(
        'mesh-client:mqttSettings:meshcore',
        JSON.stringify(meshcoreMqttSettings),
      );
    }, 300);
    return () => {
      if (meshcoreMqttSaveTimerRef.current) clearTimeout(meshcoreMqttSaveTimerRef.current);
    };
  }, [meshcoreMqttSettings]);

  // Listen for MQTT events from main process (dual-mode: only errors for the active protocol)
  useEffect(() => {
    return window.electronAPI.mqtt.onError(({ error, protocol: mqttProtocol }) => {
      if (mqttProtocol !== protocol) return;
      setMqttError(protocol === 'meshcore' ? meshcoreMqttUserFacingHint(error) : error);
    });
  }, [protocol]);
  useEffect(() => {
    return window.electronAPI.mqtt.onWarning(({ warning, protocol: mqttProtocol }) => {
      if (mqttProtocol !== protocol) return;
      setMqttWarning(protocol === 'meshcore' ? meshcoreMqttUserFacingHint(warning) : warning);
    });
  }, [protocol]);
  useEffect(() => {
    // Restore clientId if already connected when this component mounts (e.g. after tab switch)
    window.electronAPI.mqtt
      .getClientId(protocol)
      .then((id) => {
        if (id) setMqttClientId(id);
      })
      .catch((err: unknown) => {
        console.warn('[ConnectionPanel] getClientId failed:', err);
      });
    return window.electronAPI.mqtt.onClientId(({ clientId, protocol: mqttProtocol }) => {
      if (mqttProtocol !== protocol) return;
      setMqttClientId(clientId);
    });
  }, [protocol]);

  // Clear MQTT error on successful connect; leave it visible on disconnect so the user can read it.
  useEffect(() => {
    if (mqttStatus === 'connected') setMqttError(null);
    if (mqttStatus === 'disconnected') {
      setMqttClientId('');
      setMqttWarning(null);
    }
    if (mqttStatus === 'connecting') setMqttWarning(null);
  }, [mqttStatus]);

  // Keep LetsMesh MQTT username in sync with imported MeshCore identity (v1_<64-hex public key>).
  useEffect(() => {
    const syncLetsMeshUsername = () => {
      if (protocol !== 'meshcore' || meshcorePreset !== 'letsmesh') return;
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

  const activeMqttSettings = protocol === 'meshcore' ? meshcoreMqttSettings : mqttSettings;
  const setActiveMqttSettings = protocol === 'meshcore' ? setMeshcoreMqttSettings : setMqttSettings;

  const updateMqtt = <K extends keyof MQTTSettings>(
    key: K,
    value: MQTTSettings[K],
    affectsPreset = true,
  ) => {
    if (affectsPreset) {
      setMeshcorePreset('custom');
      setMeshtasticPreset('custom');
    }
    setActiveMqttSettings((prev) => ({ ...prev, [key]: value }));
  };

  // ─── BLE device picker state ──────────────────────────────────
  const [bleDevices, setBleDevices] = useState<NobleBleDevice[]>([]);
  const [showBlePicker, setShowBlePicker] = useState(false);

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
  const lastConnectionBleDeviceNameFallbackRef = useRef(lastConnection?.bleDeviceName);
  lastConnectionBleDeviceNameFallbackRef.current = lastConnection?.bleDeviceName;
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
    window.electronAPI
      .getLinuxBleCapabilityStatus()
      .then((status) => {
        if (status.platform !== 'linux' || status.hasCapNetRaw) {
          setLinuxBleCapabilityWarning(null);
          return;
        }
        setLinuxBleCapabilityWarning(
          "Bluetooth permissions missing on Linux (CAP_NET_RAW). For npm start use: sudo setpriv --reuid=$USER --regid=$(id -g) --init-groups --inh-caps +net_raw --ambient-caps +net_raw --reset-env bash -lc 'npm start'. For release binaries, run setcap on the installed/extracted executable (AppImage must be extracted first).",
        );
      })
      .catch((err: unknown) => {
        console.debug('[ConnectionPanel] getLinuxBleCapabilityStatus failed', err);
      });
  }, []);

  // Update connection stage based on state transitions, and save last connection on success
  useEffect(() => {
    if (state.status === 'connecting') {
      if (showBlePicker) setConnectionStage('Select your device below');
      else if (showSerialPicker) setConnectionStage('Select a serial port below');
      else if (connectionType === 'ble' && isAutoConnectingRef.current) {
        setConnectionStage('Connecting to last Bluetooth device…');
      } else setConnectionStage('Please wait...');
    } else if (state.status === 'connected') {
      setConnectionStage('Configuring device...');
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
      const awaitingManualSelection =
        (connectionType === 'ble' || connectionType === 'serial') && connecting;
      if (awaitingManualSelection || showBlePicker || showSerialPicker) {
        return;
      }
      setConnectionStage('');
      setConnecting(false);
      isAutoConnectingRef.current = false;
      setIsAutoConnecting(false);
    }
  }, [
    state.status,
    state.connectionType,
    showBlePicker,
    showSerialPicker,
    httpAddress,
    activeHostAddress,
    connectionType,
    connecting,
    protocol,
  ]);

  // Listen for BLE devices discovered by noble in main process
  useEffect(() => {
    const cleanup = window.electronAPI.onNobleBleDeviceDiscovered((device) => {
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
          setConnectionStage('Connecting to device...');
          onConnect('ble', undefined, device.deviceId).catch((err: unknown) => {
            isAutoConnectingRef.current = false;
            setIsAutoConnecting(false);
            const bleErrMsg = humanizeBleError(err);
            if (bleErrMsg) setError(bleErrMsg);
            setConnecting(false);
            setConnectionStage('');
          });
          return;
        }
      }
      if (connectionTypeRef.current === 'ble') {
        setShowBlePicker(true);
        setConnectionStage('Scanning — select your device when it appears below');
      }
    });
    return cleanup;
  }, [lastConnection, onConnect, protocol]); // isAutoConnecting intentionally omitted — ref handles it

  // Listen for serial ports discovered by main process
  useEffect(() => {
    const cleanup = window.electronAPI.onSerialPortsDiscovered((ports) => {
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
            setConnectionStage('Connecting to device...');
            return;
          }
        }
      }
      setShowSerialPicker(true);
      setConnectionStage('Select a serial port below');
    });
    return cleanup;
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
    setConnectionStage('Please wait...');

    if (connectionType === 'ble') {
      // Noble: start scanning — actual connection triggered when user selects a device
      setConnectionStage('Scanning — select your device when it appears below');
      try {
        await window.electronAPI.startNobleBleScanning(protocol);
      } catch (err) {
        console.warn('[ConnectionPanel] startNobleBleScanning failed:', err);
        const bleErrMsg = humanizeBleError(err);
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
      console.warn('[ConnectionPanel] handleConnect failed', err);
      let errorMsg: string;
      if (connectionType === 'serial') {
        errorMsg = humanizeSerialError(err);
      } else if (connectionType === 'http') {
        errorMsg = humanizeHttpError(activeHostAddress, err);
      } else {
        errorMsg = err instanceof Error ? err.message : 'Connection failed';
      }
      setError(errorMsg);
      setConnecting(false);
      setConnectionStage('');
    }
  }, [connectionType, activeHostAddress, onConnect, protocol]);

  const handleCancelConnection = useCallback(async () => {
    isAutoConnectingRef.current = false;
    setIsAutoConnecting(false);
    if (autoConnectTimeoutRef.current) {
      clearTimeout(autoConnectTimeoutRef.current);
      autoConnectTimeoutRef.current = null;
    }
    if (showBlePicker || connectionType === 'ble') {
      void window.electronAPI.stopNobleBleScanning(protocol);
    }
    if (showSerialPicker) {
      window.electronAPI.cancelSerialSelection();
    }
    setShowBlePicker(false);
    setShowSerialPicker(false);
    setConnecting(false);
    setConnectionStage('');
    // Ensure the underlying connection attempt is properly torn down
    try {
      console.debug('[ConnectionPanel] handleCancelConnection onDisconnect');
      await onDisconnect();
    } catch (e) {
      console.debug('[ConnectionPanel] onDisconnect best-effort cleanup', e);
    }
  }, [showBlePicker, showSerialPicker, onDisconnect, connectionType, protocol]);

  const handleSelectBleDevice = useCallback(
    (deviceId: string) => {
      console.debug('[ConnectionPanel] BLE device selected', deviceId);
      saveLastBleDevice(protocol, deviceId);
      // Save BLE advertisement name for use in LastConnection display
      const found = bleDevices.find((d) => d.deviceId === deviceId);
      lastSelectedBleNameRef.current = found?.deviceName ?? null;
      void window.electronAPI.stopNobleBleScanning(protocol);
      setShowBlePicker(false);
      setConnectionStage('Connecting to device...');
      // Trigger the actual connection with the peripheral ID
      onConnect('ble', undefined, deviceId).catch((err: unknown) => {
        console.warn('[ConnectionPanel] BLE connect after selection failed', err);
        const bleErrMsg = humanizeBleError(err);
        if (bleErrMsg) setError(bleErrMsg);
        setConnecting(false);
        setConnectionStage('');
      });
    },
    [bleDevices, onConnect, protocol],
  );

  const handleSelectSerialPort = useCallback((portId: string) => {
    saveLastSerialPort(portId);
    window.electronAPI.selectSerialPort(portId);
    setShowSerialPicker(false);
    setConnectionStage('Connecting to device...');
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
        setError('Auto-connect timed out.');
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
      setError(err instanceof Error ? err.message : 'Auto-connect failed');
      setConnecting(false);
      setConnectionStage('');
    };

    if (lc.type === 'serial') {
      setConnectionType('serial');
      isAutoConnectingRef.current = true;
      setIsAutoConnecting(true);
      setConnecting(true);
      setConnectionStage('Please wait...');
      startAutoConnectTimeout();
      void onAutoConnectRef
        .current('serial', undefined, lc.serialPortId)
        .catch(onAutoConnectFailed);
    } else if (lc.type === 'ble') {
      setConnectionType('ble');
      if (lc.bleDeviceId) {
        // Noble: auto-scan on startup — no user gesture required.
        // onNobleBleDeviceDiscovered will auto-connect when the known device appears.
        isAutoConnectingRef.current = true;
        setIsAutoConnecting(true);
        setConnecting(true);
        setConnectionStage('Scanning for last Bluetooth device…');
        startAutoConnectTimeout();
        void window.electronAPI.startNobleBleScanning(protocol).catch(onAutoConnectFailed);
      }
    }
    // HTTP: do not auto-trigger — show one-click reconnect card instead
  }, [protocol]);

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
        // Noble: start scanning — no user gesture required.
        // onNobleBleDeviceDiscovered will auto-connect when the known device appears.
        setConnectionType('ble');
        setBleDevices([]);
        setShowBlePicker(false);
        isAutoConnectingRef.current = true;
        setIsAutoConnecting(true);
        setConnecting(true);
        setConnectionStage('Scanning for last Bluetooth device…');
        if (autoConnectTimeoutRef.current) {
          clearTimeout(autoConnectTimeoutRef.current);
          autoConnectTimeoutRef.current = null;
        }
        autoConnectTimeoutRef.current = setTimeout(() => {
          console.warn('[ConnectionPanel] auto-connect timed out after 30s');
          isAutoConnectingRef.current = false;
          setIsAutoConnecting(false);
          setError('Auto-connect timed out.');
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
          const bleErrMsg = humanizeBleError(err);
          if (bleErrMsg) setError(bleErrMsg);
          setConnecting(false);
          setConnectionStage('');
        });
      }
    } else if (lastConnection.type === 'http') {
      const fallbackAddress = protocol === 'meshcore' ? tcpHost : httpAddress;
      const addr = lastConnection.httpAddress ?? fallbackAddress;
      if (protocol === 'meshcore') {
        setTcpHost(addr);
      } else {
        setHttpAddress(addr);
      }
      setConnectionType('http');
      setConnecting(true);
      setBleDevices([]);
      setSerialPorts([]);
      setShowBlePicker(false);
      setShowSerialPicker(false);
      setConnectionStage('Please wait...');
      onConnect('http', addr).catch((err: unknown) => {
        setError(humanizeHttpError(addr, err));
        setConnecting(false);
        setConnectionStage('');
      });
    } else if (lastConnection.type === 'serial') {
      isAutoConnectingRef.current = true;
      setIsAutoConnecting(true);
      setConnectionType('serial');
      setConnecting(true);
      setConnectionStage('Please wait...');
      onAutoConnect('serial', undefined, lastConnection.serialPortId).catch((err: unknown) => {
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        setError(humanizeSerialError(err));
        setConnecting(false);
        setConnectionStage('');
      });
    }
  }, [lastConnection, onConnect, onAutoConnect, httpAddress, protocol, tcpHost]);

  const isConnected =
    state.status === 'connected' ||
    state.status === 'configured' ||
    state.status === 'stale' ||
    state.status === 'reconnecting';

  // ─── Protocol toggle (shown in both connected and disconnected views) ──
  const protocolToggle = (
    <div className="flex rounded-lg overflow-hidden border border-gray-700 bg-deep-black">
      {(['meshtastic', 'meshcore'] as const).map((p) => (
        <button
          key={p}
          type="button"
          aria-label={p === 'meshtastic' ? 'Meshtastic' : 'MeshCore'}
          aria-pressed={protocol === p}
          onClick={() => {
            onProtocolChange(p);
          }}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            protocol === p
              ? p === 'meshcore'
                ? 'bg-cyan-600/20 text-cyan-400'
                : 'bg-brand-green/20 text-brand-green border-brand-green'
              : 'text-muted hover:text-gray-200 hover:bg-secondary-dark'
          }`}
        >
          {p === 'meshtastic' ? 'Meshtastic' : 'MeshCore'}
        </button>
      ))}
    </div>
  );

  // ─── Connecting Progress View ───────────────────────────────────
  if (connecting && !isConnected) {
    return (
      <div className="max-w-5xl mx-auto flex flex-col items-center justify-center py-16 space-y-6">
        <Spinner className="w-12 h-12 text-bright-green" />
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold text-gray-200">
            {showBlePicker
              ? 'Scanning for Bluetooth devices…'
              : isAutoConnecting
                ? 'Auto-connecting…'
                : 'Connecting…'}
          </h2>
          <div role="status" aria-live="polite" aria-atomic="true">
            <p className="text-sm text-muted">{connectionStage}</p>
            <p className="mt-1 text-xs text-muted/80">
              For best results, stay on this tab until the device has finished connecting.
            </p>
          </div>
        </div>

        {/* Embedded BLE Device Picker */}
        {showBlePicker && (
          <div
            role="region"
            aria-labelledby="ble-device-picker-heading"
            className="w-full max-w-4xl bg-deep-black rounded-lg border border-gray-600 overflow-hidden"
          >
            <div className="px-4 py-2.5 bg-secondary-dark border-b border-gray-600 flex justify-between items-center">
              <span id="ble-device-picker-heading" className="text-sm font-medium text-gray-200">
                Select Bluetooth Device
              </span>
              <span className="text-xs text-muted" aria-live="polite">
                {bleDevices.length} found
              </span>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {bleDevices.length === 0 ? (
                <div className="px-4 py-6 text-center text-muted text-sm">
                  <Spinner className="w-5 h-5 text-muted mx-auto mb-2" />
                  Scanning for {protocol === 'meshcore' ? 'MeshCore' : 'Meshtastic'} devices...
                </div>
              ) : (
                bleDevices.map((device) => {
                  const cache =
                    parseStoredJson<Record<string, string>>(
                      localStorage.getItem('mesh-client:bleDeviceNames'),
                      'ConnectionPanel bleDeviceNames list',
                    ) ?? {};
                  const cached = cache[device.deviceId];
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
                      onClick={() => {
                        handleSelectBleDevice(device.deviceId);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-secondary-dark transition-colors border-b border-gray-700 last:border-b-0"
                    >
                      <div className="text-sm text-gray-200 flex items-center gap-2">
                        <ConnectionIcon type="ble" />
                        {displayName}
                      </div>
                      <div className="text-xs text-muted font-mono ml-7">{device.deviceId}</div>
                    </button>
                  );
                })
              )}
            </div>
            {bleDevices.some((d) => d.deviceName === 'AdaDFU') && (
              <p className="px-4 py-2 text-xs text-muted border-t border-gray-700">
                On macOS, if a device shows as &quot;AdaDFU&quot;, pair it first in System Settings
                → Bluetooth to see its Meshtastic name.
              </p>
            )}
            {protocol === 'meshcore' && (
              <p className="px-4 py-2 text-xs text-yellow-400 border-t border-gray-700">
                Pair your MeshCore device in <strong>system Bluetooth settings</strong> before
                connecting (Windows: <strong>Settings &rarr; Bluetooth &amp; devices</strong>;
                macOS: <strong>System Settings &rarr; Bluetooth</strong>).
              </p>
            )}
          </div>
        )}

        {/* Embedded Serial Port Picker */}
        {showSerialPicker && (
          <div
            role="region"
            aria-labelledby="serial-port-picker-heading"
            className="w-full max-w-4xl bg-deep-black rounded-lg border border-gray-600 overflow-hidden"
          >
            <div className="px-4 py-2.5 bg-secondary-dark border-b border-gray-600 flex justify-between items-center">
              <span id="serial-port-picker-heading" className="text-sm font-medium text-gray-200">
                Select Serial Port
              </span>
              <span className="text-xs text-muted" aria-live="polite">
                {serialPorts.length} found
              </span>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {serialPorts.length === 0 ? (
                <div className="px-4 py-6 text-center text-muted text-sm">
                  No serial ports found. Ensure your device is plugged in.
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
                      onClick={() => {
                        handleSelectSerialPort(port.portId);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-secondary-dark transition-colors border-b border-gray-700 last:border-b-0"
                    >
                      <div className="text-sm text-gray-200 flex items-center gap-2">
                        <ConnectionIcon type="serial" />
                        {cachedNodeName ?? port.displayName}
                      </div>
                      <div className="text-xs text-muted font-mono ml-7">
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
          <div className="w-full max-w-4xl bg-red-900/50 border border-red-700 text-red-300 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}
        {linuxBleCapabilityWarning && (
          <div
            role="alert"
            className="w-full max-w-4xl bg-amber-900/40 border border-amber-700 text-amber-100 px-4 py-2 rounded-lg text-sm"
          >
            {linuxBleCapabilityWarning}
          </div>
        )}

        <button
          type="button"
          onClick={handleCancelConnection}
          className="px-6 py-2.5 bg-secondary-dark hover:bg-gray-600 text-gray-300 font-medium rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  // ─── Shared MQTT section ────────────────────────────────────────
  const mqttHeaderBar = (
    <div
      className={`flex items-center justify-between px-4 py-3 bg-secondary-dark border-b ${mqttStatus === 'connected' ? 'border-brand-green/20' : 'border-gray-700'}`}
    >
      <div className="flex items-center gap-2">
        <MqttGlobeIcon connected={mqttStatus === 'connected'} />
        <span className="font-medium text-gray-200">MQTT Connection</span>
      </div>
      <span
        className={`text-xs font-medium ${
          mqttStatus === 'connected'
            ? 'text-brand-green'
            : mqttStatus === 'connecting'
              ? 'text-yellow-400 animate-pulse'
              : mqttStatus === 'error'
                ? 'text-red-400'
                : 'text-gray-500'
        }`}
        aria-live="polite"
      >
        <span aria-hidden="true">● </span>
        {mqttStatus}
      </span>
    </div>
  );

  const mqttSection =
    mqttStatus === 'connected' ? (
      <div className={`bg-deep-black rounded-lg border border-brand-green/20 overflow-hidden`}>
        {mqttHeaderBar}
        {mqttError && (
          <div className="px-4 py-2 bg-red-900/50 border-b border-red-800 text-red-300 text-xs">
            {mqttError}
          </div>
        )}
        {mqttWarning && (
          <div className="px-4 py-2 bg-amber-900/40 border-b border-amber-800/60 text-amber-200 text-xs">
            {mqttWarning}
          </div>
        )}
        <div className="p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Server</span>
            <span className="text-gray-200">
              {activeMqttSettings.server}:{activeMqttSettings.port}
            </span>
          </div>
          {mqttClientId && (
            <div className="flex justify-between text-sm">
              <span className="text-muted">Client ID</span>
              <span className="text-gray-200 font-mono text-xs">{mqttClientId}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted">Topic</span>
            <span className="text-gray-200 font-mono text-xs">
              {activeMqttSettings.topicPrefix.endsWith('/')
                ? activeMqttSettings.topicPrefix
                : `${activeMqttSettings.topicPrefix}/`}
              #
            </span>
          </div>
          <button
            onClick={() =>
              window.electronAPI.mqtt.disconnect().catch((err: unknown) => {
                console.warn('[ConnectionPanel] mqtt.disconnect failed:', err);
              })
            }
            className="w-full px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>
    ) : (
      <div className="bg-deep-black rounded-lg border border-gray-700 overflow-hidden">
        {mqttHeaderBar}
        {mqttError && (
          <div className="px-4 py-2 bg-red-900/50 border-b border-red-800 text-red-300 text-xs">
            {mqttError}
          </div>
        )}
        <div className="p-4 space-y-3">
          {protocol !== 'meshcore' && (
            <div className="space-y-1">
              <p id="conn-meshtastic-network-preset" className="text-xs text-muted">
                Network Preset
              </p>
              <div
                className="flex gap-2"
                role="group"
                aria-labelledby="conn-meshtastic-network-preset"
              >
                {(
                  [
                    { id: 'official', label: 'Official' },
                    { id: 'custom', label: 'Custom' },
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setMeshtasticPreset(id);
                      if (id === 'official') {
                        setMqttSettings({
                          ...MQTT_DEFAULTS,
                          topicPrefix: mqttSettings.topicPrefix,
                        });
                      }
                    }}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded border transition-colors ${
                      meshtasticPreset === id
                        ? 'bg-brand-green/20 border-brand-green text-brand-green'
                        : 'bg-secondary-dark border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {protocol === 'meshcore' && (
            <div className="space-y-1">
              <p id="conn-meshcore-network-preset" className="text-xs text-muted">
                Network Preset
              </p>
              <div
                className="flex gap-2"
                role="group"
                aria-labelledby="conn-meshcore-network-preset"
              >
                {(
                  [
                    { id: 'letsmesh', label: 'LetsMesh' },
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
                          topicPrefix: 'meshcore',
                          useWebSocket: true,
                          username: fromIdentity || prev.username,
                          password: '',
                        }));
                      } else if (id === 'ripple') {
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
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded border transition-colors ${
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
                  aria-label="LetsMesh region"
                >
                  <span className="text-xs text-muted">Region</span>
                  <button
                    type="button"
                    onClick={() => {
                      const fromIdentity = letsMeshMqttUsernameFromIdentity(readMeshcoreIdentity());
                      setMeshcoreMqttSettings((prev) => ({
                        ...prev,
                        server: LETSMESH_HOST_US,
                        port: 443,
                        useWebSocket: true,
                        topicPrefix: 'meshcore',
                        username: fromIdentity || prev.username,
                      }));
                    }}
                    className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
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
                        topicPrefix: 'meshcore',
                        username: fromIdentity || prev.username,
                      }));
                    }}
                    className={`px-2 py-1 text-xs font-medium rounded border transition-colors ${
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
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <label htmlFor="mqtt-server" className="text-xs text-muted">
                Server
              </label>
              <input
                id="mqtt-server"
                type="text"
                value={activeMqttSettings.server}
                onChange={(e) => {
                  updateMqtt('server', e.target.value);
                }}
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="mqtt-port" className="text-xs text-muted">
                Port
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
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
              />
            </div>
          </div>
          {activeMqttSettings.port === 8883 && (
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
                className="text-xs text-amber-200/90 cursor-pointer"
              >
                Allow insecure TLS (self-signed certificate). Off by default — only enable if your
                broker uses a non-public CA.
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
            <label htmlFor="mqtt-websocket" className="text-xs text-gray-300 cursor-pointer">
              Use WebSocket transport <span className="text-gray-500">(required for port 443)</span>
            </label>
          </div>
          {protocol === 'meshcore' &&
            meshcorePreset === 'letsmesh' &&
            letsMeshPresetConfigurationDeviation(meshcoreMqttSettings) && (
              <div className="rounded border border-amber-700/50 bg-amber-900/20 px-2 py-2 text-xs text-amber-200/90">
                Public LetsMesh needs WebSocket on port 443 and server mqtt-us-v1.letsmesh.net or
                mqtt-eu-v1.letsmesh.net. Use Region (US/EU), or switch to Custom for other brokers.
              </div>
            )}
          {protocol === 'meshcore' && meshcorePreset === 'letsmesh' && (
            <div
              className={`flex items-start gap-2 rounded border px-2 py-2 text-xs ${
                readMeshcoreIdentity()?.private_key
                  ? 'border-brand-green/40 bg-brand-green/10 text-brand-green/90'
                  : 'border-amber-700/50 bg-amber-900/20 text-amber-200/90'
              }`}
            >
              {(() => {
                const id = readMeshcoreIdentity();
                return id?.private_key && id?.public_key
                  ? 'Auth token (meshcore-decoder format) will be generated when you connect. Username is v1_ plus your 64-character public key (hex). JWT audience matches the Server hostname.'
                  : 'No full identity — import your MeshCore config in the Radio panel (public and private keys), or paste username (v1_<public key>) and token manually. JWT audience in the token must match the Server hostname.';
              })()}
            </div>
          )}
          {protocol === 'meshcore' && meshcorePreset === 'letsmesh' && (
            <div className="flex items-start gap-2 rounded border border-gray-600/50 bg-secondary-dark/40 px-2 py-2 text-xs text-gray-300">
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
                Packet logger (LetsMesh Analyzer) — when connected to your radio and MQTT, forward
                RX packet summaries to{' '}
                <code className="text-gray-400">{`{topicPrefix}/meshcore/packets`}</code> in the
                same JSON shape as meshcoretomqtt. Off by default; only enable if you intend to
                share heard air traffic with the public analyzer.
              </label>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label htmlFor="mqtt-username" className="text-xs text-muted">
                Username
              </label>
              <input
                id="mqtt-username"
                type="text"
                value={activeMqttSettings.username}
                onChange={(e) => {
                  updateMqtt('username', e.target.value);
                }}
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="mqtt-password" className="text-xs text-muted">
                Password
              </label>
              <div className="relative">
                <input
                  id="mqtt-password"
                  type={showMqttPassword ? 'text' : 'password'}
                  value={activeMqttSettings.password}
                  onChange={(e) => {
                    updateMqtt('password', e.target.value);
                  }}
                  className="w-full px-2 py-1.5 pr-8 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowMqttPassword((v) => !v);
                  }}
                  aria-label={showMqttPassword ? 'hide' : 'show'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
                >
                  {showMqttPassword ? 'hide' : 'show'}
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label htmlFor="mqtt-topic-prefix" className="text-xs text-muted">
                Topic Prefix
              </label>
              <HelpTooltip text="Each country/region has its own Topic setting; please research the correct hierarchy. Example: Colorado is msh/US/CO" />
            </div>
            <input
              id="mqtt-topic-prefix"
              type="text"
              value={activeMqttSettings.topicPrefix}
              onChange={(e) => {
                updateMqtt('topicPrefix', e.target.value, false);
              }}
              className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
              placeholder="msh/US/"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label htmlFor="mqtt-max-retries" className="text-xs text-muted">
                Max Retries
              </label>
              <HelpTooltip text="Number of reconnect attempts before giving up. Higher values allow more time for network recovery before showing an error." />
            </div>
            <input
              id="mqtt-max-retries"
              type="number"
              min={1}
              max={20}
              value={activeMqttSettings.maxRetries ?? 5}
              onChange={(e) => {
                updateMqtt('maxRetries', parseInt(e.target.value) || 5, false);
              }}
              className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
            />
          </div>
          {protocol !== 'meshcore' && (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <label htmlFor="mqtt-channel-psks" className="text-xs text-muted">
                  Channel PSKs
                </label>
                <HelpTooltip text="Base64-encoded AES-128 keys for custom channels, one per line. The default LongFast key is always tried automatically." />
              </div>
              <textarea
                id="mqtt-channel-psks"
                rows={3}
                value={(activeMqttSettings.channelPsks ?? []).join('\n')}
                onChange={(e) => {
                  const lines = e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  updateMqtt('channelPsks', lines.length > 0 ? lines : undefined, false);
                }}
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm font-mono resize-none"
                placeholder={'1PG7OiApB1nwvP+rz05pAQ==\n(one key per line)'}
                spellCheck={false}
              />
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
            <label htmlFor="mqttAutoLaunch" className="text-sm text-gray-300 cursor-pointer">
              Auto-connect on application start
            </label>
          </div>
          <div className="pt-1">
            <button
              onClick={async () => {
                setMqttError(null);
                const settings: Parameters<typeof window.electronAPI.mqtt.connect>[0] = {
                  ...activeMqttSettings,
                  mqttTransportProtocol: protocol === 'meshcore' ? 'meshcore' : 'meshtastic',
                };
                if (protocol === 'meshcore' && meshcorePreset === 'letsmesh') {
                  const presetErr = validateLetsMeshPresetConnect(settings);
                  if (presetErr) {
                    setMqttError(presetErr);
                    return;
                  }
                  const identity = readMeshcoreIdentity();
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
                      settings.password = await generateLetsMeshAuthToken(
                        identity,
                        settings.server,
                      );
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : String(e);
                      setMqttError(`Auth token generation failed: ${msg}`);
                      console.warn('[ConnectionPanel] LetsMesh auth token generation failed', e);
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
                  console.warn('[ConnectionPanel] mqtt.connect failed:', err);
                });
              }}
              disabled={mqttStatus === 'connecting'}
              className="w-full px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
              style={{ backgroundColor: '#4CAF50' }}
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    );

  // ─── Connected View ────────────────────────────────────────────
  if (isConnected) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        {protocolToggle}
        <button
          onClick={async () => {
            // Cap wait so quit always runs if transport teardown hangs (e.g. Windows serial/BLE).
            await Promise.race([
              onDisconnect(),
              new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
            void window.electronAPI.mqtt.disconnect();
            await window.electronAPI.quitApp();
          }}
          className="w-full px-6 py-2.5 border border-red-700 text-red-400 hover:bg-red-900/30 hover:text-red-300 font-medium rounded-lg transition-colors text-sm"
        >
          Disconnect &amp; Quit
        </button>

        <div
          className={`bg-deep-black rounded-lg border overflow-hidden ${
            state.status === 'reconnecting' ? 'border-orange-500/30' : 'border-brand-green/20'
          }`}
        >
          <div
            className={`flex items-center justify-between px-4 py-3 bg-secondary-dark border-b ${
              state.status === 'reconnecting' ? 'border-orange-500/30' : 'border-brand-green/20'
            }`}
          >
            <div className="flex items-center gap-2">
              <ConnectionIcon type={state.connectionType!} />
              <span className="font-medium text-gray-200">Radio Connection</span>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/Colorado-Mesh/mesh-client/blob/main/docs/troubleshooting.md"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted hover:text-brand-green transition-colors"
              >
                Docs ↗
              </a>
              <span
                className={`text-xs font-medium ${
                  state.status === 'reconnecting'
                    ? 'text-orange-400 animate-pulse'
                    : 'text-brand-green'
                }`}
              >
                ● {state.status}
              </span>
            </div>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Connection Type</span>
              <span className="text-gray-200 uppercase">{state.connectionType}</span>
            </div>
            {state.myNodeNum > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted">My Node</span>
                <span className="text-gray-200 font-mono">
                  {myNodeLabel ?? `!${state.myNodeNum.toString(16)}`}
                </span>
              </div>
            )}
            {state.firmwareVersion && (
              <div className="flex justify-between text-sm">
                <span className="text-muted">Firmware</span>
                <span className="text-gray-300 font-mono text-xs">{state.firmwareVersion}</span>
              </div>
            )}
            {state.lastDataReceived && (
              <div className="flex justify-between text-sm">
                <span className="text-muted">Last Data</span>
                <span className="text-gray-300 text-xs">
                  {new Date(state.lastDataReceived).toLocaleTimeString()}
                </span>
              </div>
            )}
            <button
              onClick={onDisconnect}
              className="w-full px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Disconnect
            </button>
            {onRefreshContacts && (
              <button
                onClick={onRefreshContacts}
                className="w-full px-4 py-2.5 border border-purple-600 text-purple-400 hover:bg-purple-900/30 hover:text-purple-300 text-sm font-medium rounded-lg transition-colors"
              >
                Refresh Contacts
              </button>
            )}
            {onSendAdvert && (
              <button
                onClick={onSendAdvert}
                className="w-full px-4 py-2.5 border border-gray-600 text-gray-300 hover:bg-secondary-dark hover:text-gray-100 text-sm font-medium rounded-lg transition-colors"
              >
                Send Advert
              </button>
            )}
          </div>
        </div>

        {onToggleManualContacts !== undefined && (
          <div className="border border-gray-700 rounded-xl p-4 flex items-center justify-between gap-4">
            <div id="manual-contact-approval-label">
              <div className="text-sm font-medium text-gray-200">Manual Contact Approval</div>
              <div className="text-xs text-muted mt-0.5">
                Require manual approval before new contacts appear
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
    <div className="max-w-5xl mx-auto space-y-6">
      {protocolToggle}
      {linuxBleCapabilityWarning && (
        <div
          role="alert"
          className="bg-amber-900/40 border border-amber-700 text-amber-100 px-4 py-3 rounded-lg text-sm"
        >
          {linuxBleCapabilityWarning}
        </div>
      )}
      {mqttStatus === 'connected' && (
        <button
          type="button"
          onClick={() => {
            void window.electronAPI.mqtt.disconnect();
            void window.electronAPI.quitApp();
          }}
          className="w-full px-6 py-2.5 border border-red-700 text-red-400 hover:bg-red-900/30 hover:text-red-300 font-medium rounded-lg transition-colors text-sm"
        >
          Disconnect &amp; Quit
        </button>
      )}
      {protocol === 'meshcore' && mqttStatus !== 'connected' && (
        <button
          type="button"
          onClick={() => window.electronAPI.quitApp()}
          className="w-full px-6 py-2.5 border border-red-700 text-red-400 hover:bg-red-900/30 hover:text-red-300 font-medium rounded-lg transition-colors text-sm"
        >
          Quit
        </button>
      )}

      {/* Last Connection — one-click reconnect card */}
      {lastConnection && !connecting && (
        <div className="bg-deep-black rounded-lg border border-gray-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ConnectionIcon type={lastConnection.type} />
              <div>
                <p className="text-sm font-medium text-gray-200">
                  {lastConnection.type === 'ble'
                    ? (lastConnection.bleDeviceName ?? 'Bluetooth device')
                    : lastConnection.type === 'serial'
                      ? 'Serial device'
                      : (lastConnection.httpAddress ?? 'WiFi device')}
                </p>
                <p className="text-xs text-muted uppercase">{lastConnection.type}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleReconnect}
              className="px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors"
              style={{ backgroundColor: '#4CAF50' }}
            >
              Reconnect
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              clearLastConnection(protocol);
              setLastConnection(null);
            }}
            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Forget this device
          </button>
        </div>
      )}

      {/* Radio Connection card */}
      <div className="bg-deep-black rounded-lg border border-gray-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-secondary-dark border-b border-gray-700">
          <div className="flex items-center gap-2">
            <ConnectionIcon type={connectionType} />
            <span className="font-medium text-gray-200">Radio Connection</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/Colorado-Mesh/mesh-client/blob/main/docs/troubleshooting.md"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted hover:text-brand-green transition-colors"
            >
              Docs ↗
            </a>
            <span className="text-xs font-medium text-gray-500">● disconnected</span>
          </div>
        </div>

        {/* Inline error */}
        {error && (
          <div className="px-4 py-2 bg-red-900/50 border-b border-red-800 text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Connection type selector */}
          <fieldset className="space-y-2 border-0 p-0 min-w-0">
            <legend id="connection-type-legend" className="text-xs text-muted">
              Connection Type
            </legend>
            {protocol === 'meshtastic' ? (
              <div
                role="radiogroup"
                aria-labelledby="connection-type-legend"
                className="grid grid-cols-3 gap-2"
              >
                {(['ble', 'serial', 'http'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={connectionType === type}
                    onClick={() => {
                      setConnectionType(type);
                    }}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                      connectionType === type
                        ? 'text-white ring-2 ring-bright-green'
                        : 'bg-secondary-dark text-gray-300 hover:bg-gray-600'
                    }`}
                    style={connectionType === type ? { backgroundColor: '#4CAF50' } : undefined}
                  >
                    <ConnectionIcon type={type} />
                    {type === 'ble' && 'Bluetooth'}
                    {type === 'serial' && 'USB Serial'}
                    {type === 'http' && 'WiFi/HTTP'}
                  </button>
                ))}
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-labelledby="connection-type-legend"
                className="grid grid-cols-3 gap-2"
              >
                {(['ble', 'serial', 'http'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={connectionType === type}
                    onClick={() => {
                      setConnectionType(type);
                    }}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                      connectionType === type
                        ? 'text-white ring-2 ring-purple-500'
                        : 'bg-secondary-dark text-gray-300 hover:bg-gray-600'
                    }`}
                    style={connectionType === type ? { backgroundColor: '#7c3aed' } : undefined}
                  >
                    <ConnectionIcon type={type} />
                    {type === 'ble' && 'Bluetooth'}
                    {type === 'serial' && 'USB Serial'}
                    {type === 'http' && 'TCP/IP'}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {/* HTTP / TCP address input */}
          {connectionType === 'http' && protocol === 'meshtastic' && (
            <div className="space-y-1">
              <label htmlFor="connection-meshtastic-host" className="text-xs text-muted">
                Device Address
              </label>
              <input
                id="connection-meshtastic-host"
                type="text"
                value={httpAddress}
                onChange={(e) => {
                  setHttpAddress(e.target.value);
                }}
                placeholder="meshtastic.local or 192.168.1.x"
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
                autoComplete="off"
              />
              <p className="text-xs text-muted">Enter hostname or IP address (without http://)</p>
              {navigator.userAgent.toLowerCase().includes('windows') && (
                <p className="text-xs text-yellow-400">
                  On Windows, meshtastic.local may not resolve — use the device&apos;s IP address
                  instead.
                </p>
              )}
            </div>
          )}
          {connectionType === 'http' && protocol === 'meshcore' && (
            <div className="space-y-1">
              <label htmlFor="connection-meshcore-tcp-host" className="text-xs text-muted">
                Host (port 5000)
              </label>
              <input
                id="connection-meshcore-tcp-host"
                type="text"
                value={tcpHost}
                onChange={(e) => {
                  setTcpHost(e.target.value);
                }}
                placeholder="localhost or 192.168.1.x"
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-purple-500 focus:outline-none text-sm"
                autoComplete="off"
              />
              <p className="text-xs text-muted">
                MeshCore companion radio host (connects on port 5000)
              </p>
            </div>
          )}

          {/* Connection hints */}
          <div className="text-xs text-muted bg-secondary-dark rounded-lg p-3 space-y-1">
            {connectionType === 'ble' && protocol === 'meshtastic' && (
              <>
                <p>Ensure your Meshtastic device has Bluetooth enabled and is in range.</p>
                <p>
                  Click Connect to scan — a device picker will appear with discovered Meshtastic
                  devices.
                </p>
              </>
            )}
            {connectionType === 'ble' && protocol === 'meshcore' && (
              <>
                <p>Ensure your MeshCore device has Bluetooth enabled and is in range.</p>
                <p>Click Connect to scan for nearby MeshCore devices.</p>
              </>
            )}
            {connectionType === 'serial' && protocol === 'meshtastic' && (
              <>
                <p>Connect your Meshtastic device via USB cable.</p>
                <p>Click Connect — a port picker will appear with available serial ports.</p>
              </>
            )}
            {connectionType === 'serial' && protocol === 'meshcore' && (
              <>
                <p>Connect your MeshCore device via USB cable.</p>
                <p>Click Connect — a port picker will appear with available serial ports.</p>
              </>
            )}
            {connectionType === 'http' && protocol === 'meshtastic' && (
              <>
                <p>
                  Enter the IP address or hostname of a WiFi-connected Meshtastic node. The device
                  must have WiFi enabled in its config.
                </p>
                <p>
                  If connection is unreliable (e.g. with meshtastic.local), try the device&apos;s IP
                  address instead — desktop mDNS can be flaky.
                </p>
              </>
            )}
            {connectionType === 'http' && protocol === 'meshcore' && (
              <p>
                Enter the hostname or IP address of your MeshCore companion radio. It must be
                reachable on port 5000.
              </p>
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
              className="w-full px-4 py-2.5 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#4CAF50' }}
            >
              Connect
            </button>
          </div>
        </div>
      </div>

      {mqttSection}
    </div>
  );
}
