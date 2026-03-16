import { useCallback, useEffect, useRef, useState } from 'react';

import { parseStoredJson } from '../lib/parseStoredJson';
import type {
  BluetoothDevice,
  ConnectionType,
  DeviceState,
  MeshProtocol,
  MQTTSettings,
  MQTTStatus,
  SerialPortInfo,
} from '../lib/types';
// ─── Last Connection (localStorage) ───────────────────────────────
interface LastConnection {
  type: ConnectionType;
  httpAddress?: string;
  bleDeviceId?: string;
  bleDeviceName?: string;
  serialPortId?: string;
}

const LAST_BLE_DEVICE_KEY = 'mesh-client:lastBleDevice';
const LAST_SERIAL_PORT_KEY = 'mesh-client:lastSerialPort';

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
  const msg = err instanceof Error ? err.message : String(err);
  const isWindows = navigator.userAgent.toLowerCase().includes('windows');
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
  return msg;
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

function loadLastBleDevice(): string | null {
  try {
    return localStorage.getItem(LAST_BLE_DEVICE_KEY);
  } catch (e) {
    console.debug('[ConnectionPanel] loadLastBleDevice', e);
    return null;
  }
}

function saveLastBleDevice(id: string) {
  try {
    localStorage.setItem(LAST_BLE_DEVICE_KEY, id);
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

/** Inline SVG icon for each connection type */
function ConnectionIcon({ type }: { type: ConnectionType }) {
  const cls = 'w-5 h-5 shrink-0';
  switch (type) {
    case 'ble':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 7l6 5-6 5M12 2l5 5-5 5 5 5-5 5V2z"
          />
        </svg>
      );
    case 'serial':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
          />
        </svg>
      );
    case 'http':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
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

function loadMqttSettings(): MQTTSettings {
  const raw = localStorage.getItem('mesh-client:mqttSettings');
  const parsed = parseStoredJson<Partial<MQTTSettings>>(raw, 'ConnectionPanel loadMqttSettings');
  return parsed ? { ...MQTT_DEFAULTS, ...parsed } : MQTT_DEFAULTS;
}

function MqttGlobeIcon({ connected }: { connected: boolean }) {
  return (
    <svg
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
  onConnect: (type: ConnectionType, httpAddress?: string) => Promise<void>;
  onRefreshContacts?: () => Promise<void>;
  onSendAdvert?: () => Promise<void>;
  onAutoConnect: (
    type: ConnectionType,
    httpAddress?: string,
    lastSerialPortId?: string | null,
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
  const [connecting, setConnecting] = useState(false);
  const [connectionStage, setConnectionStage] = useState('');

  // ─── MQTT settings state ───────────────────────────────────────
  const [mqttSettings, setMqttSettings] = useState<MQTTSettings>(loadMqttSettings);
  const [showMqttPassword, setShowMqttPassword] = useState(false);
  const [mqttError, setMqttError] = useState<string | null>(null);
  const [mqttClientId, setMqttClientId] = useState('');
  const mqttSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist MQTT settings with debounce
  useEffect(() => {
    if (mqttSaveTimerRef.current) clearTimeout(mqttSaveTimerRef.current);
    mqttSaveTimerRef.current = setTimeout(() => {
      localStorage.setItem('mesh-client:mqttSettings', JSON.stringify(mqttSettings));
    }, 300);
    return () => {
      if (mqttSaveTimerRef.current) clearTimeout(mqttSaveTimerRef.current);
    };
  }, [mqttSettings]);

  // Listen for MQTT events from main process
  useEffect(() => window.electronAPI.mqtt.onError(setMqttError), []);
  useEffect(() => {
    // Restore clientId if already connected when this component mounts (e.g. after tab switch)
    window.electronAPI.mqtt.getClientId().then((id) => {
      if (id) setMqttClientId(id);
    });
    return window.electronAPI.mqtt.onClientId(setMqttClientId);
  }, []);

  // Clear MQTT error/clientId when connection succeeds or is disconnected
  useEffect(() => {
    if (mqttStatus === 'connected' || mqttStatus === 'disconnected') setMqttError(null);
    if (mqttStatus === 'disconnected') setMqttClientId('');
  }, [mqttStatus]);

  const updateMqtt = <K extends keyof MQTTSettings>(key: K, value: MQTTSettings[K]) =>
    setMqttSettings((prev) => ({ ...prev, [key]: value }));

  // ─── BLE device picker state ──────────────────────────────────
  const [bleDevices, setBleDevices] = useState<BluetoothDevice[]>([]);
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

  // Reload last connection when protocol switches (each protocol has its own key)
  useEffect(() => {
    setLastConnection(loadLastConnection(protocol));
  }, [protocol]);

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
          conn.httpAddress = httpAddress;
        } else if (state.connectionType === 'ble') {
          const bleId = loadLastBleDevice();
          if (bleId) {
            conn.bleDeviceId = bleId;
            conn.bleDeviceName =
              getBleDeviceName(bleId) ??
              lastSelectedBleNameRef.current ??
              lastConnection?.bleDeviceName ??
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
      setConnectionStage('');
      setConnecting(false);
      isAutoConnectingRef.current = false;
      setIsAutoConnecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lastConnection.bleDeviceName read as fallback only; omitted to avoid retriggering on stale-name updates
  }, [
    state.status,
    state.connectionType,
    showBlePicker,
    showSerialPicker,
    httpAddress,
    connectionType,
    protocol,
  ]);

  // Listen for BLE devices discovered by main process
  useEffect(() => {
    const cleanup = window.electronAPI.onBluetoothDevicesDiscovered((devices) => {
      setBleDevices(devices);
      if (isAutoConnectingRef.current) {
        const lastId = lastConnection?.bleDeviceId ?? loadLastBleDevice();
        if (lastId) {
          const match = devices.find((d) => d.deviceId === lastId);
          if (match) {
            if (autoConnectTimeoutRef.current) {
              clearTimeout(autoConnectTimeoutRef.current);
              autoConnectTimeoutRef.current = null;
            }
            saveLastBleDevice(match.deviceId);
            lastSelectedBleNameRef.current = match.deviceName ?? null;
            window.electronAPI.selectBluetoothDevice(match.deviceId);
            setConnectionStage('Connecting to device...');
            return;
          }
        }
      }
      setShowBlePicker(true);
      setConnectionStage('Scanning — select your device when it appears below');
    });
    return cleanup;
  }, [lastConnection]); // isAutoConnecting intentionally omitted — ref handles it

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
    try {
      console.debug('[ConnectionPanel] handleConnect', connectionType, httpAddress);
      await onConnect(connectionType, httpAddress);
    } catch (err) {
      console.warn('[ConnectionPanel] handleConnect failed', err);
      let errorMsg: string;
      if (connectionType === 'ble') {
        errorMsg = humanizeBleError(err);
      } else if (connectionType === 'serial') {
        errorMsg = humanizeSerialError(err);
      } else if (connectionType === 'http') {
        errorMsg = humanizeHttpError(httpAddress, err);
      } else {
        errorMsg = err instanceof Error ? err.message : 'Connection failed';
      }
      setError(errorMsg);
      setConnecting(false);
      setConnectionStage('');
    }
  }, [connectionType, httpAddress, onConnect]);

  const handleCancelConnection = useCallback(async () => {
    isAutoConnectingRef.current = false;
    setIsAutoConnecting(false);
    if (autoConnectTimeoutRef.current) {
      clearTimeout(autoConnectTimeoutRef.current);
      autoConnectTimeoutRef.current = null;
    }
    if (showBlePicker) {
      window.electronAPI.cancelBluetoothSelection();
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
  }, [showBlePicker, showSerialPicker, onDisconnect]);

  const handleSelectBleDevice = useCallback(
    (deviceId: string) => {
      saveLastBleDevice(deviceId);
      // Save BLE advertisement name for use in LastConnection display
      const found = bleDevices.find((d) => d.deviceId === deviceId);
      lastSelectedBleNameRef.current = found?.deviceName ?? null;
      window.electronAPI.selectBluetoothDevice(deviceId);
      setShowBlePicker(false);
      setConnectionStage('Connecting to device...');
    },
    [bleDevices],
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
    if (state.status !== 'disconnected') return;
    if (!lastConnection) return;

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

    if (lastConnection.type === 'serial') {
      setConnectionType('serial');
      isAutoConnectingRef.current = true;
      setIsAutoConnecting(true);
      setConnecting(true);
      setConnectionStage('Please wait...');
      startAutoConnectTimeout();
      onAutoConnect('serial', undefined, lastConnection.serialPortId).catch(onAutoConnectFailed);
    } else if (lastConnection.type === 'ble') {
      // BLE: navigator.bluetooth.getDevices() is empty on this Electron build after
      // grant (logs: all retries count 0). requestDevice() requires a user gesture,
      // so no mount autoconnect — user taps Reconnect/Connect to open the picker.
      return;
    }
    // HTTP: do not auto-trigger — show one-click reconnect card instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — fires once on mount

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
      // onConnect('ble') must run in the same turn as the click (user gesture).
      // Set auto-connect ref so bluetooth-devices-discovered auto-selects lastId
      // when it appears in the scan list — that is the "quick connect" path.
      setConnectionType('ble');
      setBleDevices([]);
      setShowBlePicker(false);
      isAutoConnectingRef.current = true;
      setIsAutoConnecting(true);
      setConnecting(true);
      setConnectionStage('Connecting to last Bluetooth device…');
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
      onConnect('ble').catch((err) => {
        if (autoConnectTimeoutRef.current) {
          clearTimeout(autoConnectTimeoutRef.current);
          autoConnectTimeoutRef.current = null;
        }
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        setError(humanizeBleError(err));
        setConnecting(false);
        setConnectionStage('');
      });
    } else if (lastConnection.type === 'http') {
      const addr = lastConnection.httpAddress ?? httpAddress;
      setHttpAddress(addr);
      setConnectionType('http');
      setConnecting(true);
      setBleDevices([]);
      setSerialPorts([]);
      setShowBlePicker(false);
      setShowSerialPicker(false);
      setConnectionStage('Please wait...');
      onConnect('http', addr).catch((err) => {
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
      onAutoConnect('serial', undefined, lastConnection.serialPortId).catch((err) => {
        isAutoConnectingRef.current = false;
        setIsAutoConnecting(false);
        setError(humanizeSerialError(err));
        setConnecting(false);
        setConnectionStage('');
      });
    }
  }, [lastConnection, onConnect, onAutoConnect, httpAddress]);

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
          onClick={() => onProtocolChange(p)}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            protocol === p
              ? p === 'meshcore'
                ? 'bg-purple-600 text-white'
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
      <div className="max-w-lg mx-auto flex flex-col items-center justify-center py-16 space-y-6">
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
          <div className="w-full max-w-md bg-deep-black rounded-lg border border-gray-600 overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary-dark border-b border-gray-600 flex justify-between items-center">
              <span className="text-sm font-medium text-gray-200">Select Bluetooth Device</span>
              <span className="text-xs text-muted">{bleDevices.length} found</span>
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
                  const displayName = cached
                    ? cached !== device.deviceName
                      ? `${cached} (${device.deviceName})`
                      : cached
                    : device.deviceName;
                  return (
                    <button
                      key={device.deviceId}
                      onClick={() => handleSelectBleDevice(device.deviceId)}
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
          </div>
        )}

        {/* Embedded Serial Port Picker */}
        {showSerialPicker && (
          <div className="w-full max-w-md bg-deep-black rounded-lg border border-gray-600 overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary-dark border-b border-gray-600 flex justify-between items-center">
              <span className="text-sm font-medium text-gray-200">Select Serial Port</span>
              <span className="text-xs text-muted">{serialPorts.length} found</span>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {serialPorts.length === 0 ? (
                <div className="px-4 py-6 text-center text-muted text-sm">
                  No serial ports found. Ensure your device is plugged in.
                </div>
              ) : (
                serialPorts.map((port) => (
                  <button
                    key={port.portId}
                    onClick={() => handleSelectSerialPort(port.portId)}
                    className="w-full px-4 py-3 text-left hover:bg-secondary-dark transition-colors border-b border-gray-700 last:border-b-0"
                  >
                    <div className="text-sm text-gray-200 flex items-center gap-2">
                      <ConnectionIcon type="serial" />
                      {port.displayName}
                    </div>
                    <div className="text-xs text-muted font-mono ml-7">
                      {port.portName}
                      {port.vendorId && ` (VID: ${port.vendorId})`}
                      {port.productId && ` PID: ${port.productId}`}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Error in progress view */}
        {error && (
          <div className="w-full max-w-md bg-red-900/50 border border-red-700 text-red-300 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        <button
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
      >
        ● {mqttStatus}
      </span>
    </div>
  );

  const mqttSection =
    mqttStatus === 'connected' ? (
      <div className={`bg-deep-black rounded-lg border border-brand-green/20 overflow-hidden`}>
        {mqttHeaderBar}
        <div className="p-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted">Server</span>
            <span className="text-gray-200">
              {mqttSettings.server}:{mqttSettings.port}
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
              {mqttSettings.topicPrefix.endsWith('/')
                ? mqttSettings.topicPrefix
                : `${mqttSettings.topicPrefix}/`}
              #
            </span>
          </div>
          <button
            onClick={() => window.electronAPI.mqtt.disconnect()}
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
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 space-y-1">
              <label htmlFor="mqtt-server" className="text-xs text-muted">
                Server
              </label>
              <input
                id="mqtt-server"
                type="text"
                value={mqttSettings.server}
                onChange={(e) => updateMqtt('server', e.target.value)}
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
                value={mqttSettings.port}
                onChange={(e) => updateMqtt('port', parseInt(e.target.value) || 1883)}
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
              />
            </div>
          </div>
          {mqttSettings.port === 8883 && (
            <div className="flex items-center gap-2 rounded border border-amber-700/50 bg-amber-900/20 px-2 py-2">
              <input
                type="checkbox"
                id="mqtt-tls-insecure"
                checked={mqttSettings.tlsInsecure ?? false}
                onChange={(e) => updateMqtt('tlsInsecure', e.target.checked)}
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
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label htmlFor="mqtt-username" className="text-xs text-muted">
                Username
              </label>
              <input
                id="mqtt-username"
                type="text"
                value={mqttSettings.username}
                onChange={(e) => updateMqtt('username', e.target.value)}
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
                  value={mqttSettings.password}
                  onChange={(e) => updateMqtt('password', e.target.value)}
                  className="w-full px-2 py-1.5 pr-8 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowMqttPassword((v) => !v)}
                  aria-label={showMqttPassword ? 'Hide password' : 'Show password'}
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
              <span
                title="Each country/region has its own Topic setting; please research the correct hierarchy. Example: Colorado is msh/US/CO"
                className="text-xs text-gray-500 cursor-help"
              >
                ⓘ
              </span>
            </div>
            <input
              id="mqtt-topic-prefix"
              type="text"
              value={mqttSettings.topicPrefix}
              onChange={(e) => updateMqtt('topicPrefix', e.target.value)}
              className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
              placeholder="msh/US/"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="mqtt-max-retries" className="text-xs text-muted">
              Max Retries
            </label>
            <input
              id="mqtt-max-retries"
              type="number"
              min={1}
              max={20}
              value={mqttSettings.maxRetries ?? 5}
              onChange={(e) => updateMqtt('maxRetries', parseInt(e.target.value) || 5)}
              className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="mqttAutoLaunch"
              checked={mqttSettings.autoLaunch}
              onChange={(e) => updateMqtt('autoLaunch', e.target.checked)}
              className="accent-brand-green"
            />
            <label htmlFor="mqttAutoLaunch" className="text-sm text-gray-300 cursor-pointer">
              Auto-connect on application start
            </label>
          </div>
          <div className="pt-1">
            <button
              onClick={() => window.electronAPI.mqtt.connect(mqttSettings)}
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
      <div className="max-w-lg mx-auto space-y-6">
        {protocolToggle}
        <button
          onClick={async () => {
            await onDisconnect();
            window.electronAPI.mqtt.disconnect();
            window.electronAPI.quitApp();
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
            <div>
              <div className="text-sm font-medium text-gray-200">Manual Contact Approval</div>
              <div className="text-xs text-muted mt-0.5">
                Require manual approval before new contacts appear
              </div>
            </div>
            <button
              onClick={() => onToggleManualContacts(!manualAddContacts)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                manualAddContacts ? 'bg-purple-500' : 'bg-gray-600'
              }`}
              role="switch"
              aria-checked={manualAddContacts}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  manualAddContacts ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        )}

        {protocol === 'meshtastic' && mqttSection}
      </div>
    );
  }

  // ─── Disconnected View ─────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto space-y-6">
      {protocolToggle}
      {mqttStatus === 'connected' && (
        <button
          onClick={() => {
            window.electronAPI.mqtt.disconnect();
            window.electronAPI.quitApp();
          }}
          className="w-full px-6 py-2.5 border border-red-700 text-red-400 hover:bg-red-900/30 hover:text-red-300 font-medium rounded-lg transition-colors text-sm"
        >
          Disconnect &amp; Quit
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
              onClick={handleReconnect}
              className="px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors"
              style={{ backgroundColor: '#4CAF50' }}
            >
              Reconnect
            </button>
          </div>
          <button
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
          <span className="text-xs font-medium text-gray-500">● disconnected</span>
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
          <div className="space-y-2">
            <label className="text-xs text-muted">Connection Type</label>
            {protocol === 'meshtastic' ? (
              <div className="grid grid-cols-3 gap-2">
                {(['ble', 'serial', 'http'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setConnectionType(type)}
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
              <div className="grid grid-cols-3 gap-2">
                {(['ble', 'serial', 'http'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setConnectionType(type)}
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
          </div>

          {/* HTTP / TCP address input */}
          {connectionType === 'http' && protocol === 'meshtastic' && (
            <div className="space-y-1">
              <label className="text-xs text-muted">Device Address</label>
              <input
                type="text"
                value={httpAddress}
                onChange={(e) => setHttpAddress(e.target.value)}
                placeholder="meshtastic.local or 192.168.1.x"
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
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
              <label className="text-xs text-muted">Host (port 4403)</label>
              <input
                type="text"
                value={tcpHost}
                onChange={(e) => setTcpHost(e.target.value)}
                placeholder="localhost or 192.168.1.x"
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-purple-500 focus:outline-none text-sm"
              />
              <p className="text-xs text-muted">
                MeshCore companion radio host (connects on port 4403)
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
                reachable on port 4403.
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
                (connectionType === 'http' && !httpAddress.trim())
              }
              className="w-full px-4 py-2.5 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#4CAF50' }}
            >
              Connect
            </button>
          </div>
        </div>
      </div>

      {protocol === 'meshtastic' && mqttSection}
    </div>
  );
}
