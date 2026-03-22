import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { OurPosition } from '../lib/gpsSource';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import { HelpTooltip } from './HelpTooltip';
import { useToast } from './Toast';

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
  telemetryDeviceUpdateInterval?: number | null;
  onReboot: (seconds: number) => Promise<void>;
  onShutdown: (seconds: number) => Promise<void>;
  onFactoryReset: () => Promise<void>;
  onResetNodeDb: () => Promise<void>;
  ourPosition?: OurPosition | null;
  onSendPositionToDevice?: (lat: number, lon: number, alt?: number) => Promise<void>;
  deviceOwner?: { longName: string; shortName: string; isLicensed: boolean } | null;
  onSetOwner?: (owner: {
    longName: string;
    shortName: string;
    isLicensed: boolean;
  }) => Promise<void>;
  onRebootOta?: (delay: number) => Promise<void>;
  onEnterDfu?: () => Promise<void>;
  onFactoryResetConfig?: () => Promise<void>;
  capabilities?: ProtocolCapabilities;
  meshcoreChannels?: { index: number; name: string; secret: Uint8Array }[];
  onMeshcoreSetChannel?: (idx: number, name: string, secret: Uint8Array) => Promise<void>;
  onMeshcoreDeleteChannel?: (idx: number) => Promise<void>;
  onApplyLoraParams?: (params: {
    freq: number;
    bw: number;
    sf: number;
    cr: number;
    txPower: number;
  }) => Promise<void>;
  loraConfig?: { freq?: number; bw?: number; sf?: number; cr?: number; txPower?: number };
}

const REGIONS = [
  { value: 0, label: 'Unset' },
  { value: 1, label: 'US' },
  { value: 2, label: 'EU_433' },
  { value: 3, label: 'EU_868' },
  { value: 4, label: 'CN' },
  { value: 5, label: 'JP' },
  { value: 6, label: 'ANZ' },
  { value: 7, label: 'KR' },
  { value: 8, label: 'TW' },
  { value: 9, label: 'RU' },
  { value: 10, label: 'IN' },
  { value: 11, label: 'NZ_865' },
  { value: 12, label: 'TH' },
  { value: 13, label: 'UA_433' },
  { value: 14, label: 'UA_868' },
  { value: 15, label: 'MY_433' },
  { value: 16, label: 'MY_919' },
  { value: 17, label: 'SG_923' },
  { value: 18, label: 'LORA_24' },
];

const MODEM_PRESETS = [
  { value: 0, label: 'Long Fast' },
  { value: 1, label: 'Long Slow' },
  { value: 2, label: 'Long Moderate' },
  { value: 3, label: 'Short Fast' },
  { value: 4, label: 'Short Slow' },
  { value: 5, label: 'Medium Fast' },
  { value: 6, label: 'Medium Slow' },
];

const DEVICE_ROLES = [
  { value: 0, label: 'Client', description: 'Normal client mode' },
  { value: 1, label: 'Client Mute', description: 'Client that does not transmit' },
  { value: 2, label: 'Router', description: 'Dedicated router/repeater' },
  { value: 3, label: 'Router Client', description: 'Router + client mode' },
  { value: 4, label: 'Client Base', description: 'Base station for client devices' },
  { value: 5, label: 'Tracker', description: 'GPS tracker only' },
  { value: 6, label: 'Sensor', description: 'Telemetry sensor node' },
  { value: 7, label: 'TAK', description: 'TAK-enabled device' },
  { value: 8, label: 'Client Hidden', description: 'Client, hidden from node list' },
  { value: 9, label: 'Lost and Found', description: 'Broadcasts position for recovery' },
  { value: 10, label: 'TAK Tracker', description: 'TAK tracker mode' },
];

const DISPLAY_UNITS = [
  { value: 0, label: 'Metric' },
  { value: 1, label: 'Imperial' },
];

/** Reusable select component */
function ConfigSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  description,
  tooltip,
}: {
  label: string;
  value: number;
  options: { value: number; label: string; description?: string }[];
  onChange: (val: number) => void;
  disabled: boolean;
  description?: string;
  tooltip?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label className="text-sm text-muted">{label}</label>
        {tooltip && <HelpTooltip text={tooltip} />}
      </div>
      <select
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          onChange(n);
        }}
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
            checked ? 'bg-brand-green' : 'bg-gray-600'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      {description && <p className="text-xs text-muted">{description}</p>}
    </div>
  );
}

/** Reusable number input */
export function ConfigNumber({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  unit,
  description,
  tooltip,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  unit?: string;
  description?: string;
  tooltip?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <label className="text-sm text-muted">{label}</label>
        {tooltip && <HelpTooltip text={tooltip} />}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n)) return;
            onChange(n);
          }}
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
  onApply?: () => void;
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
        {onApply && (
          <button
            onClick={onApply}
            disabled={disabled || applying}
            className="w-full px-4 py-2 bg-readable-green hover:bg-readable-green/90 disabled:bg-gray-600 disabled:text-muted text-white text-sm font-medium rounded-lg transition-colors"
          >
            {applying ? 'Applying...' : `Apply ${title}`}
          </button>
        )}
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
  } catch (e) {
    console.debug('[RadioPanel] base64ToPsk invalid', e);
    return new Uint8Array([1]);
  }
}

function generateRandomPsk(length: 16 | 32 = 32): Uint8Array {
  const psk = new Uint8Array(length);
  crypto.getRandomValues(psk);
  return psk;
}

type KeySize = 'none' | 'simple' | 'aes128' | 'aes256';

function pskToKeySize(psk: Uint8Array): KeySize {
  if (psk.length === 0 || (psk.length === 1 && psk[0] === 0)) return 'none';
  if (psk.length === 1) return 'simple';
  if (psk.length === 16) return 'aes128';
  if (psk.length === 32) return 'aes256';
  return 'aes256';
}

function keySizeDefaultPsk(size: KeySize): Uint8Array {
  switch (size) {
    case 'none':
      return new Uint8Array([0x00]);
    case 'simple':
      return new Uint8Array([0x01]);
    case 'aes128':
      return generateRandomPsk(16);
    case 'aes256':
      return generateRandomPsk(32);
  }
}

const CHANNEL_ROLES = [
  { value: 0, label: 'Disabled' },
  { value: 1, label: 'Primary' },
  { value: 2, label: 'Secondary' },
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
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm cursor-pointer border-0 p-0"
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
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-yellow-600 hover:bg-yellow-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function WifiPasswordField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [show, setShow] = useState(false);
  const wifiPwdId = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={wifiPwdId} className="text-sm text-muted">
        WiFi Password
      </label>
      <div className="flex items-center gap-1">
        <input
          id={wifiPwdId}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="Password"
          maxLength={64}
          className="flex-1 px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          disabled={disabled}
          className="px-2 py-2 text-xs text-muted hover:text-gray-300 disabled:opacity-50"
        >
          {show ? 'Hide' : 'Show'}
        </button>
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
  telemetryDeviceUpdateInterval,
  onReboot,
  onShutdown,
  onFactoryReset,
  onResetNodeDb,
  ourPosition,
  onSendPositionToDevice,
  deviceOwner,
  onSetOwner,
  onRebootOta,
  onEnterDfu,
  onFactoryResetConfig,
  capabilities,
  meshcoreChannels,
  onMeshcoreSetChannel,
  onMeshcoreDeleteChannel,
  onApplyLoraParams,
  loraConfig,
}: Props) {
  // ─── User / Identity settings ─────────────────────────────────
  const [longName, setLongName] = useState('');
  const [shortName, setShortName] = useState('');
  const [isLicensed, setIsLicensed] = useState(false);

  useEffect(() => {
    if (deviceOwner) {
      setLongName(deviceOwner.longName);
      setShortName(deviceOwner.shortName);
      setIsLicensed(deviceOwner.isLicensed);
    }
  }, [deviceOwner]);

  // ─── LoRa settings ────────────────────────────────────────────
  const [region, setRegion] = useState(1);
  const [modemPreset, setModemPreset] = useState(0);
  const [hopLimit, setHopLimit] = useState(3);
  const [usePreset, setUsePreset] = useState(true);
  const [bandwidth, setBandwidth] = useState(250);
  const [spreadFactor, setSpreadFactor] = useState(12);
  const [codingRate, setCodingRate] = useState(8);
  const [txPower, setTxPower] = useState(17);
  const [rxBoostedGain, setRxBoostedGain] = useState(false);
  // MeshCore-specific: frequency in Hz (displayed as MHz). MeshCore getSelfInfo returns freq in MHz.
  const freqToHz = (f: number) => (f >= 1e6 ? f : Math.round(f * 1e6));
  const [radioFreqHz, setRadioFreqHz] = useState(() =>
    loraConfig?.freq != null ? freqToHz(loraConfig.freq) : 915000000,
  );

  // Sync LoRa state from loraConfig prop (MeshCore device info)
  useEffect(() => {
    if (!loraConfig) return;
    if (loraConfig.freq != null) setRadioFreqHz(freqToHz(loraConfig.freq));
    if (loraConfig.bw != null) setBandwidth(loraConfig.bw / 1000);
    if (loraConfig.sf != null) setSpreadFactor(loraConfig.sf);
    if (loraConfig.cr != null) setCodingRate(loraConfig.cr);
    if (loraConfig.txPower != null) setTxPower(loraConfig.txPower);
  }, [loraConfig]);

  // ─── Device settings ──────────────────────────────────────────
  const [deviceRole, setDeviceRole] = useState(0);

  // ─── Position settings ────────────────────────────────────────
  const [positionBroadcastSecs, setPositionBroadcastSecs] = useState(900);
  const [gpsUpdateInterval, setGpsUpdateInterval] = useState(120);
  const [fixedPosition, setFixedPosition] = useState(false);
  // String state for position inputs to allow typing negative values (e.g. "-105.06")
  const [latStr, setLatStr] = useState(() => String(ourPosition?.lat ?? 0));
  const [lonStr, setLonStr] = useState(() => String(ourPosition?.lon ?? 0));
  const [altStr, setAltStr] = useState('0');
  const [gpsMode, setGpsMode] = useState(0);
  const [positionPrecision, setPositionPrecision] = useState(10);
  const [smartPositionEnabled, setSmartPositionEnabled] = useState(false);
  const [smartPositionMinDistance, setSmartPositionMinDistance] = useState(100);
  const [smartPositionMinInterval, setSmartPositionMinInterval] = useState(30);

  // ─── Power settings ───────────────────────────────────────────
  const [isPowerSaving, setIsPowerSaving] = useState(false);
  const [minWakeSecs, setMinWakeSecs] = useState(0);
  const [waitBluetoothSecs, setWaitBluetoothSecs] = useState(0);
  const [sdsSecs, setSdsSecs] = useState(0);
  const [lsSecs, setLsSecs] = useState(0);
  const [onBatteryShutdownAfterSecs, setOnBatteryShutdownAfterSecs] = useState(0);

  // ─── WiFi / Network settings ─────────────────────────────────
  const [wifiEnabled, setWifiEnabled] = useState(false);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPsk, setWifiPsk] = useState('');
  const [ntpServer, setNtpServer] = useState('');
  const [ethEnabled, setEthEnabled] = useState(false);

  // ─── Bluetooth settings ───────────────────────────────────────
  const [btEnabled, setBtEnabled] = useState(true);
  const [btFixedPin, setBtFixedPin] = useState(123456);

  // ─── Display settings ─────────────────────────────────────────
  const [screenOnSecs, setScreenOnSecs] = useState(60);
  const [displayUnits, setDisplayUnits] = useState(0);

  // ─── Telemetry (device metrics) ────────────────────────────────
  const [deviceUpdateInterval, setDeviceUpdateInterval] = useState(1800);

  // Sync telemetry interval from device config when received
  useEffect(() => {
    if (typeof telemetryDeviceUpdateInterval === 'number') {
      setDeviceUpdateInterval(telemetryDeviceUpdateInterval);
    }
  }, [telemetryDeviceUpdateInterval]);

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
    configValue: Record<string, unknown>,
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
      console.warn('[RadioPanel] apply section failed', err);
      setStatus(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
      addToast(`${pendingAction.name} completed successfully.`, 'success');
    } catch (err) {
      console.warn('[RadioPanel] pending action failed', err);
      addToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    }
  }, [pendingAction, addToast]);

  const handleImportConfig = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const cfg = JSON.parse(ev.target?.result as string);
          console.debug('[RadioPanel] parsed config JSON:', cfg);
          console.debug(
            `[RadioPanel] current device state before import: radioFreqHz=${radioFreqHz} bandwidth=${bandwidth}`,
          );

          // ── Extract values ───────────────────────────────────────────
          const importedName = cfg.name ? String(cfg.name) : null;
          let importedFreqHz: number | null = null;
          let importedBwKhz: number | null = null;
          let importedSf: number | null = null;
          let importedCr: number | null = null;
          let importedTxPower: number | null = null;

          if (importedName) setLongName(importedName);

          if (cfg.radio_settings) {
            const rs = cfg.radio_settings;
            console.debug(
              `[RadioPanel] radio_settings from config: frequency=${rs.frequency} bandwidth=${rs.bandwidth} spreading_factor=${rs.spreading_factor} coding_rate=${rs.coding_rate} tx_power=${rs.tx_power}`,
            );
            // frequency: kHz in config file → Hz for state
            if (typeof rs.frequency === 'number') {
              importedFreqHz = rs.frequency * 1000;
              setRadioFreqHz(importedFreqHz);
            }
            // bandwidth: Hz in config → kHz (float ok, e.g. 62500 → 62.5)
            if (typeof rs.bandwidth === 'number') {
              const bwKhz = rs.bandwidth / 1000;
              importedBwKhz = bwKhz;
              setBandwidth(bwKhz);
            }
            if (typeof rs.spreading_factor === 'number') {
              importedSf = rs.spreading_factor;
              setSpreadFactor(rs.spreading_factor);
            }
            // coding_rate: denominator (4–8); state stores denominator directly (display adds 4)
            if (typeof rs.coding_rate === 'number') {
              importedCr = rs.coding_rate;
              setCodingRate(rs.coding_rate);
            }
            if (typeof rs.tx_power === 'number') {
              importedTxPower = rs.tx_power;
              setTxPower(rs.tx_power);
            }
            console.debug(
              `[RadioPanel] extracted lora values: importedFreqHz=${importedFreqHz} importedBwKhz=${importedBwKhz} importedSf=${importedSf} importedCr=${importedCr} importedTxPower=${importedTxPower}`,
            );
          } else {
            console.warn('[RadioPanel] no radio_settings in config');
          }

          if (cfg.public_key || cfg.private_key) {
            try {
              localStorage.setItem(
                'mesh-client:meshcoreIdentity',
                JSON.stringify({ public_key: cfg.public_key, private_key: cfg.private_key }),
              );
              window.dispatchEvent(new Event('meshclient:meshcoreIdentityUpdated'));
            } catch {
              // catch-no-log-ok localStorage quota or private mode — non-critical identity cache
            }
          }

          // ── Auto-apply to device ─────────────────────────────────────
          const applied: string[] = [];
          const notSupported: string[] = [];

          if (importedName && onSetOwner) {
            console.debug('[RadioPanel] calling onSetOwner with name:', importedName);
            try {
              await onSetOwner({ longName: importedName, shortName, isLicensed });
              console.debug('[RadioPanel] onSetOwner succeeded');
              applied.push('name');
            } catch (e) {
              console.error('[RadioPanel] onSetOwner threw:', e);
              notSupported.push('name');
            }
          } else {
            console.debug(
              '[RadioPanel] skipping onSetOwner — name:',
              importedName,
              'handler:',
              !!onSetOwner,
            );
          }

          const hasLoraData =
            importedFreqHz !== null &&
            importedBwKhz !== null &&
            importedSf !== null &&
            importedCr !== null &&
            importedTxPower !== null;
          console.debug(
            '[RadioPanel] hasLoraData:',
            hasLoraData,
            'onApplyLoraParams:',
            !!onApplyLoraParams,
          );
          if (hasLoraData && onApplyLoraParams) {
            const loraPayload = {
              freq: importedFreqHz!,
              bw: importedBwKhz! * 1000,
              sf: importedSf!,
              cr: importedCr!,
              txPower: importedTxPower!,
            };
            console.debug(
              `[RadioPanel] calling onApplyLoraParams with: freq=${loraPayload.freq} bw=${loraPayload.bw} sf=${loraPayload.sf} cr=${loraPayload.cr} txPower=${loraPayload.txPower}`,
            );
            try {
              await onApplyLoraParams(loraPayload);
              console.debug('[RadioPanel] onApplyLoraParams succeeded');
              applied.push('radio settings');
            } catch (e) {
              console.error('[RadioPanel] onApplyLoraParams threw:', e);
              notSupported.push('radio settings');
            }
          }

          if (notSupported.length > 0) {
            const parts = ['Config imported.'];
            if (applied.length > 0) {
              parts.push(` Applied to device: ${applied.join(', ')}.`);
            }
            parts.push(` Not supported by this device: ${notSupported.join(', ')}.`);
            addToast(parts.join(''), 'warning');
          } else if (applied.length > 0) {
            addToast('Config imported and applied successfully.', 'success');
          } else {
            addToast('Config imported. No device changes to apply.', 'success');
          }
        } catch (err) {
          console.error('[RadioPanel] config import error:', err);
          addToast(
            `Failed to parse config: ${err instanceof Error ? err.message : 'Invalid JSON'}`,
            'error',
          );
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [addToast, onSetOwner, onApplyLoraParams, shortName, isLicensed, bandwidth, radioFreqHz]);

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h2 className="text-xl font-semibold text-gray-200">Radio Configuration</h2>

      {capabilities?.protocol === 'meshcore' && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleImportConfig}
            className="px-3 py-1.5 text-sm bg-secondary-dark hover:bg-gray-700 text-gray-300 border border-gray-600 rounded-lg transition-colors"
          >
            Import Config JSON
          </button>
        </div>
      )}

      {!isConnected && (
        <div className="bg-yellow-900/30 border border-yellow-700 text-yellow-300 px-4 py-2 rounded-lg text-sm">
          Connect to a device to modify configuration.
        </div>
      )}

      {/* ═══ Bluetooth ═══ */}
      {capabilities?.hasBluetoothConfig !== false && (
        <ConfigSection
          title="Bluetooth"
          onApply={() =>
            applyConfig('Bluetooth', 'bluetooth', {
              enabled: btEnabled,
              fixedPin: btFixedPin,
            })
          }
          applying={applyingSection === 'Bluetooth'}
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
      )}

      {/* ═══ Channels ═══ */}
      {capabilities?.hasChannelConfig !== false && (
        <ChannelSection
          channelConfigs={channelConfigs}
          onSetChannel={onSetChannel}
          onClearChannel={onClearChannel}
          onCommit={onCommit}
          disabled={disabled}
          setStatus={setStatus}
        />
      )}

      {capabilities?.protocol === 'meshcore' && meshcoreChannels !== undefined && (
        <MeshcoreChannelSection
          channels={meshcoreChannels}
          onSetChannel={onMeshcoreSetChannel ?? (async () => {})}
          onDeleteChannel={onMeshcoreDeleteChannel ?? (async () => {})}
          disabled={disabled}
        />
      )}

      {/* ═══ Device Role ═══ */}
      {capabilities?.hasDeviceRoleConfig !== false && (
        <ConfigSection
          title="Device Role"
          onApply={() => applyConfig('Device', 'device', { role: deviceRole })}
          applying={applyingSection === 'Device'}
          disabled={disabled}
        >
          <ConfigSelect
            label="Role"
            value={deviceRole}
            options={DEVICE_ROLES}
            onChange={setDeviceRole}
            disabled={disabled || applyingSection !== null}
            description={DEVICE_ROLES.find((r) => r.value === deviceRole)?.description}
          />
        </ConfigSection>
      )}

      {/* ═══ Device User / Identity ═══ */}
      <ConfigSection
        title="Device User / Identity"
        onApply={async () => {
          if (!onSetOwner) return;
          setApplyingSection('User');
          setStatus('Applying User...');
          try {
            await onSetOwner({ longName, shortName, isLicensed });
            setStatus('User applied successfully!');
          } catch (err) {
            console.warn('[RadioPanel] setOwner failed:', err instanceof Error ? err.message : err);
            setStatus(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
          } finally {
            setApplyingSection(null);
          }
        }}
        applying={applyingSection === 'User'}
        disabled={disabled || !onSetOwner}
      >
        <div className="space-y-1">
          <label htmlFor="radio-long-name" className="text-sm text-muted">
            {capabilities?.protocol === 'meshcore' ? 'Name' : 'Long Name'}
          </label>
          <input
            id="radio-long-name"
            type="text"
            value={longName}
            onChange={(e) =>
              setLongName(
                capabilities?.protocol === 'meshcore'
                  ? e.target.value
                  : e.target.value.slice(0, 39),
              )
            }
            maxLength={capabilities?.protocol === 'meshcore' ? undefined : 39}
            disabled={disabled}
            placeholder="Your Name"
            className="w-full px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
          />
          <p className="text-xs text-muted">
            {capabilities?.protocol === 'meshcore'
              ? 'Advertised node name (emoji supported)'
              : 'Display name (max 39 chars)'}
          </p>
        </div>
        {capabilities?.protocol !== 'meshcore' && (
          <>
            <div className="space-y-1">
              <label htmlFor="radio-short-name" className="text-sm text-muted">
                Short Name
              </label>
              <input
                id="radio-short-name"
                type="text"
                value={shortName}
                onChange={(e) => setShortName(e.target.value.slice(0, 4))}
                maxLength={4}
                disabled={disabled}
                placeholder="NAME"
                className="w-full px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
              />
              <p className="text-xs text-muted">
                Short identifier shown on tiny displays (max 4 chars)
              </p>
            </div>
            <ConfigToggle
              label="Licensed (Ham Radio Operator)"
              checked={isLicensed}
              onChange={setIsLicensed}
              disabled={disabled}
              description="Enables additional frequencies for licensed amateur radio operators"
            />
          </>
        )}
      </ConfigSection>

      {/* ═══ Display ═══ */}
      {capabilities?.hasDisplayConfig !== false && (
        <ConfigSection
          title="Display"
          onApply={() =>
            applyConfig('Display', 'display', {
              screenOnSecs,
              units: displayUnits,
            })
          }
          applying={applyingSection === 'Display'}
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
      )}

      {/* ═══ LoRa / Radio ═══ */}
      {onApplyLoraParams ? (
        /* MeshCore path: direct radio params (freq, bw, sf, cr, txPower) */
        <ConfigSection
          title="LoRa / Radio"
          onApply={async () => {
            if (!onApplyLoraParams) return;
            setApplyingSection('LoRa');
            setStatus('Applying LoRa...');
            try {
              await onApplyLoraParams({
                freq: radioFreqHz,
                bw: bandwidth * 1000,
                sf: spreadFactor,
                cr: codingRate,
                txPower,
              });
              setStatus('LoRa applied successfully!');
            } catch (err) {
              console.warn(
                '[RadioPanel] setLoRaConfig failed:',
                err instanceof Error ? err.message : err,
              );
              setStatus(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            } finally {
              setApplyingSection(null);
            }
          }}
          applying={applyingSection === 'LoRa'}
          disabled={disabled}
        >
          <div className="space-y-1">
            <label htmlFor="radio-freq-mhz" className="text-sm text-muted">
              Frequency (MHz)
            </label>
            <input
              id="radio-freq-mhz"
              type="number"
              value={(radioFreqHz / 1e6).toFixed(3)}
              onChange={(e) => {
                const parsed = parseFloat(e.target.value);
                if (!Number.isNaN(parsed)) setRadioFreqHz(Math.round(parsed * 1e6));
              }}
              step={0.001}
              min={150}
              max={960}
              disabled={disabled || applyingSection !== null}
              className="w-36 px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
            />
            <p className="text-xs text-muted">Operating frequency. Check local regulations.</p>
          </div>
          <div className="space-y-4 pl-3 border-l border-gray-700">
            <ConfigSelect
              label="Bandwidth"
              value={bandwidth}
              options={[
                { value: 31, label: '31.25 kHz' },
                { value: 62, label: '62.5 kHz' },
                { value: 125, label: '125 kHz' },
                { value: 250, label: '250 kHz' },
                { value: 500, label: '500 kHz' },
              ]}
              onChange={setBandwidth}
              disabled={disabled || applyingSection !== null}
              tooltip="Channel width in kHz. Narrower = longer range and less interference but slower data rate. All nodes on the network must use the same bandwidth."
            />
            <ConfigSelect
              label="Spread Factor"
              value={spreadFactor}
              options={Array.from({ length: 6 }, (_, i) => ({
                value: i + 7,
                label: `SF${i + 7}`,
              }))}
              onChange={setSpreadFactor}
              disabled={disabled || applyingSection !== null}
              description="Higher = more range but slower airtime. Default: SF12."
            />
            <ConfigSelect
              label="Coding Rate"
              value={codingRate}
              options={[
                { value: 5, label: '4/5' },
                { value: 6, label: '4/6' },
                { value: 7, label: '4/7' },
                { value: 8, label: '4/8' },
              ]}
              onChange={setCodingRate}
              disabled={disabled || applyingSection !== null}
              tooltip="Forward error correction overhead. 4/5 = minimal redundancy (faster). 4/8 = maximum redundancy (more resilient to interference). All nodes must match."
            />
            <ConfigNumber
              label="TX Power"
              value={txPower}
              onChange={setTxPower}
              disabled={disabled || applyingSection !== null}
              min={1}
              max={30}
              unit="dBm"
              description="Transmit power. Check local regulations before increasing."
              tooltip="Transmit power in dBm (1–30). Higher = longer range but more power draw. Check regional regulations for the legal maximum in your area."
            />
          </div>
        </ConfigSection>
      ) : (
        /* Meshtastic path: region, presets, hop limit */
        <ConfigSection
          title="LoRa / Radio"
          onApply={() =>
            applyConfig('LoRa', 'lora', {
              region,
              modemPreset,
              usePreset,
              hopLimit,
              ...(usePreset
                ? {}
                : {
                    bandwidth,
                    spreadFactor,
                    codingRate,
                    txPower,
                    sx126xRxBoostedGain: rxBoostedGain,
                  }),
            })
          }
          applying={applyingSection === 'LoRa'}
          disabled={disabled}
        >
          <ConfigSelect
            label="Region"
            value={region}
            options={REGIONS}
            onChange={setRegion}
            disabled={disabled || applyingSection !== null}
          />
          <ConfigToggle
            label="Use modem preset"
            checked={usePreset}
            onChange={setUsePreset}
            disabled={disabled || applyingSection !== null}
            description="Use a predefined modem configuration. Disable for custom RF parameters."
          />
          {usePreset ? (
            <ConfigSelect
              label="Modem Preset"
              value={modemPreset}
              options={MODEM_PRESETS}
              onChange={setModemPreset}
              disabled={disabled || applyingSection !== null}
            />
          ) : (
            <div className="space-y-4 pl-3 border-l border-gray-700">
              <ConfigSelect
                label="Bandwidth"
                value={bandwidth}
                options={[
                  { value: 31, label: '31.25 kHz' },
                  { value: 62, label: '62.5 kHz' },
                  { value: 125, label: '125 kHz' },
                  { value: 250, label: '250 kHz' },
                  { value: 500, label: '500 kHz' },
                ]}
                onChange={setBandwidth}
                disabled={disabled || applyingSection !== null}
                tooltip="Channel width in kHz. Narrower = longer range and less interference but slower data rate. All nodes on the network must use the same bandwidth."
              />
              <ConfigSelect
                label="Spread Factor"
                value={spreadFactor}
                options={Array.from({ length: 6 }, (_, i) => ({
                  value: i + 7,
                  label: `SF${i + 7}`,
                }))}
                onChange={setSpreadFactor}
                disabled={disabled || applyingSection !== null}
                description="Higher = more range but slower airtime. Default: SF12."
              />
              <ConfigSelect
                label="Coding Rate"
                value={codingRate}
                options={[
                  { value: 5, label: '4/5' },
                  { value: 6, label: '4/6' },
                  { value: 7, label: '4/7' },
                  { value: 8, label: '4/8' },
                ]}
                onChange={setCodingRate}
                disabled={disabled || applyingSection !== null}
                tooltip="Forward error correction overhead. 4/5 = minimal redundancy (faster). 4/8 = maximum redundancy (more resilient to interference). All nodes must match."
              />
              <ConfigNumber
                label="TX Power"
                value={txPower}
                onChange={setTxPower}
                disabled={disabled || applyingSection !== null}
                min={1}
                max={30}
                unit="dBm"
                description="Transmit power. Check local regulations before increasing."
                tooltip="Transmit power in dBm (1–30). Higher = longer range but more power draw. Check regional regulations for the legal maximum in your area."
              />
              <ConfigToggle
                label="SX126x RX Boosted Gain"
                checked={rxBoostedGain}
                onChange={setRxBoostedGain}
                disabled={disabled || applyingSection !== null}
                description="Enable boosted LNA gain for better receive sensitivity (SX1262/1268 chips only)."
              />
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="radio-hop-limit" className="text-sm text-muted">
              Hop Limit
            </label>
            <div className="flex items-center gap-3">
              <input
                id="radio-hop-limit"
                type="range"
                min={1}
                max={7}
                value={hopLimit}
                onChange={(e) => setHopLimit(Number(e.target.value))}
                disabled={disabled || applyingSection !== null}
                className="flex-1 accent-green-500 disabled:opacity-50"
              />
              <span className="text-gray-200 font-mono text-lg w-6 text-center">{hopLimit}</span>
            </div>
            <p className="text-xs text-muted">
              Number of times a message can be relayed (1–7). Higher = more reach, more airtime.
              Default: 3.
            </p>
          </div>
        </ConfigSection>
      )}

      {/* ═══ Position / GPS ═══ */}
      <ConfigSection
        title="Position / GPS"
        onApply={
          capabilities?.hasFullPositionConfig === false
            ? undefined
            : () =>
                applyConfig('Position', 'position', {
                  positionBroadcastSecs,
                  gpsUpdateInterval,
                  fixedPosition,
                  gpsMode,
                  positionPrecision,
                  smartPositionEnabled,
                  broadcastSmartMinimumDistance: smartPositionMinDistance,
                  broadcastSmartMinimumIntervalSecs: smartPositionMinInterval,
                })
        }
        applying={applyingSection === 'Position'}
        disabled={disabled || capabilities?.hasFullPositionConfig === false}
      >
        {capabilities?.hasFullPositionConfig !== false && (
          <>
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
            <ConfigSelect
              label="GPS Mode"
              value={gpsMode}
              options={[
                { value: 0, label: 'Disabled' },
                { value: 1, label: 'Enabled' },
                { value: 2, label: 'Not Present' },
              ]}
              onChange={setGpsMode}
              disabled={disabled || applyingSection !== null}
              description="GPS_DISABLED: no GPS; GPS_ENABLED: use GPS; GPS_NOT_PRESENT: hardware lacks GPS."
            />
            <ConfigNumber
              label="Position precision"
              value={positionPrecision}
              onChange={setPositionPrecision}
              disabled={disabled || applyingSection !== null}
              min={1}
              max={19}
              description="Obfuscation level (1=coarsest, 19=exact). Lower values hide your exact location."
            />
            <ConfigToggle
              label="Smart position broadcast"
              checked={smartPositionEnabled}
              onChange={setSmartPositionEnabled}
              disabled={disabled || applyingSection !== null}
              description="Only broadcast position when you have moved enough or enough time has passed."
            />
            {smartPositionEnabled && (
              <div className="space-y-4 pl-3 border-l border-gray-700">
                <ConfigNumber
                  label="Min distance to trigger"
                  value={smartPositionMinDistance}
                  onChange={setSmartPositionMinDistance}
                  disabled={disabled || applyingSection !== null}
                  min={0}
                  unit="meters"
                />
                <ConfigNumber
                  label="Min interval"
                  value={smartPositionMinInterval}
                  onChange={setSmartPositionMinInterval}
                  disabled={disabled || applyingSection !== null}
                  min={0}
                  unit="seconds"
                />
              </div>
            )}
            <ConfigToggle
              label="Fixed Position"
              checked={fixedPosition}
              onChange={setFixedPosition}
              disabled={disabled || applyingSection !== null}
              description="When enabled, the device will use a manually-set position instead of GPS."
            />
          </>
        )}
        {/* For Meshtastic: lat/lon shown when fixedPosition toggle is on */}
        {/* For MeshCore: lat/lon always shown (fixed position is the only option) */}
        {(fixedPosition || capabilities?.hasFullPositionConfig === false) && (
          <div className="space-y-3 pt-2 border-t border-gray-700">
            <p className="text-xs text-muted">
              Set coordinates to send to the device.
              {ourPosition && (
                <button
                  type="button"
                  onClick={() => {
                    setLatStr(String(ourPosition.lat));
                    setLonStr(String(ourPosition.lon));
                  }}
                  className="ml-2 text-brand-green underline hover:opacity-80"
                >
                  Use current GPS
                </button>
              )}
            </p>
            <div className="space-y-1">
              <label htmlFor="radio-fixed-lat" className="text-sm text-muted">
                Latitude
              </label>
              <input
                id="radio-fixed-lat"
                type="text"
                inputMode="decimal"
                value={latStr}
                onChange={(e) => setLatStr(e.target.value)}
                disabled={disabled || applyingSection !== null}
                placeholder="0.000000"
                className="w-36 px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="radio-fixed-lon" className="text-sm text-muted">
                Longitude
              </label>
              <input
                id="radio-fixed-lon"
                type="text"
                inputMode="decimal"
                value={lonStr}
                onChange={(e) => setLonStr(e.target.value)}
                disabled={disabled || applyingSection !== null}
                placeholder="0.000000"
                className="w-36 px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="radio-fixed-alt" className="text-sm text-muted">
                Altitude (m)
              </label>
              <input
                id="radio-fixed-alt"
                type="text"
                inputMode="decimal"
                value={altStr}
                onChange={(e) => setAltStr(e.target.value)}
                disabled={disabled || applyingSection !== null}
                placeholder="0"
                className="w-36 px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
              />
            </div>
            <button
              onClick={async () => {
                if (!onSendPositionToDevice) return;
                const lat = parseFloat(latStr);
                const lon = parseFloat(lonStr);
                const alt = parseFloat(altStr);
                if (!isFinite(lat) || !isFinite(lon)) {
                  addToast('Invalid coordinates — enter valid lat/lon values.', 'error');
                  return;
                }
                try {
                  await onSendPositionToDevice(lat, lon, isFinite(alt) ? alt : 0);
                  addToast('Position sent to device.', 'success');
                } catch (err) {
                  console.warn('[RadioPanel] send position to device failed', err);
                  addToast(
                    capabilities?.protocol === 'meshcore'
                      ? `Device GPS set failed (${err instanceof Error ? err.message : 'unknown'}). Using App Location (static/browser/IP) for map position.`
                      : `Failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
                    'error',
                  );
                }
              }}
              disabled={disabled || !onSendPositionToDevice}
              className="w-full px-4 py-2 bg-readable-green hover:bg-readable-green/90 disabled:bg-gray-600 disabled:text-muted text-white text-sm font-medium rounded-lg transition-colors"
            >
              Send Position to Device
            </button>
          </div>
        )}
      </ConfigSection>

      {/* ═══ Power ═══ */}
      {capabilities?.hasPowerConfig !== false && (
        <ConfigSection
          title="Power"
          onApply={() =>
            applyConfig('Power', 'power', {
              isPowerSaving,
              minWakeSecs,
              waitBluetoothSecs,
              sdsSecs,
              lsSecs,
              onBatteryShutdownAfterSecs,
            })
          }
          applying={applyingSection === 'Power'}
          disabled={disabled}
        >
          <ConfigToggle
            label="Power Saving Mode"
            checked={isPowerSaving}
            onChange={setIsPowerSaving}
            disabled={disabled || applyingSection !== null}
            description="Enable low-power mode. Reduces responsiveness but significantly extends battery life."
          />
          <ConfigNumber
            label="Min wake duration"
            value={minWakeSecs}
            onChange={setMinWakeSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            unit="seconds"
            description="Minimum time to stay awake after waking. 0 = use default."
          />
          <ConfigNumber
            label="Bluetooth idle timeout"
            value={waitBluetoothSecs}
            onChange={setWaitBluetoothSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            unit="seconds"
            description="Seconds to wait before disabling BT when no client is connected. 0 = never."
          />
          <ConfigNumber
            label="Super deep sleep after"
            value={sdsSecs}
            onChange={setSdsSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            unit="seconds"
            description="Enter super deep sleep after this many seconds of inactivity. 0 = disabled."
          />
          <ConfigNumber
            label="Light sleep duration"
            value={lsSecs}
            onChange={setLsSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            unit="seconds"
            description="Duration of light sleep cycles. 0 = use default."
          />
          <ConfigNumber
            label="Battery shutdown after"
            value={onBatteryShutdownAfterSecs}
            onChange={setOnBatteryShutdownAfterSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            unit="seconds"
            description="Shut down on battery after this many seconds since last mesh activity. 0 = disabled."
          />
        </ConfigSection>
      )}

      {/* ═══ Telemetry ═══ */}
      {capabilities?.hasTelemetryIntervalConfig !== false && (
        <ConfigSection
          title="Telemetry"
          onApply={() =>
            applyConfig('Telemetry', 'telemetry', {
              device_update_interval: deviceUpdateInterval,
            })
          }
          applying={applyingSection === 'Telemetry'}
          disabled={disabled}
        >
          <ConfigNumber
            label="Device metrics update interval"
            value={deviceUpdateInterval}
            onChange={setDeviceUpdateInterval}
            disabled={disabled || applyingSection !== null}
            min={0}
            max={86400}
            unit="seconds"
            description="How often to send device metrics (battery, voltage, channel utilization) to the mesh. 0 = disabled. Default 1800 (30 min)."
          />
        </ConfigSection>
      )}

      {/* ═══ WiFi / Network ═══ */}
      {capabilities?.hasWifiConfig !== false && (
        <ConfigSection
          title="WiFi / Network"
          onApply={() =>
            applyConfig('Network', 'network', {
              wifiEnabled,
              wifiSsid,
              wifiPsk,
              ntpServer,
              ethEnabled,
            })
          }
          applying={applyingSection === 'Network'}
          disabled={disabled}
        >
          <ConfigToggle
            label="WiFi enabled"
            checked={wifiEnabled}
            onChange={setWifiEnabled}
            disabled={disabled || applyingSection !== null}
            description="Enable the device's WiFi radio. Requires reboot to take effect."
          />
          <div className="space-y-1">
            <label htmlFor="radio-wifi-ssid" className="text-sm text-muted">
              WiFi SSID
            </label>
            <input
              id="radio-wifi-ssid"
              type="text"
              value={wifiSsid}
              onChange={(e) => setWifiSsid(e.target.value)}
              disabled={disabled || !wifiEnabled || applyingSection !== null}
              placeholder="Network name"
              maxLength={33}
              className="w-full px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
            />
          </div>
          <WifiPasswordField
            value={wifiPsk}
            onChange={setWifiPsk}
            disabled={disabled || !wifiEnabled || applyingSection !== null}
          />
          <div className="space-y-1">
            <label htmlFor="radio-ntp-server" className="text-sm text-muted">
              NTP Server
            </label>
            <input
              id="radio-ntp-server"
              type="text"
              value={ntpServer}
              onChange={(e) => setNtpServer(e.target.value)}
              disabled={disabled || applyingSection !== null}
              placeholder="0.pool.ntp.org"
              className="w-full px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
            />
            <p className="text-xs text-muted">Leave empty for default NTP server.</p>
          </div>
          <ConfigToggle
            label="Ethernet enabled"
            checked={ethEnabled}
            onChange={setEthEnabled}
            disabled={disabled || applyingSection !== null}
            description="Enable hardware Ethernet (supported on select devices)."
          />
        </ConfigSection>
      )}

      {/* Status */}
      {status && (
        <div
          className={`px-4 py-2 rounded-lg text-sm ${
            status.includes('Failed')
              ? 'bg-red-900/50 border border-red-700 text-red-300'
              : status.includes('success')
                ? 'bg-brand-green/10 border border-brand-green text-bright-green'
                : 'bg-deep-black text-muted'
          }`}
        >
          {status}
        </div>
      )}

      {/* Info */}
      <div className="bg-deep-black rounded-lg p-4 text-sm text-muted space-y-1">
        <p>Changes are written to the device's flash memory and persist across reboots.</p>
        <p>The device may briefly restart after applying new LoRa or device settings.</p>
      </div>

      {/* Device Commands */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted">
          Device Commands (affects connected device)
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() =>
              executeWithConfirmation({
                name: 'Reboot',
                title: 'Reboot Device',
                message:
                  'This will reboot the connected Meshtastic device. It will briefly go offline during restart.',
                confirmLabel: 'Reboot',
                action: () => onReboot(2),
              })
            }
            disabled={!isConnected}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Reboot
          </button>

          {capabilities?.hasShutdown !== false && (
            <button
              onClick={() =>
                executeWithConfirmation({
                  name: 'Shutdown',
                  title: 'Shutdown Device',
                  message:
                    'This will power off the connected device. You will need to physically power it back on.',
                  confirmLabel: 'Shutdown',
                  action: () => onShutdown(2),
                })
              }
              disabled={!isConnected}
              className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              Shutdown
            </button>
          )}

          {capabilities?.hasNodeDbReset !== false && (
            <button
              onClick={() =>
                executeWithConfirmation({
                  name: 'Reset NodeDB',
                  title: 'Reset Node Database',
                  message:
                    "This will clear the device's internal node database. The device will re-discover nodes over time.",
                  confirmLabel: 'Reset NodeDB',
                  action: () => onResetNodeDb(),
                })
              }
              disabled={!isConnected}
              className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              Reset NodeDB
            </button>
          )}

          <button
            onClick={() =>
              executeWithConfirmation({
                name: 'Reboot to OTA',
                title: 'Reboot to OTA',
                message:
                  'This will reboot the device into OTA (Over The Air) firmware update mode.',
                confirmLabel: 'Reboot to OTA',
                action: () => onRebootOta?.(10) ?? Promise.resolve(),
              })
            }
            disabled={!isConnected || !onRebootOta}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Reboot to OTA
          </button>

          <button
            onClick={() =>
              executeWithConfirmation({
                name: 'Enter DFU Mode',
                title: 'Enter DFU Mode',
                message:
                  'This will reboot the device into Device Firmware Update (DFU) mode for firmware flashing.',
                confirmLabel: 'Enter DFU',
                action: () => onEnterDfu?.() ?? Promise.resolve(),
              })
            }
            disabled={!isConnected || !onEnterDfu}
            className="px-4 py-3 bg-secondary-dark text-gray-300 hover:bg-gray-600 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
          >
            Enter DFU Mode
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      {capabilities?.hasFactoryReset !== false && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-red-400">Danger Zone</h3>
          <div className="border border-red-900 rounded-lg p-4 space-y-2">
            <p className="text-xs text-red-400/80">
              These actions are permanent and cannot be undone.
            </p>
            <button
              onClick={() =>
                executeWithConfirmation({
                  name: 'Factory Reset',
                  title: '⚠ Factory Reset',
                  message:
                    'This will erase ALL device settings and restore factory defaults. All channels, configuration, and stored data on the device will be permanently lost. This action CANNOT be undone.',
                  confirmLabel: 'Factory Reset',
                  danger: true,
                  action: () => onFactoryReset(),
                })
              }
              disabled={!isConnected}
              className="w-full px-4 py-3 bg-red-900/50 text-red-300 hover:bg-red-900/70 border border-red-800 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              Factory Reset Device
            </button>
            <button
              onClick={() =>
                executeWithConfirmation({
                  name: 'Factory Reset Config',
                  title: '⚠ Factory Reset Config',
                  message:
                    'This will reset device configuration to factory defaults, but preserves your node database. Settings will need to be reconfigured.',
                  confirmLabel: 'Reset Config',
                  danger: true,
                  action: () => onFactoryResetConfig?.() ?? Promise.resolve(),
                })
              }
              disabled={!isConnected || !onFactoryResetConfig}
              className="w-full px-4 py-3 bg-red-900/40 text-red-300 hover:bg-red-900/60 border border-red-800/60 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
            >
              Factory Reset Config Only
            </button>
          </div>
        </div>
      )}

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
type SecurityLevel = 'encrypted' | 'open' | 'open-location' | 'open-location-uplink';

function getSecurityLevel(cfg: ChannelConfig): SecurityLevel {
  const secure = cfg.psk.length === 16 || cfg.psk.length === 32;
  if (secure) return 'encrypted';
  if (cfg.positionPrecision > 0 && cfg.uplinkEnabled) return 'open-location-uplink';
  if (cfg.positionPrecision > 0) return 'open-location';
  return 'open';
}

function SecurityIcon({ level }: { level: SecurityLevel }) {
  if (level === 'encrypted') {
    return (
      <span title="AES encrypted" className="text-green-400 flex items-center">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      </span>
    );
  }
  const tooltip =
    level === 'open-location-uplink'
      ? 'Unencrypted location sent to internet via MQTT'
      : level === 'open-location'
        ? 'Unencrypted + location data'
        : 'No encryption';
  return (
    <span title={tooltip} className="text-yellow-500 flex items-center gap-0.5">
      <svg
        className={`w-3.5 h-3.5 ${level !== 'open' ? 'text-red-400' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z"
        />
      </svg>
      {level === 'open-location-uplink' && (
        <svg
          className="w-3.5 h-3.5 text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
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
  onSetChannel: Props['onSetChannel'];
  onClearChannel: Props['onClearChannel'];
  onCommit: Props['onCommit'];
  disabled: boolean;
  setStatus: (s: string) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<number>(0);
  const [editKeySize, setEditKeySize] = useState<KeySize>('simple');
  const [editPskB64, setEditPskB64] = useState('AQ==');
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
      setEditName('');
      setEditRole(selectedIndex === 0 ? 1 : 0);
      setEditKeySize('simple');
      setEditPskB64('AQ==');
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
    if (editKeySize === 'aes128' && psk.length !== 16) {
      setValidationError('AES-128 key must be exactly 16 bytes (24 base64 chars)');
      return;
    }
    if (editKeySize === 'aes256' && psk.length !== 32) {
      setValidationError('AES-256 key must be exactly 32 bytes (44 base64 chars)');
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
      console.warn('[RadioPanel] save channel failed', err);
      setStatus(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
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
            name: '',
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
      console.warn('[RadioPanel] reset channel failed', err);
      setStatus(`Failed: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setSaving(false);
    }
  };

  // Always show 8 slots
  const slots = Array.from({ length: 8 }, (_, i) => {
    return channelConfigs.find((ch) => ch.index === i) ?? null;
  });

  const isAesKey = editKeySize === 'aes128' || editKeySize === 'aes256';

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
                    ? 'bg-gray-700 border border-gray-500'
                    : 'bg-deep-black/60 border border-gray-700/50 hover:bg-gray-800'
                }`}
              >
                {/* Index badge */}
                <span
                  className={`text-xs font-mono px-1.5 py-0.5 rounded font-bold ${
                    i === 0 ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {i}
                </span>
                {/* Name */}
                <span
                  className={`flex-1 text-sm ${role !== 0 ? 'text-gray-200' : 'text-muted italic'}`}
                >
                  {cfg?.name || (i === 0 ? 'Primary' : role !== 0 ? `Channel ${i}` : 'Disabled')}
                </span>
                {/* Role badge */}
                <span
                  className={`text-xs px-1.5 py-0.5 rounded ${
                    role === 1
                      ? 'bg-brand-green/10 text-bright-green'
                      : role === 2
                        ? 'bg-blue-900/50 text-blue-400'
                        : 'bg-gray-800 text-muted'
                  }`}
                >
                  {CHANNEL_ROLES.find((r) => r.value === role)?.label ?? 'Disabled'}
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
            <h4 className="text-sm font-medium text-gray-200">Edit Channel {selectedIndex}</h4>

            {/* Name */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="radio-mt-ch-name" className="text-xs text-muted">
                  Name
                </label>
                <span className="text-xs text-muted">{editName.length}/11</span>
              </div>
              <input
                id="radio-mt-ch-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={11}
                disabled={disabled}
                placeholder={selectedIndex === 0 ? 'Primary' : 'Channel name'}
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-sm text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Role — locked for ch0 */}
            {selectedIndex !== 0 && (
              <div className="space-y-1">
                <label htmlFor="radio-mt-ch-role" className="text-xs text-muted">
                  Role
                </label>
                <select
                  id="radio-mt-ch-role"
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
              <div className="flex items-center gap-1.5">
                <label htmlFor="radio-mt-ch-key-size" className="text-xs text-muted">
                  Key Size
                </label>
                <HelpTooltip text="None = no encryption. Simple = default Meshtastic key (shared by all default-config devices — not private). AES-128/256 = custom private key. All nodes on this channel must use the same key." />
              </div>
              <select
                id="radio-mt-ch-key-size"
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
              <div className="flex items-center gap-1.5">
                <label htmlFor="radio-mt-ch-psk" className="text-xs text-muted">
                  Encryption Key (base64)
                </label>
                <HelpTooltip text="Base64-encoded encryption key. AES-128 = 16 bytes (24 base64 chars). AES-256 = 32 bytes (44 base64 chars). Use 'Generate' for a random key, or paste a shared key from another node." />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="radio-mt-ch-psk"
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
                    onClick={() =>
                      setEditPskB64(
                        pskToBase64(generateRandomPsk(editKeySize === 'aes128' ? 16 : 32)),
                      )
                    }
                    disabled={disabled}
                    className="px-2 py-1.5 text-xs bg-secondary-dark text-muted hover:text-gray-200 rounded border border-gray-600 disabled:opacity-50 whitespace-nowrap"
                    title="Generate random key"
                  >
                    Regenerate
                  </button>
                )}
              </div>
              {validationError && <p className="text-xs text-red-400">{validationError}</p>}
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
              <label htmlFor="radio-mt-ch-pos-precision" className="text-xs text-muted">
                Position Precision (0 = no location)
              </label>
              <input
                id="radio-mt-ch-pos-precision"
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
                className="flex-1 px-3 py-1.5 bg-readable-green hover:bg-readable-green/90 disabled:bg-gray-600 disabled:text-muted text-white text-xs font-medium rounded transition-colors"
              >
                {saving ? 'Saving...' : 'Save Channel'}
              </button>
              <button
                onClick={resetChannel}
                disabled={disabled || saving}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-xs font-medium rounded transition-colors"
                title={selectedIndex === 0 ? 'Reset to defaults' : 'Disable channel'}
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

// ─── MeshCore Channel Management Section ─────────────────────────────────
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function MeshcoreChannelSection({
  channels,
  onSetChannel,
  onDeleteChannel,
  disabled,
}: {
  channels: { index: number; name: string; secret: Uint8Array }[];
  onSetChannel: (idx: number, name: string, secret: Uint8Array) => Promise<void>;
  onDeleteChannel: (idx: number) => Promise<void>;
  disabled: boolean;
}) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editKeyHex, setEditKeyHex] = useState('');
  const [revealedIdx, setRevealedIdx] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newIdx, setNewIdx] = useState('');
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const isValidHex = editKeyHex.length === 32 && /^[0-9a-fA-F]{32}$/.test(editKeyHex);

  useEffect(() => {
    if (editingIdx !== null || addingNew) {
      if (detailsRef.current) detailsRef.current.open = true;
    }
  }, [editingIdx, addingNew]);

  useEffect(() => {
    if ((editingIdx !== null || addingNew) && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [editingIdx, addingNew]);

  function openEdit(ch: { index: number; name: string; secret: Uint8Array }) {
    setEditingIdx(ch.index);
    setEditName(ch.name);
    setEditKeyHex(ch.secret && ch.secret.length === 16 ? bytesToHex(ch.secret) : '');
    setAddingNew(false);
  }

  function openAdd() {
    setAddingNew(true);
    setEditingIdx(null);
    setNewIdx('');
    setEditName('');
    setEditKeyHex('');
  }

  async function handleSave() {
    const idx = addingNew ? parseInt(newIdx, 10) : editingIdx!;
    if (isNaN(idx) || idx < 0 || idx > 7) return;
    if (!isValidHex) return;
    setSaving(true);
    try {
      await onSetChannel(idx, editName, hexToBytes(editKeyHex));
      setEditingIdx(null);
      setAddingNew(false);
    } catch (e) {
      console.warn('[MeshcoreChannelSection] save failed', e);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(idx: number) {
    setSaving(true);
    try {
      await onDeleteChannel(idx);
      setConfirmDeleteIdx(null);
      if (editingIdx === idx) setEditingIdx(null);
    } catch (e) {
      console.warn('[MeshcoreChannelSection] delete failed', e);
    } finally {
      setSaving(false);
    }
  }

  function generateKey() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    setEditKeyHex(bytesToHex(bytes));
  }

  const showForm = editingIdx !== null || addingNew;

  return (
    <details
      ref={detailsRef}
      className="group rounded-lg border border-gray-700/60 bg-secondary-dark/40 overflow-hidden"
    >
      <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-gray-800/40 transition-colors">
        <span className="text-sm font-semibold text-gray-200">Channels (MeshCore)</span>
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
          {channels.length === 0 && (
            <p className="text-xs text-muted italic">No channels configured.</p>
          )}
          {channels.map((ch) => {
            const revealed = revealedIdx.has(ch.index);
            return (
              <div
                key={ch.index}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-deep-black/60 border border-gray-700/50"
              >
                <span className="text-xs font-mono px-1.5 py-0.5 rounded font-bold bg-gray-700 text-gray-400">
                  {ch.index}
                </span>
                <span className="flex-1 text-sm text-gray-200">
                  {ch.name || `Channel ${ch.index}`}
                </span>
                <span className="text-xs font-mono text-muted">
                  {revealed ? bytesToHex(ch.secret) : '••••••••••••••••'}
                </span>
                <button
                  onClick={() =>
                    setRevealedIdx((prev) => {
                      const next = new Set(prev);
                      if (next.has(ch.index)) next.delete(ch.index);
                      else next.add(ch.index);
                      return next;
                    })
                  }
                  className="text-xs text-muted hover:text-gray-300 px-1"
                  title={revealed ? 'Hide key' : 'Reveal key'}
                >
                  {revealed ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(ch);
                  }}
                  disabled={disabled}
                  className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 px-1"
                >
                  Edit
                </button>
                {confirmDeleteIdx === ch.index ? (
                  <span className="flex items-center gap-1">
                    <button
                      onClick={() => handleDelete(ch.index)}
                      disabled={disabled || saving}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDeleteIdx(null)}
                      className="text-xs text-muted hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteIdx(ch.index)}
                    disabled={disabled || saving}
                    className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50 px-1"
                  >
                    Delete
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Edit / Add Form ── */}
        {showForm && (
          <div
            ref={formRef}
            className="mt-3 p-3 bg-deep-black/60 rounded-lg border border-gray-600 space-y-3"
          >
            <h4 className="text-sm font-medium text-gray-200">
              {addingNew ? 'Add Channel' : `Edit Channel ${editingIdx}`}
            </h4>

            {addingNew && (
              <div className="space-y-1">
                <label htmlFor="radio-mc-ch-idx" className="text-xs text-muted">
                  Index (0–7)
                </label>
                <input
                  id="radio-mc-ch-idx"
                  type="number"
                  value={newIdx}
                  onChange={(e) => setNewIdx(e.target.value)}
                  min={0}
                  max={7}
                  disabled={disabled}
                  className="w-20 px-2 py-1.5 bg-secondary-dark rounded text-sm text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
                />
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="radio-mc-ch-name" className="text-xs text-muted">
                Name
              </label>
              <input
                id="radio-mc-ch-name"
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={11}
                disabled={disabled}
                className="w-full px-2 py-1.5 bg-secondary-dark rounded text-sm text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="radio-mc-ch-key" className="text-xs text-muted">
                  Key (32 hex chars = 16 bytes)
                </label>
                <button onClick={generateKey} className="text-xs text-blue-400 hover:text-blue-300">
                  Generate random
                </button>
              </div>
              <input
                id="radio-mc-ch-key"
                type="text"
                value={editKeyHex}
                onChange={(e) => setEditKeyHex(e.target.value.toLowerCase())}
                maxLength={32}
                placeholder="00000000000000000000000000000000"
                disabled={disabled}
                className={`w-full px-2 py-1.5 bg-secondary-dark rounded text-sm font-mono border focus:outline-none disabled:opacity-50 ${
                  editKeyHex.length > 0 && !isValidHex
                    ? 'border-red-500 text-red-400'
                    : 'border-gray-600 text-gray-200 focus:border-brand-green'
                }`}
              />
              {editKeyHex.length > 0 && !isValidHex && (
                <p className="text-xs text-red-400">Must be exactly 32 hex characters.</p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={disabled || saving || !isValidHex || (addingNew && newIdx === '')}
                className="flex-1 px-3 py-1.5 bg-readable-green hover:bg-readable-green/90 disabled:bg-gray-600 disabled:text-muted text-white text-xs font-medium rounded transition-colors"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setEditingIdx(null);
                  setAddingNew(false);
                }}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {!showForm && (
          <button
            onClick={openAdd}
            disabled={disabled}
            className="w-full px-3 py-1.5 border border-dashed border-gray-600 hover:border-gray-400 text-xs text-muted hover:text-gray-300 rounded transition-colors disabled:opacity-50"
          >
            + Add Channel
          </button>
        )}

        <p className="text-xs text-muted">
          Keys are 128-bit (16 bytes), shown as 32 hex characters.
        </p>
      </div>
    </details>
  );
}
