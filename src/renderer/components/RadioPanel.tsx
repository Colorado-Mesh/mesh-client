import { useState, useEffect, useCallback } from "react";
import { useToast } from "./Toast";

interface ChannelConfig {
  index: number;
  name: string;
  role: number;
  psk: Uint8Array;
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
  positionPrecision: number;
}

interface Props {
  onSetConfig: (config: unknown) => Promise<void>;
  onCommit: () => Promise<void>;
  onSetChannel: (config: {
    index: number;
    role: number;
    settings: {
      name: string;
      psk: Uint8Array;
      uplinkEnabled: boolean;
      downlinkEnabled: boolean;
      positionPrecision: number;
    };
  }) => Promise<void>;
  onClearChannel: (index: number) => Promise<void>;
  channelConfigs: ChannelConfig[];
  isConnected: boolean;
  onReboot: (seconds: number) => Promise<void>;
  onShutdown: (seconds: number) => Promise<void>;
  onFactoryReset: () => Promise<void>;
  onResetNodeDb: () => Promise<void>;
}

const REGIONS = [
  { value: 0, label: "Unset" },
  { value: 1, label: "US" },
  { value: 2, label: "EU_433" },
  { value: 3, label: "EU_868" },
  { value: 4, label: "CN" },
  { value: 5, label: "JP" },
  { value: 6, label: "ANZ" },
  { value: 7, label: "KR" },
  { value: 8, label: "TW" },
  { value: 9, label: "RU" },
  { value: 10, label: "IN" },
  { value: 11, label: "NZ_865" },
  { value: 12, label: "TH" },
  { value: 13, label: "UA_433" },
  { value: 14, label: "UA_868" },
  { value: 15, label: "MY_433" },
  { value: 16, label: "MY_919" },
  { value: 17, label: "SG_923" },
  { value: 18, label: "LORA_24" },
];

const MODEM_PRESETS = [
  { value: 0, label: "Long Fast" },
  { value: 1, label: "Long Slow" },
  { value: 2, label: "Long Moderate" },
  { value: 3, label: "Short Fast" },
  { value: 4, label: "Short Slow" },
  { value: 5, label: "Medium Fast" },
  { value: 6, label: "Medium Slow" },
];

const DEVICE_ROLES = [
  { value: 0, label: "Client", description: "Normal client mode" },
  { value: 1, label: "Client Mute", description: "Client that does not transmit" },
  { value: 2, label: "Router", description: "Dedicated router/repeater" },
  { value: 3, label: "Router Client", description: "Router + client mode" },
  { value: 5, label: "Tracker", description: "GPS tracker only" },
  { value: 6, label: "Sensor", description: "Telemetry sensor node" },
  { value: 7, label: "TAK", description: "TAK-enabled device" },
  { value: 8, label: "Client Hidden", description: "Client, hidden from node list" },
  { value: 9, label: "Lost and Found", description: "Broadcasts position for recovery" },
  { value: 10, label: "TAK Tracker", description: "TAK tracker mode" },
];

const DISPLAY_UNITS = [
  { value: 0, label: "Metric" },
  { value: 1, label: "Imperial" },
];

/** Reusable select component */
function ConfigSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  description,
}: {
  label: string;
  value: number;
  options: Array<{ value: number; label: string; description?: string }>;
  onChange: (val: number) => void;
  disabled: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-muted">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-full px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {description && <p className="text-xs text-muted">{description}</p>}
    </div>
  );
}

/** Reusable toggle switch */
function ConfigToggle({
  label,
  checked,
  onChange,
  disabled,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-sm text-muted">{label}</label>
        <button
          onClick={() => onChange(!checked)}
          disabled={disabled}
          className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-50 ${
            checked ? "bg-brand-green" : "bg-gray-600"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              checked ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      {description && <p className="text-xs text-muted">{description}</p>}
    </div>
  );
}

/** Reusable number input */
function ConfigNumber({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  unit,
  description,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm text-muted">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          disabled={disabled}
          className="w-28 px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
        />
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      {description && <p className="text-xs text-muted">{description}</p>}
    </div>
  );
}

/** Collapsible section wrapper */
function ConfigSection({
  title,
  children,
  onApply,
  applying,
  disabled,
}: {
  title: string;
  children: React.ReactNode;
  onApply: () => void;
  applying: boolean;
  disabled: boolean;
}) {
  return (
    <details className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="px-4 py-3 cursor-pointer text-gray-200 font-medium flex items-center justify-between hover:bg-gray-800 rounded-lg transition-colors">
        <span>{title}</span>
        <svg
          className="w-4 h-4 text-muted group-open:rotate-180 transition-transform"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-4 pb-4 space-y-4">
        {children}
        <button
          onClick={onApply}
          disabled={disabled || applying}
          className="w-full px-4 py-2 bg-brand-green hover:bg-brand-green/90 disabled:bg-gray-600 disabled:text-muted text-white text-sm font-medium rounded-lg transition-colors"
        >
          {applying ? "Applying..." : `Apply ${title}`}
        </button>
      </div>
    </details>
  );
}

function pskToBase64(psk: Uint8Array): string {
  return btoa(String.fromCharCode(...psk));
}

function base64ToPsk(b64: string): Uint8Array {
  try {
    const binary = atob(b64);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array([1]);
  }
}

function generateRandomPsk(length: 16 | 32 = 32): Uint8Array {
  const psk = new Uint8Array(length);
  crypto.getRandomValues(psk);
  return psk;
}

type KeySize = "none" | "simple" | "aes128" | "aes256";

function pskToKeySize(psk: Uint8Array): KeySize {
  if (psk.length === 0 || (psk.length === 1 && psk[0] === 0)) return "none";
  if (psk.length === 1) return "simple";
  if (psk.length === 16) return "aes128";
  if (psk.length === 32) return "aes256";
  return "aes256";
}

function keySizeDefaultPsk(size: KeySize): Uint8Array {
  switch (size) {
    case "none":   return new Uint8Array([0x00]);
    case "simple": return new Uint8Array([0x01]);
    case "aes128": return generateRandomPsk(16);
    case "aes256": return generateRandomPsk(32);
  }
}

const CHANNEL_ROLES = [
  { value: 0, label: "Disabled" },
  { value: 1, label: "Primary" },
  { value: 2, label: "Secondary" },
];

// ─── Confirmation Modal ─────────────────────────────────────────
function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative bg-deep-black border border-gray-600 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-6 space-y-4">
        <h3 className="text-lg font-semibold text-gray-200">{title}</h3>
        <p className="text-sm text-muted leading-relaxed">{message}</p>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 bg-secondary-dark hover:bg-gray-600 text-gray-300 font-medium rounded-lg transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 px-4 py-2.5 font-medium rounded-lg transition-colors text-sm text-white ${
              danger
                ? "bg-red-600 hover:bg-red-500"
                : "bg-yellow-600 hover:bg-yellow-500"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PendingAction {
  name: string;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  action: () => Promise<void>;
}

export default function RadioPanel({
  onSetConfig,
  onCommit,
  onSetChannel,
  onClearChannel,
  channelConfigs,
  isConnected,
  onReboot,
  onShutdown,
  onFactoryReset,
  onResetNodeDb,
}: Props) {
  // ─── LoRa settings ────────────────────────────────────────────
  const [region, setRegion] = useState(1);
  const [modemPreset, setModemPreset] = useState(0);
  const [hopLimit, setHopLimit] = useState(3);

  // ─── Device settings ──────────────────────────────────────────
  const [deviceRole, setDeviceRole] = useState(0);

  // ─── Position settings ────────────────────────────────────────
  const [positionBroadcastSecs, setPositionBroadcastSecs] = useState(900);
  const [gpsUpdateInterval, setGpsUpdateInterval] = useState(120);
  const [fixedPosition, setFixedPosition] = useState(false);

  // ─── Power settings ───────────────────────────────────────────
  const [isPowerSaving, setIsPowerSaving] = useState(false);

  // ─── Bluetooth settings ───────────────────────────────────────
  const [btEnabled, setBtEnabled] = useState(true);
  const [btFixedPin, setBtFixedPin] = useState(123456);

  // ─── Display settings ─────────────────────────────────────────
  const [screenOnSecs, setScreenOnSecs] = useState(60);
  const [displayUnits, setDisplayUnits] = useState(0);

  // ─── Shared state ─────────────────────────────────────────────
  const [status, setStatus] = useState<string | null>(null);
  const [applyingSection, setApplyingSection] = useState<string | null>(null);

  // ─── Device command confirmation ──────────────────────────────
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const { addToast } = useToast();

  const disabled = !isConnected;

  const applyConfig = async (
    section: string,
    configCase: string,
    configValue: Record<string, unknown>
  ) => {
    if (!isConnected) return;
    setApplyingSection(section);
    setStatus(`Applying ${section}...`);
    try {
      await onSetConfig({
        payloadVariant: {
          case: configCase,
          value: configValue,
        },
      });
      await onCommit();
      setStatus(`${section} applied successfully!`);
    } catch (err) {
      setStatus(
        `Failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    } finally {
      setApplyingSection(null);
    }
  };

  const executeWithConfirmation = useCallback((action: PendingAction) => {
    setPendingAction(action);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;
    setPendingAction(null);
    try {
      await pendingAction.action();
      addToast(`${pendingAction.name} completed successfully.`, "success");
    } catch (err) {
      addToast(
        `Failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        "error"
      );
    }
  }, [pendingAction, addToast]);

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h2 className="text-xl font-semibold text-gray-200">
        Radio Configuration
      </h2>

      {!isConnected && (
        <div className="bg-yellow-900/30 border border-yellow-700 text-yellow-300 px-4 py-2 rounded-lg text-sm">
          Connect to a device to modify configuration.
        </div>
      )}

      {/* ═══ LoRa / Radio ═══ */}
      <ConfigSection
        title="LoRa / Radio"
        onApply={() =>
          applyConfig("LoRa", "lora", {
            region,
            modemPreset,
            usePreset: true,
            hopLimit,
          })
        }
        applying={applyingSection === "LoRa"}
        disabled={disabled}
      >
        <ConfigSelect
          label="Region"
          value={region}
          options={REGIONS}
          onChange={setRegion}
          disabled={disabled || applyingSection !== null}
        />
        <ConfigSelect
          label="Modem Preset"
          value={modemPreset}
          options={MODEM_PRESETS}
          onChange={setModemPreset}
          disabled={disabled || applyingSection !== null}
        />
        <div className="space-y-1">
          <label className="text-sm text-muted">Hop Limit</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={7}
              value={hopLimit}
              onChange={(e) => setHopLimit(Number(e.target.value))}
              disabled={disabled || applyingSection !== null}
              className="flex-1 accent-green-500 disabled:opacity-50"
            />
            <span className="text-gray-200 font-mono text-lg w-6 text-center">
              {hopLimit}
            </span>
          </div>
          <p className="text-xs text-muted">
            Number of times a message can be relayed (1–7). Higher = more
            reach, more airtime. Default: 3.
          </p>
        </div>
      </ConfigSection>

      {/* ═══ Device Role ═══ */}
      <ConfigSection
        title="Device Role"
        onApply={() => applyConfig("Device", "device", { role: deviceRole })}
        applying={applyingSection === "Device"}
        disabled={disabled}
      >
        <ConfigSelect
          label="Role"
          value={deviceRole}
          options={DEVICE_ROLES}
          onChange={setDeviceRole}
          disabled={disabled || applyingSection !== null}
          description={
            DEVICE_ROLES.find((r) => r.value === deviceRole)?.description
          }
        />
      </ConfigSection>

      {/* ═══ Position / GPS ═══ */}
      <ConfigSection
        title="Position / GPS"
        onApply={() =>
          applyConfig("Position", "position", {
            positionBroadcastSecs,
            gpsUpdateInterval,
            fixedPosition,
          })
        }
        applying={applyingSection === "Position"}
        disabled={disabled}
      >
        <ConfigNumber
          label="Position Broadcast Interval"
          value={positionBroadcastSecs}
          onChange={setPositionBroadcastSecs}
          disabled={disabled || applyingSection !== null}
          min={0}
          max={86400}
          unit="seconds"
          description="How often to broadcast position. 0 = use default (900s). Set higher to conserve airtime."
        />
        <ConfigNumber
          label="GPS Update Interval"
          value={gpsUpdateInterval}
          onChange={setGpsUpdateInterval}
          disabled={disabled || applyingSection !== null}
          min={0}
          max={86400}
          unit="seconds"
          description="How often to poll the GPS module. 0 = use default."
        />
        <ConfigToggle
          label="Fixed Position"
          checked={fixedPosition}
          onChange={setFixedPosition}
          disabled={disabled || applyingSection !== null}
          description="When enabled, the device will use a manually-set position instead of GPS."
        />
      </ConfigSection>

      {/* ═══ Power ═══ */}
      <ConfigSection
        title="Power"
        onApply={() =>
          applyConfig("Power", "power", { isPowerSaving })
        }
        applying={applyingSection === "Power"}
        disabled={disabled}
      >
        <ConfigToggle
          label="Power Saving Mode"
          checked={isPowerSaving}
          onChange={setIsPowerSaving}
          disabled={disabled || applyingSection !== null}
          description="Enable low-power mode. Reduces responsiveness but significantly extends battery life."
        />
      </ConfigSection>

      {/* ═══ Bluetooth ═══ */}
      <ConfigSection
        title="Bluetooth"
        onApply={() =>
          applyConfig("Bluetooth", "bluetooth", {
            enabled: btEnabled,
            fixedPin: btFixedPin,
          })
        }
        applying={applyingSection === "Bluetooth"}
        disabled={disabled}
      >
        <ConfigToggle
          label="Bluetooth Enabled"
          checked={btEnabled}
          onChange={setBtEnabled}
          disabled={disabled || applyingSection !== null}
          description="Toggle Bluetooth radio on the device."
        />
        <ConfigNumber
          label="Pairing PIN"
          value={btFixedPin}
          onChange={setBtFixedPin}
          disabled={disabled || applyingSection !== null || !btEnabled}
          min={100000}
          max={999999}
          description="6-digit fixed PIN for Bluetooth pairing. Default: 123456."
        />
      </ConfigSection>

      {/* ═══ Display ═══ */}
      <ConfigSection
        title="Display"
        onApply={() =>
          applyConfig("Display", "display", {
            screenOnSecs,
            units: displayUnits,
          })
        }
        applying={applyingSection === "Display"}
        disabled={disabled}
      >
        <ConfigNumber
          label="Screen On Duration"
          value={screenOnSecs}
          onChange={setScreenOnSecs}
          disabled={disabled || applyingSection !== null}
          min={0}
          max={3600}
          unit="seconds"
          description="How long the screen stays on after activity. 0 = always on."
        />
        <ConfigSelect
          label="Display Units"
          value={displayUnits}
          options={DISPLAY_UNITS}
          onChange={setDisplayUnits}
          disabled={disabled || applyingSection !== null}
        />
      </ConfigSection>

      {/* ═══ Channels ═══ */}
      <ChannelSection
        channelConfigs={channelConfigs}
        onSetChannel={onSetChannel}
        onClearChannel={onClearChannel}
        onCommit={onCommit}
        disabled={disabled}
        setStatus={setStatus}
      />

      {/* Status */}
      {status && (
        <div
          className={`px-4 py-2 rounded-lg text-sm ${
            status.includes("Failed")
              ? "bg-red-900/50 border border-red-700 text-red-300"
              : status.includes("success")
              ? "bg-brand-green/10 border border-brand-green text-bright-green"
              : "bg-deep-black text-muted"
          }`}
        >
          {status}
        </div>
      )}

      {/* Info */}
      <div className="bg-deep-black rounded-lg p-4 text-sm text-muted space-y-1">
        <p>
          Changes are written to the device's flash memory and persist across
          reboots.
        </p>
        <p>
          The device may briefly restart after applying new LoRa or device
          settings.
        </p>
      </div>

      {/* Device Commands */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">Device Commands (affects connected device)</h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() =>
              executeWithConfirmation({
                name: "Reboot",
                title: "Reboot Device",
                message:
                  "This will reboot the connected Meshtastic device. It will briefly go offline during restart.",
                confirmLabel: "Reboot",
                action: () => onReboot(2),
              })
            }
            disabled={!isConnected}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Reboot
          </button>

          <button
            onClick={() =>
              executeWithConfirmation({
                name: "Shutdown",
                title: "Shutdown Device",
                message:
                  "This will power off the connected device. You will need to physically power it back on.",
                confirmLabel: "Shutdown",
                action: () => onShutdown(2),
              })
            }
            disabled={!isConnected}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Shutdown
          </button>

          <button
            onClick={() =>
              executeWithConfirmation({
                name: "Reset NodeDB",
                title: "Reset Node Database",
                message:
                  "This will clear the device's internal node database. The device will re-discover nodes over time.",
                confirmLabel: "Reset NodeDB",
                action: () => onResetNodeDb(),
              })
            }
            disabled={!isConnected}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Reset NodeDB
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-red-400">Danger Zone</h3>
        <div className="border border-red-900 rounded-lg p-4 space-y-2">
          <p className="text-xs text-red-400/80">
            These actions are permanent and cannot be undone.
          </p>
          <button
            onClick={() =>
              executeWithConfirmation({
                name: "Factory Reset",
                title: "⚠ Factory Reset",
                message:
                  "This will erase ALL device settings and restore factory defaults. All channels, configuration, and stored data on the device will be permanently lost. This action CANNOT be undone.",
                confirmLabel: "Factory Reset",
                danger: true,
                action: () => onFactoryReset(),
              })
            }
            disabled={!isConnected}
            className="w-full px-4 py-3 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Factory Reset Device
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {pendingAction && (
        <ConfirmModal
          title={pendingAction.title}
          message={pendingAction.message}
          confirmLabel={pendingAction.confirmLabel}
          danger={pendingAction.danger}
          onConfirm={handleConfirm}
          onCancel={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}

// ─── Security level helpers ──────────────────────────────────────
type SecurityLevel = "encrypted" | "open" | "open-location" | "open-location-uplink";

function getSecurityLevel(cfg: ChannelConfig): SecurityLevel {
  const secure = cfg.psk.length === 16 || cfg.psk.length === 32;
  if (secure) return "encrypted";
  if (cfg.positionPrecision > 0 && cfg.uplinkEnabled) return "open-location-uplink";
  if (cfg.positionPrecision > 0) return "open-location";
  return "open";
}

function SecurityIcon({ level }: { level: SecurityLevel }) {
  if (level === "encrypted") {
    return (
      <span title="AES encrypted" className="text-green-400 flex items-center">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </span>
    );
  }
  const tooltip =
    level === "open-location-uplink"
      ? "Unencrypted location sent to internet via MQTT"
      : level === "open-location"
      ? "Unencrypted + location data"
      : "No encryption";
  return (
    <span title={tooltip} className="text-yellow-500 flex items-center gap-0.5">
      <svg className={`w-3.5 h-3.5 ${level !== "open" ? "text-red-400" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
      </svg>
      {level === "open-location-uplink" && (
        <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      )}
    </span>
  );
}

// ─── Channel Management Section ─────────────────────────────────
function ChannelSection({
  channelConfigs,
  onSetChannel,
  onClearChannel,
  onCommit,
  disabled,
  setStatus,
}: {
  channelConfigs: ChannelConfig[];
  onSetChannel: Props["onSetChannel"];
  onClearChannel: Props["onClearChannel"];
  onCommit: Props["onCommit"];
  disabled: boolean;
  setStatus: (s: string) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<number>(0);
  const [editKeySize, setEditKeySize] = useState<KeySize>("simple");
  const [editPskB64, setEditPskB64] = useState("AQ==");
  const [editUplink, setEditUplink] = useState(false);
  const [editDownlink, setEditDownlink] = useState(false);
  const [editPosPrecision, setEditPosPrecision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Populate edit state when selection changes
  useEffect(() => {
    if (selectedIndex === null) return;
    const cfg = channelConfigs.find((c) => c.index === selectedIndex);
    if (cfg) {
      setEditName(cfg.name);
      setEditRole(cfg.role);
      setEditKeySize(pskToKeySize(cfg.psk));
      setEditPskB64(pskToBase64(cfg.psk));
      setEditUplink(cfg.uplinkEnabled);
      setEditDownlink(cfg.downlinkEnabled);
      setEditPosPrecision(cfg.positionPrecision);
    } else {
      setEditName("");
      setEditRole(selectedIndex === 0 ? 1 : 0);
      setEditKeySize("simple");
      setEditPskB64("AQ==");
      setEditUplink(false);
      setEditDownlink(false);
      setEditPosPrecision(0);
    }
    setValidationError(null);
  }, [selectedIndex, channelConfigs]);

  const handleKeySizeChange = (size: KeySize) => {
    setEditKeySize(size);
    setEditPskB64(pskToBase64(keySizeDefaultPsk(size)));
    setValidationError(null);
  };

  const saveChannel = async () => {
    if (selectedIndex === null || saving) return;
    setValidationError(null);
    const psk = base64ToPsk(editPskB64);
    if (editKeySize === "aes128" && psk.length !== 16) {
      setValidationError("AES-128 key must be exactly 16 bytes (24 base64 chars)");
      return;
    }
    if (editKeySize === "aes256" && psk.length !== 32) {
      setValidationError("AES-256 key must be exactly 32 bytes (44 base64 chars)");
      return;
    }
    setSaving(true);
    try {
      await onSetChannel({
        index: selectedIndex,
        role: editRole,
        settings: {
          name: editName,
          psk,
          uplinkEnabled: editUplink,
          downlinkEnabled: editDownlink,
          positionPrecision: editPosPrecision,
        },
      });
      await onCommit();
      setStatus(`Channel ${selectedIndex} saved!`);
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setSaving(false);
    }
  };

  const resetChannel = async () => {
    if (selectedIndex === null || saving) return;
    setSaving(true);
    try {
      if (selectedIndex === 0) {
        await onSetChannel({
          index: 0,
          role: 1,
          settings: {
            name: "",
            psk: new Uint8Array([0x01]),
            uplinkEnabled: false,
            downlinkEnabled: false,
            positionPrecision: 0,
          },
        });
      } else {
        await onClearChannel(selectedIndex);
      }
      await onCommit();
      setStatus(`Channel ${selectedIndex} reset!`);
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : "Unknown"}`);
    } finally {
      setSaving(false);
    }
  };

  // Always show 8 slots
  const slots = Array.from({ length: 8 }, (_, i) => {
    return channelConfigs.find((ch) => ch.index === i) ?? null;
  });

  const isAesKey = editKeySize === "aes128" || editKeySize === "aes256";

  return (
    <details className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="px-4 py-3 cursor-pointer text-gray-200 font-medium flex items-center justify-between hover:bg-gray-800 rounded-lg transition-colors">
        <span>Channels</span>
        <svg
          className="w-4 h-4 text-muted group-open:rotate-180 transition-transform"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-4 pb-4 space-y-3">
        {/* ── Channel List ── */}
        <div className="space-y-1">
          {slots.map((cfg, i) => {
            const isSelected = selectedIndex === i;
            const role = cfg?.role ?? 0;
            const secLevel = cfg && role !== 0 ? getSecurityLevel(cfg) : null;
            return (
              <button
                key={i}
                onClick={() => setSelectedIndex(i)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                  isSelected
                    ? "bg-gray-700 border border-gray-500"
                    : "bg-deep-black/60 border border-gray-700/50 hover:bg-gray-800"
                }`}
              >
                {/* Index badge */}
                <span className={`text-xs font-mono px-1.5 py-0.5 rounded font-bold ${
                  i === 0 ? "bg-blue-900/60 text-blue-300" : "bg-gray-700 text-gray-400"
                }`}>
                  {i}
                </span>
                {/* Name */}
                <span className={`flex-1 text-sm ${role !== 0 ? "text-gray-200" : "text-muted italic"}`}>
                  {cfg?.name || (i === 0 ? "Primary" : role !== 0 ? `Channel ${i}` : "Disabled")}
                </span>
                {/* Role badge */}
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  role === 1
                    ? "bg-brand-green/10 text-bright-green"
                    : role === 2
                    ? "bg-blue-900/50 text-blue-400"
                    : "bg-gray-800 text-muted"
                }`}>
                  {CHANNEL_ROLES.find((r) => r.value === role)?.label ?? "Disabled"}
                </span>
                {/* Security indicator */}
                {secLevel && <SecurityIcon level={secLevel} />}
              </button>
            );
          })}
        </div>

        {/* ── Edit Form ── */}
        {selectedIndex !== null && (
          <div className="mt-3 p-3 bg-deep-black/60 rounded-lg border border-gray-600 space-y-3">
            <h4 className="text-sm font-medium text-gray-200">
              Edit Channel {selectedIndex}
            </h4>

            {/* Name */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted">Name</label>
                <span className="text-xs text-muted">{editName.length}/11</span>
              </div>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={11}
                disabled={disabled}
                placeholder={selectedIndex === 0 ? "Primary" : "Channel name"}
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-sm text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Role — locked for ch0 */}
            {selectedIndex !== 0 && (
              <div className="space-y-1">
                <label className="text-xs text-muted">Role</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(Number(e.target.value))}
                  disabled={disabled}
                  className="w-full px-2 py-1.5 bg-secondary-dark rounded text-sm text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
                >
                  <option value={0}>Disabled</option>
                  <option value={2}>Secondary</option>
                </select>
              </div>
            )}

            {/* Key Size */}
            <div className="space-y-1">
              <label className="text-xs text-muted">Key Size</label>
              <select
                value={editKeySize}
                onChange={(e) => handleKeySizeChange(e.target.value as KeySize)}
                disabled={disabled}
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-sm text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
              >
                <option value="none">None (no encryption)</option>
                <option value="simple">Simple (default Meshtastic key)</option>
                <option value="aes128">AES-128</option>
                <option value="aes256">AES-256</option>
              </select>
            </div>

            {/* Encryption Key */}
            <div className="space-y-1">
              <label className="text-xs text-muted">Encryption Key (base64)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editPskB64}
                  onChange={(e) => {
                    setEditPskB64(e.target.value);
                    setValidationError(null);
                  }}
                  disabled={disabled || !isAesKey}
                  readOnly={!isAesKey}
                  placeholder="base64..."
                  className="flex-1 px-2 py-1.5 bg-secondary-dark rounded text-xs font-mono text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50 read-only:opacity-60"
                />
                {isAesKey && (
                  <button
                    onClick={() => setEditPskB64(pskToBase64(generateRandomPsk(editKeySize === "aes128" ? 16 : 32)))}
                    disabled={disabled}
                    className="px-2 py-1.5 text-xs bg-secondary-dark text-muted hover:text-gray-200 rounded border border-gray-600 disabled:opacity-50 whitespace-nowrap"
                    title="Generate random key"
                  >
                    Regenerate
                  </button>
                )}
              </div>
              {validationError && (
                <p className="text-xs text-red-400">{validationError}</p>
              )}
            </div>

            {/* MQTT Uplink */}
            <ConfigToggle
              label="MQTT Uplink"
              checked={editUplink}
              onChange={setEditUplink}
              disabled={disabled}
              description="Forward received packets to MQTT broker"
            />

            {/* MQTT Downlink */}
            <ConfigToggle
              label="MQTT Downlink"
              checked={editDownlink}
              onChange={setEditDownlink}
              disabled={disabled}
              description="Subscribe to MQTT broker and re-broadcast packets"
            />

            {/* Position Precision */}
            <div className="space-y-1">
              <label className="text-xs text-muted">Position Precision (0 = no location)</label>
              <input
                type="number"
                value={editPosPrecision}
                onChange={(e) => setEditPosPrecision(Number(e.target.value))}
                min={0}
                max={32}
                disabled={disabled}
                className="w-28 px-2 py-1.5 bg-secondary-dark rounded text-sm text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveChannel}
                disabled={disabled || saving}
                className="flex-1 px-3 py-1.5 bg-brand-green hover:bg-brand-green/90 disabled:bg-gray-600 disabled:text-muted text-white text-xs font-medium rounded transition-colors"
              >
                {saving ? "Saving..." : "Save Channel"}
              </button>
              <button
                onClick={resetChannel}
                disabled={disabled || saving}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-xs font-medium rounded transition-colors"
                title={selectedIndex === 0 ? "Reset to defaults" : "Disable channel"}
              >
                Reset
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-muted">
          Select a channel to edit. AES-128/256 keys are shown in base64 (Meshtastic convention).
        </p>
      </div>
    </details>
  );
}
