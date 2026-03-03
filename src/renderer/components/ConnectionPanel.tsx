import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ConnectionType,
  DeviceState,
  BluetoothDevice,
  SerialPortInfo,
  MQTTSettings,
  MQTTStatus,
} from "../lib/types";
import { LinkIcon } from "./SignalBars";

// ─── Connection Profiles (localStorage) ───────────────────────────
interface ConnectionProfile {
  id: string;
  name: string;
  type: ConnectionType;
  httpAddress?: string;
}

function loadProfiles(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem("mesh-client_profiles");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProfiles(profiles: ConnectionProfile[]) {
  localStorage.setItem("mesh-client_profiles", JSON.stringify(profiles));
}

/** Inline SVG icon for each connection type */
function ConnectionIcon({ type }: { type: ConnectionType }) {
  const cls = "w-5 h-5 shrink-0";
  switch (type) {
    case "ble":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 7l6 5-6 5M12 2l5 5-5 5 5 5-5 5V2z" />
        </svg>
      );
    case "serial":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
        </svg>
      );
    case "http":
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
        </svg>
      );
  }
}

/** Animated spinner */
function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

const MQTT_DEFAULTS: MQTTSettings = {
  server: "mqtt.meshtastic.org",
  port: 1883,
  username: "meshdev",
  password: "large4cats",
  topicPrefix: "msh/US/",
  autoLaunch: false,
  maxRetries: 5,
};

function loadMqttSettings(): MQTTSettings {
  try {
    const raw = localStorage.getItem("mesh-client:mqttSettings");
    return raw ? { ...MQTT_DEFAULTS, ...JSON.parse(raw) } : MQTT_DEFAULTS;
  } catch {
    return MQTT_DEFAULTS;
  }
}

function MqttGlobeIcon({ connected }: { connected: boolean }) {
  return (
    <svg
      className={`w-5 h-5 ${connected ? "text-brand-green" : "text-gray-400"}`}
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
  onDisconnect: () => Promise<void>;
  mqttStatus: MQTTStatus;
  myNodeLabel?: string;
}

export default function ConnectionPanel({
  state,
  onConnect,
  onDisconnect,
  mqttStatus,
  myNodeLabel,
}: Props) {
  const [connectionType, setConnectionType] = useState<ConnectionType>("ble");
  const [httpAddress, setHttpAddress] = useState("meshtastic.local");
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionStage, setConnectionStage] = useState("");

  // ─── MQTT settings state ───────────────────────────────────────
  const [mqttSettings, setMqttSettings] = useState<MQTTSettings>(loadMqttSettings);
  const [showMqttPassword, setShowMqttPassword] = useState(false);
  const [mqttError, setMqttError] = useState<string | null>(null);
  const [mqttClientId, setMqttClientId] = useState("");
  const mqttSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist MQTT settings with debounce
  useEffect(() => {
    if (mqttSaveTimerRef.current) clearTimeout(mqttSaveTimerRef.current);
    mqttSaveTimerRef.current = setTimeout(() => {
      localStorage.setItem("mesh-client:mqttSettings", JSON.stringify(mqttSettings));
    }, 300);
    return () => { if (mqttSaveTimerRef.current) clearTimeout(mqttSaveTimerRef.current); };
  }, [mqttSettings]);

  // Listen for MQTT events from main process
  useEffect(() => window.electronAPI.mqtt.onError(setMqttError), []);
  useEffect(() => window.electronAPI.mqtt.onClientId(setMqttClientId), []);

  // Clear MQTT error/clientId when connection succeeds or is disconnected
  useEffect(() => {
    if (mqttStatus === "connected" || mqttStatus === "disconnected") setMqttError(null);
    if (mqttStatus === "disconnected") setMqttClientId("");
  }, [mqttStatus]);

  const updateMqtt = <K extends keyof MQTTSettings>(key: K, value: MQTTSettings[K]) =>
    setMqttSettings((prev) => ({ ...prev, [key]: value }));

  // ─── BLE device picker state ──────────────────────────────────
  const [bleDevices, setBleDevices] = useState<BluetoothDevice[]>([]);
  const [showBlePicker, setShowBlePicker] = useState(false);

  // ─── Serial port picker state ─────────────────────────────────
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [showSerialPicker, setShowSerialPicker] = useState(false);

  // ─── Connection profiles ──────────────────────────────────────
  const [profiles, setProfiles] = useState<ConnectionProfile[]>(loadProfiles);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileName, setProfileName] = useState("");

  // Update connection stage based on state transitions
  useEffect(() => {
    if (state.status === "connecting") {
      if (showBlePicker) setConnectionStage("Select your device below");
      else if (showSerialPicker) setConnectionStage("Select a serial port below");
      else setConnectionStage("Scanning for devices...");
    } else if (state.status === "connected") {
      setConnectionStage("Configuring device...");
    } else if (state.status === "configured") {
      setConnectionStage("");
      setConnecting(false);
    } else if (state.status === "disconnected") {
      setConnectionStage("");
      setConnecting(false);
    }
  }, [state.status, showBlePicker, showSerialPicker]);

  // Listen for BLE devices discovered by main process
  useEffect(() => {
    const cleanup = window.electronAPI.onBluetoothDevicesDiscovered(
      (devices) => {
        setBleDevices(devices);
        setShowBlePicker(true);
        setConnectionStage("Select your device below");
      }
    );
    return cleanup;
  }, []);

  // Listen for serial ports discovered by main process
  useEffect(() => {
    const cleanup = window.electronAPI.onSerialPortsDiscovered((ports) => {
      setSerialPorts(ports);
      setShowSerialPicker(true);
      setConnectionStage("Select a serial port below");
    });
    return cleanup;
  }, []);

  const handleConnect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    setBleDevices([]);
    setSerialPorts([]);
    setShowBlePicker(false);
    setShowSerialPicker(false);
    setConnectionStage("Scanning for devices...");
    try {
      await onConnect(connectionType, httpAddress);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setConnecting(false);
      setConnectionStage("");
    }
  }, [connectionType, httpAddress, onConnect]);

  const handleConnectProfile = useCallback(
    async (profile: ConnectionProfile) => {
      setConnectionType(profile.type);
      if (profile.httpAddress) setHttpAddress(profile.httpAddress);
      setError(null);
      setConnecting(true);
      setBleDevices([]);
      setSerialPorts([]);
      setShowBlePicker(false);
      setShowSerialPicker(false);
      setConnectionStage("Scanning for devices...");
      try {
        await onConnect(profile.type, profile.httpAddress);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Connection failed");
        setConnecting(false);
        setConnectionStage("");
      }
    },
    [onConnect]
  );

  const handleCancelConnection = useCallback(async () => {
    if (showBlePicker) {
      window.electronAPI.cancelBluetoothSelection();
    }
    if (showSerialPicker) {
      window.electronAPI.cancelSerialSelection();
    }
    setShowBlePicker(false);
    setShowSerialPicker(false);
    setConnecting(false);
    setConnectionStage("");
    // Ensure the underlying connection attempt is properly torn down
    try {
      await onDisconnect();
    } catch {
      // Best effort cleanup
    }
  }, [showBlePicker, showSerialPicker, onDisconnect]);

  const handleSelectBleDevice = useCallback((deviceId: string) => {
    window.electronAPI.selectBluetoothDevice(deviceId);
    setShowBlePicker(false);
    setConnectionStage("Connecting to device...");
  }, []);

  const handleSelectSerialPort = useCallback((portId: string) => {
    window.electronAPI.selectSerialPort(portId);
    setShowSerialPicker(false);
    setConnectionStage("Connecting to device...");
  }, []);

  const handleSaveProfile = useCallback(() => {
    if (!profileName.trim()) return;
    const newProfile: ConnectionProfile = {
      id: Date.now().toString(36),
      name: profileName.trim(),
      type: connectionType,
      httpAddress: connectionType === "http" ? httpAddress : undefined,
    };
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    saveProfiles(updated);
    setProfileName("");
    setShowProfileForm(false);
  }, [profileName, connectionType, httpAddress, profiles]);

  const handleDeleteProfile = useCallback(
    (id: string) => {
      const updated = profiles.filter((p) => p.id !== id);
      setProfiles(updated);
      saveProfiles(updated);
    },
    [profiles]
  );

  const isConnected =
    state.status === "connected" ||
    state.status === "configured" ||
    state.status === "stale" ||
    state.status === "reconnecting";

  // ─── Connecting Progress View ───────────────────────────────────
  if (connecting && !isConnected) {
    return (
      <div className="max-w-lg mx-auto flex flex-col items-center justify-center py-16 space-y-6">
        <Spinner className="w-12 h-12 text-bright-green" />
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold text-gray-200">Connecting...</h2>
          <p className="text-sm text-muted">{connectionStage}</p>
        </div>

        {/* Embedded BLE Device Picker */}
        {showBlePicker && (
          <div className="w-full max-w-md bg-deep-black rounded-lg border border-gray-600 overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary-dark border-b border-gray-600 flex justify-between items-center">
              <span className="text-sm font-medium text-gray-200">
                Select Bluetooth Device
              </span>
              <span className="text-xs text-muted">
                {bleDevices.length} found
              </span>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {bleDevices.length === 0 ? (
                <div className="px-4 py-6 text-center text-muted text-sm">
                  <Spinner className="w-5 h-5 text-muted mx-auto mb-2" />
                  Scanning for Meshtastic devices...
                </div>
              ) : (
                bleDevices.map((device) => (
                  <button
                    key={device.deviceId}
                    onClick={() => handleSelectBleDevice(device.deviceId)}
                    className="w-full px-4 py-3 text-left hover:bg-secondary-dark transition-colors border-b border-gray-700 last:border-b-0"
                  >
                    <div className="text-sm text-gray-200 flex items-center gap-2">
                      <ConnectionIcon type="ble" />
                      {device.deviceName}
                    </div>
                    <div className="text-xs text-muted font-mono ml-7">
                      {device.deviceId}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Embedded Serial Port Picker */}
        {showSerialPicker && (
          <div className="w-full max-w-md bg-deep-black rounded-lg border border-gray-600 overflow-hidden">
            <div className="px-4 py-2.5 bg-secondary-dark border-b border-gray-600 flex justify-between items-center">
              <span className="text-sm font-medium text-gray-200">
                Select Serial Port
              </span>
              <span className="text-xs text-muted">
                {serialPorts.length} found
              </span>
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
    <div className={`flex items-center justify-between px-4 py-3 bg-secondary-dark border-b ${mqttStatus === "connected" ? "border-brand-green/20" : "border-gray-700"}`}>
      <div className="flex items-center gap-2">
        <MqttGlobeIcon connected={mqttStatus === "connected"} />
        <span className="font-medium text-gray-200">MQTT Connection</span>
      </div>
      <span className={`text-xs font-medium ${
        mqttStatus === "connected" ? "text-brand-green" :
        mqttStatus === "connecting" ? "text-yellow-400 animate-pulse" :
        mqttStatus === "error" ? "text-red-400" : "text-gray-500"
      }`}>
        ● {mqttStatus}
      </span>
    </div>
  );

  const mqttSection = mqttStatus === "connected" ? (
    <div className={`bg-deep-black rounded-lg border border-brand-green/20 overflow-hidden`}>
      {mqttHeaderBar}
      <div className="p-4 space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-muted">Server</span>
          <span className="text-gray-200">{mqttSettings.server}:{mqttSettings.port}</span>
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
            {mqttSettings.topicPrefix.endsWith("/") ? mqttSettings.topicPrefix : `${mqttSettings.topicPrefix}/`}#
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
            <label className="text-xs text-muted">Server</label>
            <input
              type="text"
              value={mqttSettings.server}
              onChange={(e) => updateMqtt("server", e.target.value)}
              className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted">Port</label>
            <input
              type="number"
              value={mqttSettings.port}
              onChange={(e) => updateMqtt("port", parseInt(e.target.value) || 1883)}
              className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs text-muted">Username</label>
            <input
              type="text"
              value={mqttSettings.username}
              onChange={(e) => updateMqtt("username", e.target.value)}
              className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted">Password</label>
            <div className="relative">
              <input
                type={showMqttPassword ? "text" : "password"}
                value={mqttSettings.password}
                onChange={(e) => updateMqtt("password", e.target.value)}
                className="w-full px-2 py-1.5 pr-8 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
              />
              <button
                type="button"
                onClick={() => setShowMqttPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
              >
                {showMqttPassword ? "hide" : "show"}
              </button>
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-muted">Topic Prefix</label>
            <span
              title="Each country/region has its own Topic setting; please research the correct hierarchy. Example: Colorado is msh/US/CO"
              className="text-xs text-gray-500 cursor-help"
            >
              ⓘ
            </span>
          </div>
          <input
            type="text"
            value={mqttSettings.topicPrefix}
            onChange={(e) => updateMqtt("topicPrefix", e.target.value)}
            className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
            placeholder="msh/US/"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted">Max Retries</label>
          <input
            type="number"
            min={1}
            max={20}
            value={mqttSettings.maxRetries ?? 5}
            onChange={(e) => updateMqtt("maxRetries", parseInt(e.target.value) || 5)}
            className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="mqttAutoLaunch"
            checked={mqttSettings.autoLaunch}
            onChange={(e) => updateMqtt("autoLaunch", e.target.checked)}
            className="accent-brand-green"
          />
          <label htmlFor="mqttAutoLaunch" className="text-sm text-gray-300 cursor-pointer">
            Auto-connect on application start
          </label>
        </div>
        <div className="pt-1">
          <button
            onClick={() => window.electronAPI.mqtt.connect(mqttSettings)}
            disabled={mqttStatus === "connecting"}
            className="w-full px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40"
            style={{ backgroundColor: "#4CAF50" }}
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

        <div className={`bg-deep-black rounded-lg border overflow-hidden ${
          state.status === "reconnecting" ? "border-orange-500/30" : "border-brand-green/20"
        }`}>
          <div className={`flex items-center justify-between px-4 py-3 bg-secondary-dark border-b ${
            state.status === "reconnecting" ? "border-orange-500/30" : "border-brand-green/20"
          }`}>
            <div className="flex items-center gap-2">
              <ConnectionIcon type={state.connectionType!} />
              <span className="font-medium text-gray-200">Radio Connection</span>
            </div>
            <span className={`text-xs font-medium ${
              state.status === "reconnecting" ? "text-orange-400 animate-pulse" : "text-brand-green"
            }`}>
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
          </div>
        </div>

        {mqttSection}
      </div>
    );
  }

  // ─── Disconnected View ─────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto space-y-6">
      {mqttStatus === "connected" && (
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

      {/* Saved Profiles */}
      {profiles.length > 0 && (
        <div className="space-y-2">
          <label className="text-sm text-muted">Quick Connect</label>
          <div className="space-y-1.5">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className="flex items-center gap-2 bg-deep-black rounded-lg px-3 py-2.5 border border-gray-700 hover:border-gray-600 transition-colors"
              >
                <ConnectionIcon type={profile.type} />
                <button
                  onClick={() => handleConnectProfile(profile)}
                  className="flex-1 text-left text-sm text-gray-200 hover:text-white transition-colors"
                >
                  <span className="font-medium">{profile.name}</span>
                  <span className="text-muted ml-2 text-xs uppercase">
                    {profile.type}
                    {profile.httpAddress && ` • ${profile.httpAddress}`}
                  </span>
                </button>
                <button
                  onClick={() => handleDeleteProfile(profile.id)}
                  className="text-gray-600 hover:text-red-400 transition-colors p-1"
                  title="Delete profile"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-700 pt-4 mt-4" />
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
            <div className="grid grid-cols-3 gap-2">
              {(["ble", "serial", "http"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setConnectionType(type)}
                  className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all ${
                    connectionType === type
                      ? "text-white ring-2 ring-bright-green"
                      : "bg-secondary-dark text-gray-300 hover:bg-gray-600"
                  }`}
                  style={connectionType === type ? { backgroundColor: "#4CAF50" } : undefined}
                >
                  <ConnectionIcon type={type} />
                  {type === "ble" && "Bluetooth"}
                  {type === "serial" && "USB Serial"}
                  {type === "http" && "WiFi/HTTP"}
                </button>
              ))}
            </div>
          </div>

          {/* HTTP address input */}
          {connectionType === "http" && (
            <div className="space-y-1">
              <label className="text-xs text-muted">Device Address</label>
              <input
                type="text"
                value={httpAddress}
                onChange={(e) => setHttpAddress(e.target.value)}
                placeholder="meshtastic.local or 192.168.1.x"
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
              />
              <p className="text-xs text-muted">
                Enter hostname or IP address (without http://)
              </p>
            </div>
          )}

          {/* Connection hints */}
          <div className="text-xs text-muted bg-secondary-dark rounded-lg p-3 space-y-1">
            {connectionType === "ble" && (
              <>
                <p>Ensure your Meshtastic device has Bluetooth enabled and is in range.</p>
                <p>Click Connect to scan — a device picker will appear with discovered Meshtastic devices.</p>
              </>
            )}
            {connectionType === "serial" && (
              <>
                <p>Connect your Meshtastic device via USB cable.</p>
                <p>Click Connect — a port picker will appear with available serial ports.</p>
              </>
            )}
            {connectionType === "http" && (
              <p>Enter the IP address or hostname of a WiFi-connected Meshtastic node. The device must have WiFi enabled in its config.</p>
            )}
          </div>

          {/* Connect button + Save profile */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleConnect}
              className="flex-1 px-4 py-2.5 text-white text-sm font-medium rounded-lg transition-colors"
              style={{ backgroundColor: "#4CAF50" }}
            >
              Connect
            </button>
            <button
              onClick={() => setShowProfileForm(!showProfileForm)}
              className="px-3 py-2.5 bg-secondary-dark hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
              title="Save as profile"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Save Profile Form */}
      {showProfileForm && (
        <div className="bg-deep-black rounded-lg border border-gray-600 p-4 space-y-3">
          <label className="text-sm text-muted">Profile Name</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveProfile()}
              placeholder="e.g., Home Station, Hiking Radio"
              className="flex-1 px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none text-sm"
              autoFocus
            />
            <button
              onClick={handleSaveProfile}
              disabled={!profileName.trim()}
              className="px-4 py-2 disabled:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors"
              style={{ backgroundColor: "#4CAF50" }}
            >
              Save
            </button>
          </div>
          <p className="text-xs text-muted">
            Saves: {connectionType.toUpperCase()}
            {connectionType === "http" ? ` • ${httpAddress}` : ""}
          </p>
        </div>
      )}

      {mqttSection}
    </div>
  );
}
