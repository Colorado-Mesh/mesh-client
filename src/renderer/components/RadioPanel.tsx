/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { writeClipboardText } from '@/renderer/lib/writeClipboardText';
import {
  generateConfigUrl,
  type MeshtasticLoraConfig,
  MeshtasticUrlError,
  parseConfigUrl,
  type ParsedChannelSet,
  pskFingerprint,
} from '@/shared/meshtasticUrlEncoder';

import {
  type MeshCoreContactRaw,
  type MeshCoreSelfInfo,
  serializeErrorLike,
} from '../hooks/useMeshCore';
import type { OurPosition } from '../lib/gpsSource';
import type { MeshcoreAutoaddWireState } from '../lib/meshcoreContactAutoAdd';
import {
  MESHCORE_CHANNEL_INDEX_MAX,
  MESHCORE_CONTACTS_CRITICAL_THRESHOLD,
  MESHCORE_MAX_CONTACTS,
  meshcoreDeriveChannelKeyHexFromName,
  meshcoreSelfInfoBwToDisplayKhz,
  meshcoreSelfInfoFreqToDisplayHz,
} from '../lib/meshcoreUtils';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import { HelpTooltip } from './HelpTooltip';
import MeshcoreContactSettingsSection from './MeshcoreContactSettingsSection';
import MeshcoreTelemetryPrivacySection from './MeshcoreTelemetryPrivacySection';
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
  deviceFixedPosition?: boolean | null;
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
  meshcoreSelfInfo?: MeshCoreSelfInfo | null;
  meshcoreContactsForTelemetry?: MeshCoreContactRaw[];
  onApplyMeshcoreTelemetryPrivacy?: (modes: {
    telemetryModeBase: number;
    telemetryModeLoc: number;
    telemetryModeEnv: number;
  }) => Promise<void>;
  meshcoreAutoadd?: MeshcoreAutoaddWireState | null;
  meshtasticLoraConfig?: MeshtasticLoraConfig | null;
  onApplyChannelSet?: (
    parsed: ParsedChannelSet,
    options?: { applyLora?: boolean },
  ) => Promise<void>;
  onApplyMeshcoreContactAutoAdd?: (params: {
    autoAddAll: boolean;
    overwriteOldest: boolean;
    chat: boolean;
    repeater: boolean;
    roomServer: boolean;
    sensor: boolean;
    maxHopsWire: number;
  }) => Promise<void>;
  onRefreshMeshcoreAutoaddFromDevice?: () => Promise<void>;
  meshcoreContactsShowPublicKeys?: boolean;
  onMeshcoreContactsShowPublicKeysChange?: (value: boolean) => void;
  meshcoreContactsShowRefreshControl?: boolean;
  onMeshcoreContactsShowRefreshControlChange?: (value: boolean) => void;
  onClearAllMeshcoreContacts?: () => Promise<void>;
  onSendAdvert?: () => Promise<void>;
  onSyncClock?: () => Promise<void>;
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

/** Contact count badge with offload button for MeshCore */
function ContactCountBadge() {
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const count = await window.electronAPI.db.getMeshcoreContactCount();
        if (!cancelled) setContactCount(count);
      } catch {
        // catch-no-log-ok handle gracefully - show as unknown
        if (!cancelled) setContactCount(null);
      }
    };
    void fetch();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOffload = async () => {
    setLoading(true);
    try {
      const count = await window.electronAPI.db.offloadAllMeshcoreContacts();
      setContactCount((prev) => (prev !== null ? 0 : prev));
      addToast(t('radioPanel.offloadedContacts', { count }), 'success');
    } catch (e) {
      console.warn('[RadioPanel] offloadAllMeshcoreContacts error ' + errLikeToLogString(e));
      addToast(t('radioPanel.failedOffloadContacts'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const isNearCapacity =
    contactCount !== null && contactCount >= MESHCORE_CONTACTS_CRITICAL_THRESHOLD;

  return (
    <div className="flex items-center gap-2">
      <span
        className={`font-mono text-xs ${isNearCapacity ? 'text-red-400' : 'text-gray-400'}`}
        title={t('radioPanel.contactsOnRadioBadgeTitle', {
          part: `${contactCount ?? '?'} / ${MESHCORE_MAX_CONTACTS}`,
        })}
      >
        {contactCount ?? '?'}/{MESHCORE_MAX_CONTACTS}
      </span>
      {contactCount !== null && contactCount > 0 && (
        <button
          type="button"
          onClick={handleOffload}
          disabled={loading}
          className="rounded border border-yellow-700 bg-yellow-900/30 px-2 py-0.5 text-xs font-medium text-yellow-300 transition-colors hover:bg-yellow-800/50 disabled:opacity-40"
          title={t('radioPanel.removeAllContactsTitle')}
        >
          {loading ? '...' : t('radioPanel.offloadContacts')}
        </button>
      )}
    </div>
  );
}

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
        <label className="text-muted text-sm">{label}</label>
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
        className="bg-secondary-dark focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {description && <p className="text-muted text-xs">{description}</p>}
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
        <label className="text-muted text-sm">{label}</label>
        <button
          onClick={() => {
            onChange(!checked);
          }}
          disabled={disabled}
          className={`relative h-5 w-10 rounded-full transition-colors disabled:opacity-50 ${
            checked ? 'bg-brand-green' : 'bg-gray-600'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      {description && <p className="text-muted text-xs">{description}</p>}
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
        <label className="text-muted text-sm">{label}</label>
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
          className="bg-secondary-dark focus:border-brand-green w-28 rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
        />
        {unit && <span className="text-muted text-sm">{unit}</span>}
      </div>
      {description && <p className="text-muted text-xs">{description}</p>}
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
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>{title}</span>
        <svg
          className="text-muted h-4 w-4 transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="space-y-4 px-4 pb-4">
        {children}
        {onApply && (
          <button
            onClick={onApply}
            disabled={disabled || applying}
            className="bg-readable-green hover:bg-readable-green/90 disabled:text-muted w-full rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:bg-gray-600"
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
    console.debug('[RadioPanel] base64ToPsk invalid ' + errLikeToLogString(e));
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
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="bg-deep-black relative mx-4 w-full max-w-sm space-y-4 rounded-xl border border-gray-600 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-200">{title}</h3>
        <p className="text-muted text-sm leading-relaxed">{message}</p>
        <div className="flex gap-3 pt-2">
          <button
            onClick={onCancel}
            className="bg-secondary-dark flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-colors ${
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
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const wifiPwdId = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={wifiPwdId} className="text-muted text-sm">
        {t('radioPanel.wifiPasswordLabel')}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={wifiPwdId}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          disabled={disabled}
          placeholder={t('radioPanel.wifiPasswordPlaceholder')}
          maxLength={64}
          className="bg-secondary-dark focus:border-brand-green flex-1 rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => {
            setShow((s) => !s);
          }}
          disabled={disabled}
          aria-label={show ? t('common.hide') : t('common.show')}
          className="text-muted px-2 py-2 text-xs hover:text-gray-300 disabled:opacity-50"
        >
          {show ? t('common.hide') : t('common.show')}
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
  deviceFixedPosition,
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
  meshtasticLoraConfig,
  onApplyChannelSet,
  meshcoreSelfInfo,
  meshcoreContactsForTelemetry,
  onApplyMeshcoreTelemetryPrivacy,
  meshcoreAutoadd,
  onApplyMeshcoreContactAutoAdd,
  onRefreshMeshcoreAutoaddFromDevice,
  meshcoreContactsShowPublicKeys = false,
  onMeshcoreContactsShowPublicKeysChange,
  meshcoreContactsShowRefreshControl = false,
  onMeshcoreContactsShowRefreshControlChange,
  onClearAllMeshcoreContacts,
  onSendAdvert,
  onSyncClock,
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
  // MeshCore: selfInfo freq/BW units vary by firmware — normalize in meshcoreUtils.
  const [radioFreqHz, setRadioFreqHz] = useState(() =>
    loraConfig?.freq != null ? meshcoreSelfInfoFreqToDisplayHz(loraConfig.freq) : 915000000,
  );

  // Sync LoRa state from loraConfig prop (MeshCore device info)
  useEffect(() => {
    if (!loraConfig) return;
    if (loraConfig.freq != null) setRadioFreqHz(meshcoreSelfInfoFreqToDisplayHz(loraConfig.freq));
    if (loraConfig.bw != null) setBandwidth(meshcoreSelfInfoBwToDisplayKhz(loraConfig.bw));
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
  const [altStr, setAltStr] = useState(() => {
    const a = ourPosition?.altitudeMeters;
    return a != null && Number.isFinite(a) ? String(a) : '0';
  });
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

  useEffect(() => {
    if (typeof deviceFixedPosition === 'boolean') {
      setFixedPosition(deviceFixedPosition);
    }
  }, [deviceFixedPosition]);

  useEffect(() => {
    const a = ourPosition?.altitudeMeters;
    if (a == null || !Number.isFinite(a)) return;
    setAltStr(String(a));
  }, [ourPosition?.altitudeMeters]);

  // ─── Shared state ─────────────────────────────────────────────
  const [status, setStatus] = useState<string | null>(null);
  const [applyingSection, setApplyingSection] = useState<string | null>(null);

  // ─── Device command confirmation ──────────────────────────────
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const { addToast } = useToast();
  const { t } = useTranslation();
  const deviceRoleOptions = useMemo(
    () =>
      DEVICE_ROLES.map((r) => ({
        value: r.value,
        label: t(`radioPanel.deviceRoles.${r.value}.label`),
        description: t(`radioPanel.deviceRoles.${r.value}.description`),
      })),
    [t],
  );
  const displayUnitOptions = useMemo(
    () =>
      DISPLAY_UNITS.map((u) => ({
        value: u.value,
        label: t(`radioPanel.displayUnits.${u.value}.label`),
      })),
    [t],
  );
  const [applyingMeshcoreTelemetryPrivacy, setApplyingMeshcoreTelemetryPrivacy] = useState(false);
  const [applyingMeshcoreContactMgmt, setApplyingMeshcoreContactMgmt] = useState(false);
  const [advertLoading, setAdvertLoading] = useState(false);
  const [syncClockLoading, setSyncClockLoading] = useState(false);

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
      const commitPromise = onCommit();
      void commitPromise
        .then(() => {})
        .catch((err: unknown) => {
          setStatus(
            `${section} sent, but commit failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        });
      setStatus(`${section} applied successfully. Device may briefly reboot.`);
    } catch (err) {
      console.warn('[RadioPanel] apply section failed ' + errLikeToLogString(err));
      setStatus(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setApplyingSection(null);
    }
  };

  const executeWithConfirmation = useCallback((action: PendingAction) => {
    setPendingAction(action);
  }, []);

  const handleSendAdvert = async () => {
    if (!onSendAdvert) return;
    setAdvertLoading(true);
    try {
      await onSendAdvert();
      addToast(t('radioPanel.floodAdvertSent'), 'success');
    } catch (e) {
      console.warn('[RadioPanel] sendAdvert failed:', e instanceof Error ? e.message : e);
      addToast(
        t('radioPanel.advertFailed', { message: e instanceof Error ? e.message : String(e) }),
        'error',
      );
    } finally {
      setAdvertLoading(false);
    }
  };

  const handleSyncClock = async () => {
    if (!onSyncClock) return;
    setSyncClockLoading(true);
    try {
      await onSyncClock();
      addToast(t('radioPanel.clockSynced'), 'success');
    } catch (e) {
      console.warn('[RadioPanel] syncClock failed:', e instanceof Error ? e.message : e);
      addToast(
        t('radioPanel.syncFailed', { message: e instanceof Error ? e.message : String(e) }),
        'error',
      );
    } finally {
      setSyncClockLoading(false);
    }
  };

  const handleConfirm = useCallback(async () => {
    if (!pendingAction) return;
    setPendingAction(null);
    try {
      await pendingAction.action();
      addToast(t('radioPanel.actionCompleted', { name: pendingAction.name }), 'success');
    } catch (err) {
      console.warn('[RadioPanel] pending action failed ' + errLikeToLogString(err));
      addToast(
        t('radioPanel.actionFailed', {
          message: err instanceof Error ? err.message : 'Unknown error',
        }),
        'error',
      );
    }
  }, [pendingAction, addToast, t]);

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
              console.error('[RadioPanel] onSetOwner threw: ' + errLikeToLogString(e));
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
              console.error('[RadioPanel] onApplyLoraParams threw: ' + errLikeToLogString(e));
              notSupported.push('radio settings');
            }
          }

          if (notSupported.length > 0) {
            addToast(
              applied.length > 0
                ? t('radioPanel.configImportedPartialApplied', {
                    applied: applied.join(', '),
                    notSupported: notSupported.join(', '),
                  })
                : t('radioPanel.configImportedPartialNoApplied', {
                    notSupported: notSupported.join(', '),
                  }),
              'warning',
            );
          } else if (applied.length > 0) {
            addToast(t('radioPanel.configImported'), 'success');
          } else {
            addToast(t('radioPanel.configImportedNoChanges'), 'success');
          }
        } catch (err) {
          console.error('[RadioPanel] config import error: ' + errLikeToLogString(err));
          addToast(
            t('radioPanel.configParseFailed', {
              message: err instanceof Error ? err.message : 'Invalid JSON',
            }),
            'error',
          );
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [addToast, onSetOwner, onApplyLoraParams, shortName, isLicensed, bandwidth, radioFreqHz, t]);

  return (
    <div className="w-full space-y-4">
      <h2 className="text-xl font-semibold text-gray-200">{t('radioPanel.title')}</h2>

      {capabilities?.protocol === 'meshcore' && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleImportConfig}
            className="bg-secondary-dark rounded-lg border border-gray-600 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-700"
          >
            {t('radioPanel.importConfigJson')}
          </button>
        </div>
      )}

      {!isConnected && (
        <div className="rounded-lg border border-yellow-700 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-300">
          {t('radioPanel.connectToConfigure')}
        </div>
      )}

      {/* ═══ Bluetooth ═══ */}
      {capabilities?.hasBluetoothConfig !== false && (
        <ConfigSection
          title={t('radioPanel.sectionBluetooth')}
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
            label={t('radioPanel.bluetoothEnabled')}
            checked={btEnabled}
            onChange={setBtEnabled}
            disabled={disabled || applyingSection !== null}
            description={t('radioPanel.bluetoothToggleDesc')}
          />
          <ConfigNumber
            label={t('radioPanel.pairingPin')}
            value={btFixedPin}
            onChange={setBtFixedPin}
            disabled={disabled || applyingSection !== null || !btEnabled}
            min={100000}
            max={999999}
            description={t('radioPanel.pairingPinDesc')}
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
          meshtasticLoraConfig={meshtasticLoraConfig}
          onApplyChannelSet={onApplyChannelSet}
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

      {capabilities?.hasCompanionContactManagementConfig &&
        meshcoreSelfInfo &&
        onApplyMeshcoreContactAutoAdd &&
        onMeshcoreContactsShowPublicKeysChange &&
        onMeshcoreContactsShowRefreshControlChange && (
          <MeshcoreContactSettingsSection
            selfInfo={meshcoreSelfInfo}
            autoadd={meshcoreAutoadd ?? null}
            disabled={disabled}
            applying={applyingMeshcoreContactMgmt}
            meshcoreContactsShowPublicKeys={meshcoreContactsShowPublicKeys}
            onMeshcoreContactsShowPublicKeysChange={onMeshcoreContactsShowPublicKeysChange}
            meshcoreContactsShowRefreshControl={meshcoreContactsShowRefreshControl}
            onMeshcoreContactsShowRefreshControlChange={onMeshcoreContactsShowRefreshControlChange}
            onApply={async (params) => {
              setApplyingMeshcoreContactMgmt(true);
              try {
                await onApplyMeshcoreContactAutoAdd(params);
                if (onRefreshMeshcoreAutoaddFromDevice) {
                  await onRefreshMeshcoreAutoaddFromDevice();
                }
                addToast(t('radioPanel.contactManagementUpdated'), 'success');
              } catch (e) {
                console.warn(
                  '[RadioPanel] meshcore contact management apply failed ' + errLikeToLogString(e),
                );
                addToast(
                  e instanceof Error ? e.message : t('radioPanel.contactMgmtFailed'),
                  'error',
                );
              } finally {
                setApplyingMeshcoreContactMgmt(false);
              }
            }}
            onClearAllContacts={onClearAllMeshcoreContacts}
          />
        )}

      {/* ═══ Device Role ═══ */}
      {capabilities?.hasDeviceRoleConfig !== false && (
        <ConfigSection
          title={t('radioPanel.sectionDeviceRole')}
          onApply={() => applyConfig('Device', 'device', { role: deviceRole })}
          applying={applyingSection === 'Device'}
          disabled={disabled}
        >
          <ConfigSelect
            label={t('radioPanel.roleFieldLabel')}
            value={deviceRole}
            options={deviceRoleOptions}
            onChange={setDeviceRole}
            disabled={disabled || applyingSection !== null}
            description={deviceRoleOptions.find((r) => r.value === deviceRole)?.description}
          />
        </ConfigSection>
      )}

      {/* ═══ Device User / Identity ═══ */}
      <ConfigSection
        title={t('radioPanel.sectionDeviceUser')}
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
          <label htmlFor="radio-long-name" className="text-muted text-sm">
            {capabilities?.protocol === 'meshcore'
              ? t('radioPanel.meshcoreNameFieldLabel')
              : t('radioPanel.longNameFieldLabel')}
          </label>
          <input
            id="radio-long-name"
            type="text"
            value={longName}
            onChange={(e) => {
              setLongName(
                capabilities?.protocol === 'meshcore'
                  ? e.target.value
                  : e.target.value.slice(0, 39),
              );
            }}
            maxLength={capabilities?.protocol === 'meshcore' ? undefined : 39}
            disabled={disabled}
            placeholder={t('radioPanel.yourNamePlaceholder')}
            className="bg-secondary-dark focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
          />
          <p className="text-muted text-xs">
            {capabilities?.protocol === 'meshcore'
              ? t('radioPanel.longNameHintMeshcore')
              : t('radioPanel.longNameHintMeshtastic')}
          </p>
        </div>
        {capabilities?.protocol !== 'meshcore' && (
          <>
            <div className="space-y-1">
              <label htmlFor="radio-short-name" className="text-muted text-sm">
                {t('radioPanel.shortNameFieldLabel')}
              </label>
              <input
                id="radio-short-name"
                type="text"
                value={shortName}
                onChange={(e) => {
                  setShortName(e.target.value.slice(0, 4));
                }}
                maxLength={4}
                disabled={disabled}
                placeholder={t('radioPanel.namePlaceholder')}
                className="bg-secondary-dark focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
              />
              <p className="text-muted text-xs">{t('radioPanel.shortNameHint')}</p>
            </div>
            <ConfigToggle
              label={t('radioPanel.licensedHamLabel')}
              checked={isLicensed}
              onChange={setIsLicensed}
              disabled={disabled}
              description={t('radioPanel.licensedHamDescription')}
            />
          </>
        )}
      </ConfigSection>

      {/* ═══ Display ═══ */}
      {capabilities?.hasDisplayConfig !== false && (
        <ConfigSection
          title={t('radioPanel.sectionDisplay')}
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
            label={t('radioPanel.screenOnDurationLabel')}
            value={screenOnSecs}
            onChange={setScreenOnSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            max={3600}
            unit={t('radioPanel.secondsUnit')}
            description={t('radioPanel.screenOnDurationDesc')}
          />
          <ConfigSelect
            label={t('radioPanel.displayUnitsFieldLabel')}
            value={displayUnits}
            options={displayUnitOptions}
            onChange={setDisplayUnits}
            disabled={disabled || applyingSection !== null}
          />
        </ConfigSection>
      )}

      {/* ═══ LoRa / Radio ═══ */}
      {onApplyLoraParams ? (
        /* MeshCore path: direct radio params (freq, bw, sf, cr, txPower) */
        <ConfigSection
          title={t('radioPanel.sectionLora')}
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
            <label htmlFor="radio-freq-mhz" className="text-muted text-sm">
              {t('radioPanel.frequencyMhzLabel')}
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
              className="bg-secondary-dark focus:border-brand-green w-36 rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
            />
            <p className="text-muted text-xs">{t('radioPanel.frequencyHint')}</p>
          </div>
          <div className="space-y-4 border-l border-gray-700 pl-3">
            <ConfigSelect
              label={t('radioPanel.bandwidthLabel')}
              value={bandwidth}
              options={[
                { value: 31.25, label: '31.25 kHz' },
                { value: 62.5, label: '62.5 kHz' },
                { value: 125, label: '125 kHz' },
                { value: 250, label: '250 kHz' },
                { value: 500, label: '500 kHz' },
              ]}
              onChange={setBandwidth}
              disabled={disabled || applyingSection !== null}
              tooltip={t('radioPanel.bandwidthTooltip')}
            />
            <ConfigSelect
              label={t('radioPanel.spreadFactorLabel')}
              value={spreadFactor}
              options={Array.from({ length: 6 }, (_, i) => ({
                value: i + 7,
                label: `SF${i + 7}`,
              }))}
              onChange={setSpreadFactor}
              disabled={disabled || applyingSection !== null}
              description={t('radioPanel.spreadFactorDesc')}
            />
            <ConfigSelect
              label={t('radioPanel.codingRateLabel')}
              value={codingRate}
              options={[
                { value: 5, label: '4/5' },
                { value: 6, label: '4/6' },
                { value: 7, label: '4/7' },
                { value: 8, label: '4/8' },
              ]}
              onChange={setCodingRate}
              disabled={disabled || applyingSection !== null}
              tooltip={t('radioPanel.codingRateTooltip')}
            />
            <ConfigNumber
              label={t('radioPanel.txPowerLabel')}
              value={txPower}
              onChange={setTxPower}
              disabled={disabled || applyingSection !== null}
              min={1}
              max={30}
              unit="dBm"
              description={t('radioPanel.txPowerDesc')}
              tooltip={t('radioPanel.txPowerTooltip')}
            />
          </div>
        </ConfigSection>
      ) : (
        /* Meshtastic path: region, presets, hop limit */
        <ConfigSection
          title={t('radioPanel.sectionLora')}
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
            label={t('radioPanel.regionLabel')}
            value={region}
            options={REGIONS}
            onChange={setRegion}
            disabled={disabled || applyingSection !== null}
          />
          <ConfigToggle
            label={t('radioPanel.useModemPresetLabel')}
            checked={usePreset}
            onChange={setUsePreset}
            disabled={disabled || applyingSection !== null}
            description={t('radioPanel.useModemPresetDesc')}
          />
          {usePreset ? (
            <ConfigSelect
              label={t('radioPanel.modemPresetLabel')}
              value={modemPreset}
              options={MODEM_PRESETS}
              onChange={setModemPreset}
              disabled={disabled || applyingSection !== null}
            />
          ) : (
            <div className="space-y-4 border-l border-gray-700 pl-3">
              <ConfigSelect
                label={t('radioPanel.bandwidthLabel')}
                value={bandwidth}
                options={[
                  { value: 31.25, label: '31.25 kHz' },
                  { value: 62.5, label: '62.5 kHz' },
                  { value: 125, label: '125 kHz' },
                  { value: 250, label: '250 kHz' },
                  { value: 500, label: '500 kHz' },
                ]}
                onChange={setBandwidth}
                disabled={disabled || applyingSection !== null}
                tooltip={t('radioPanel.bandwidthTooltip')}
              />
              <ConfigSelect
                label={t('radioPanel.spreadFactorLabel')}
                value={spreadFactor}
                options={Array.from({ length: 6 }, (_, i) => ({
                  value: i + 7,
                  label: `SF${i + 7}`,
                }))}
                onChange={setSpreadFactor}
                disabled={disabled || applyingSection !== null}
                description={t('radioPanel.spreadFactorDesc')}
              />
              <ConfigSelect
                label={t('radioPanel.codingRateLabel')}
                value={codingRate}
                options={[
                  { value: 5, label: '4/5' },
                  { value: 6, label: '4/6' },
                  { value: 7, label: '4/7' },
                  { value: 8, label: '4/8' },
                ]}
                onChange={setCodingRate}
                disabled={disabled || applyingSection !== null}
                tooltip={t('radioPanel.codingRateTooltip')}
              />
              <ConfigNumber
                label={t('radioPanel.txPowerLabel')}
                value={txPower}
                onChange={setTxPower}
                disabled={disabled || applyingSection !== null}
                min={1}
                max={30}
                unit="dBm"
                description={t('radioPanel.txPowerDesc')}
                tooltip={t('radioPanel.txPowerTooltip')}
              />
              <ConfigToggle
                label={t('radioPanel.sx126xRxBoostedLabel')}
                checked={rxBoostedGain}
                onChange={setRxBoostedGain}
                disabled={disabled || applyingSection !== null}
                description={t('radioPanel.sx126xRxBoostedDesc')}
              />
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="radio-hop-limit" className="text-muted text-sm">
              {t('radioPanel.hopLimitLabel')}
            </label>
            <div className="flex items-center gap-3">
              <input
                id="radio-hop-limit"
                type="range"
                min={1}
                max={7}
                value={hopLimit}
                onChange={(e) => {
                  setHopLimit(Number(e.target.value));
                }}
                disabled={disabled || applyingSection !== null}
                className="flex-1 accent-green-500 disabled:opacity-50"
              />
              <span className="w-6 text-center font-mono text-lg text-gray-200">{hopLimit}</span>
            </div>
            <p className="text-muted text-xs">{t('radioPanel.hopLimitDescription')}</p>
          </div>
        </ConfigSection>
      )}

      {/* ═══ Position / GPS ═══ */}
      <ConfigSection
        title={t('radioPanel.sectionPositionGps')}
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
              label={t('radioPanel.positionBroadcastIntervalLabel')}
              value={positionBroadcastSecs}
              onChange={setPositionBroadcastSecs}
              disabled={disabled || applyingSection !== null}
              min={0}
              max={86400}
              unit={t('radioPanel.secondsUnit')}
              description={t('radioPanel.positionBroadcastIntervalDesc')}
            />
            <ConfigNumber
              label={t('radioPanel.gpsUpdateIntervalLabel')}
              value={gpsUpdateInterval}
              onChange={setGpsUpdateInterval}
              disabled={disabled || applyingSection !== null}
              min={0}
              max={86400}
              unit={t('radioPanel.secondsUnit')}
              description={t('radioPanel.gpsUpdateIntervalDesc')}
            />
            <ConfigSelect
              label={t('radioPanel.gpsModeLabel')}
              value={gpsMode}
              options={[
                { value: 0, label: t('radioPanel.gpsModeDisabled') },
                { value: 1, label: t('radioPanel.gpsModeEnabled') },
                { value: 2, label: t('radioPanel.gpsModeNotPresent') },
              ]}
              onChange={setGpsMode}
              disabled={disabled || applyingSection !== null}
              description={t('radioPanel.gpsModeDesc')}
            />
            <ConfigNumber
              label={t('radioPanel.positionPrecisionLabel')}
              value={positionPrecision}
              onChange={setPositionPrecision}
              disabled={disabled || applyingSection !== null}
              min={1}
              max={19}
              description={t('radioPanel.positionPrecisionDesc')}
            />
            <ConfigToggle
              label={t('radioPanel.smartPositionBroadcastLabel')}
              checked={smartPositionEnabled}
              onChange={setSmartPositionEnabled}
              disabled={disabled || applyingSection !== null}
              description={t('radioPanel.smartPositionBroadcastDesc')}
            />
            {smartPositionEnabled && (
              <div className="space-y-4 border-l border-gray-700 pl-3">
                <ConfigNumber
                  label={t('radioPanel.minDistanceTriggerLabel')}
                  value={smartPositionMinDistance}
                  onChange={setSmartPositionMinDistance}
                  disabled={disabled || applyingSection !== null}
                  min={0}
                  unit={t('radioPanel.metersUnit')}
                />
                <ConfigNumber
                  label={t('radioPanel.minIntervalLabel')}
                  value={smartPositionMinInterval}
                  onChange={setSmartPositionMinInterval}
                  disabled={disabled || applyingSection !== null}
                  min={0}
                  unit={t('radioPanel.secondsUnit')}
                />
              </div>
            )}
            <ConfigToggle
              label={t('radioPanel.fixedPositionLabel')}
              checked={fixedPosition}
              onChange={setFixedPosition}
              disabled={disabled || applyingSection !== null}
              description={t('radioPanel.fixedPositionDesc')}
            />
          </>
        )}
        {/* For Meshtastic: lat/lon shown when fixedPosition toggle is on */}
        {/* For MeshCore: lat/lon always shown (fixed position is the only option) */}
        {(fixedPosition || capabilities?.hasFullPositionConfig === false) && (
          <div className="space-y-3 border-t border-gray-700 pt-2">
            <p className="text-muted text-xs">
              {t('radioPanel.setCoordinatesHint')}
              {ourPosition && (
                <button
                  type="button"
                  onClick={() => {
                    setLatStr(String(ourPosition.lat));
                    setLonStr(String(ourPosition.lon));
                    const a = ourPosition.altitudeMeters;
                    if (a != null && Number.isFinite(a)) {
                      setAltStr(String(a));
                    }
                  }}
                  className="text-brand-green ml-2 underline hover:opacity-80"
                >
                  {t('radioPanel.useCurrentGps')}
                </button>
              )}
            </p>
            <div className="space-y-1">
              <label htmlFor="radio-fixed-lat" className="text-muted text-sm">
                {t('radioPanel.latitudeLabel')}
              </label>
              <input
                id="radio-fixed-lat"
                type="text"
                inputMode="decimal"
                value={latStr}
                onChange={(e) => {
                  setLatStr(e.target.value);
                }}
                disabled={disabled || applyingSection !== null}
                placeholder="0.000000"
                className="bg-secondary-dark focus:border-brand-green w-36 rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="radio-fixed-lon" className="text-muted text-sm">
                {t('radioPanel.longitudeLabel')}
              </label>
              <input
                id="radio-fixed-lon"
                type="text"
                inputMode="decimal"
                value={lonStr}
                onChange={(e) => {
                  setLonStr(e.target.value);
                }}
                disabled={disabled || applyingSection !== null}
                placeholder="0.000000"
                className="bg-secondary-dark focus:border-brand-green w-36 rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="radio-fixed-alt" className="text-muted text-sm">
                {t('radioPanel.altitudeMetersLabel')}
              </label>
              <input
                id="radio-fixed-alt"
                type="text"
                inputMode="decimal"
                value={altStr}
                onChange={(e) => {
                  setAltStr(e.target.value);
                }}
                disabled={disabled || applyingSection !== null}
                placeholder="0"
                className="bg-secondary-dark focus:border-brand-green w-36 rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
              />
            </div>
            <button
              onClick={async () => {
                if (!onSendPositionToDevice) return;
                const lat = parseFloat(latStr);
                const lon = parseFloat(lonStr);
                const alt = parseFloat(altStr);
                if (!isFinite(lat) || !isFinite(lon)) {
                  addToast(t('radioPanel.invalidCoordinates'), 'error');
                  return;
                }
                try {
                  await onSendPositionToDevice(lat, lon, isFinite(alt) ? alt : 0);
                  addToast(t('radioPanel.positionSent'), 'success');
                } catch (err) {
                  console.warn(
                    '[RadioPanel] send position to device failed ' + errLikeToLogString(err),
                  );
                  addToast(
                    capabilities?.protocol === 'meshcore'
                      ? t('radioPanel.meshcoreGpsFailed', {
                          message: err instanceof Error ? err.message : 'unknown',
                        })
                      : t('radioPanel.actionFailed', {
                          message: err instanceof Error ? err.message : 'Unknown error',
                        }),
                    'error',
                  );
                }
              }}
              disabled={disabled || !onSendPositionToDevice}
              className="bg-readable-green hover:bg-readable-green/90 disabled:text-muted w-full rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:bg-gray-600"
            >
              {t('radioPanel.sendPositionToDevice')}
            </button>
          </div>
        )}
      </ConfigSection>

      {/* ═══ Power ═══ */}
      {capabilities?.hasPowerConfig !== false && (
        <ConfigSection
          title={t('radioPanel.sectionPower')}
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
            label={t('radioPanel.powerSavingModeLabel')}
            checked={isPowerSaving}
            onChange={setIsPowerSaving}
            disabled={disabled || applyingSection !== null}
            description={t('radioPanel.powerSavingModeDesc')}
          />
          <ConfigNumber
            label={t('radioPanel.minWakeDurationLabel')}
            value={minWakeSecs}
            onChange={setMinWakeSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            unit={t('radioPanel.secondsUnit')}
            description={t('radioPanel.minWakeDurationDesc')}
          />
          <ConfigNumber
            label={t('radioPanel.bluetoothIdleTimeoutLabel')}
            value={waitBluetoothSecs}
            onChange={setWaitBluetoothSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            unit={t('radioPanel.secondsUnit')}
            description={t('radioPanel.bluetoothIdleTimeoutDesc')}
          />
          <ConfigNumber
            label={t('radioPanel.superDeepSleepLabel')}
            value={sdsSecs}
            onChange={setSdsSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            unit={t('radioPanel.secondsUnit')}
            description={t('radioPanel.superDeepSleepDesc')}
          />
          <ConfigNumber
            label={t('radioPanel.lightSleepDurationLabel')}
            value={lsSecs}
            onChange={setLsSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            unit={t('radioPanel.secondsUnit')}
            description={t('radioPanel.lightSleepDurationDesc')}
          />
          <ConfigNumber
            label={t('radioPanel.batteryShutdownLabel')}
            value={onBatteryShutdownAfterSecs}
            onChange={setOnBatteryShutdownAfterSecs}
            disabled={disabled || applyingSection !== null}
            min={0}
            unit={t('radioPanel.secondsUnit')}
            description={t('radioPanel.batteryShutdownDesc')}
          />
        </ConfigSection>
      )}

      {/* ═══ Telemetry ═══ */}
      {capabilities?.hasTelemetryIntervalConfig !== false && (
        <ConfigSection
          title={t('radioPanel.sectionTelemetry')}
          onApply={() =>
            applyConfig('Telemetry', 'telemetry', {
              device_update_interval: deviceUpdateInterval,
            })
          }
          applying={applyingSection === 'Telemetry'}
          disabled={disabled}
        >
          <ConfigNumber
            label={t('radioPanel.deviceMetricsIntervalLabel')}
            value={deviceUpdateInterval}
            onChange={setDeviceUpdateInterval}
            disabled={disabled || applyingSection !== null}
            min={0}
            max={86400}
            unit="seconds"
            description={t('radioPanel.deviceMetricsDescription')}
            tooltip={t('radioPanel.deviceMetricsTooltip')}
          />
        </ConfigSection>
      )}

      {capabilities?.hasCompanionTelemetryPrivacyConfig &&
        meshcoreSelfInfo &&
        meshcoreContactsForTelemetry &&
        onApplyMeshcoreTelemetryPrivacy && (
          <MeshcoreTelemetryPrivacySection
            selfInfo={meshcoreSelfInfo}
            contacts={meshcoreContactsForTelemetry}
            disabled={disabled}
            applying={applyingMeshcoreTelemetryPrivacy}
            onApply={async (modes) => {
              setApplyingMeshcoreTelemetryPrivacy(true);
              try {
                await onApplyMeshcoreTelemetryPrivacy(modes);
                addToast(t('radioPanel.telemetryPrivacyUpdated'), 'success');
              } catch (e) {
                console.warn(
                  '[RadioPanel] meshcore telemetry privacy apply failed ' + errLikeToLogString(e),
                );
                addToast(
                  e instanceof Error ? e.message : t('radioPanel.telemetryPrivacyFailed'),
                  'error',
                );
              } finally {
                setApplyingMeshcoreTelemetryPrivacy(false);
              }
            }}
          />
        )}

      {/* ═══ WiFi / Network ═══ */}
      {capabilities?.hasWifiConfig !== false && (
        <ConfigSection
          title={t('radioPanel.sectionWifi')}
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
            label={t('radioPanel.wifiEnabledLabel')}
            checked={wifiEnabled}
            onChange={setWifiEnabled}
            disabled={disabled || applyingSection !== null}
            description={t('radioPanel.wifiEnabledDesc')}
          />
          <div className="space-y-1">
            <label htmlFor="radio-wifi-ssid" className="text-muted text-sm">
              {t('radioPanel.wifiSsidLabel')}
            </label>
            <input
              id="radio-wifi-ssid"
              type="text"
              value={wifiSsid}
              onChange={(e) => {
                setWifiSsid(e.target.value);
              }}
              disabled={disabled || !wifiEnabled || applyingSection !== null}
              placeholder={t('radioPanel.networkNamePlaceholder')}
              maxLength={33}
              className="bg-secondary-dark focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
            />
          </div>
          <WifiPasswordField
            value={wifiPsk}
            onChange={setWifiPsk}
            disabled={disabled || !wifiEnabled || applyingSection !== null}
          />
          <div className="space-y-1">
            <label htmlFor="radio-ntp-server" className="text-muted text-sm">
              {t('radioPanel.ntpServerLabel')}
            </label>
            <input
              id="radio-ntp-server"
              type="text"
              value={ntpServer}
              onChange={(e) => {
                setNtpServer(e.target.value);
              }}
              disabled={disabled || applyingSection !== null}
              placeholder="0.pool.ntp.org"
              className="bg-secondary-dark focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
            />
            <p className="text-muted text-xs">{t('radioPanel.ntpHint')}</p>
          </div>
          <ConfigToggle
            label={t('radioPanel.ethernetEnabledLabel')}
            checked={ethEnabled}
            onChange={setEthEnabled}
            disabled={disabled || applyingSection !== null}
            description={t('radioPanel.ethernetEnabledDesc')}
          />
        </ConfigSection>
      )}

      {/* Status */}
      {status && (
        <div
          className={`rounded-lg px-4 py-2 text-sm ${
            status.includes('Failed')
              ? 'border border-red-700 bg-red-900/50 text-red-300'
              : status.includes('success')
                ? 'bg-brand-green/10 border-brand-green text-bright-green border'
                : 'bg-deep-black text-muted'
          }`}
        >
          {status}
        </div>
      )}

      {/* Info */}
      <div className="bg-deep-black text-muted space-y-1 rounded-lg p-4 text-sm">
        <p>{t('radioPanel.flashMemoryNote')}</p>
        <p>{t('radioPanel.restartWarning')}</p>
      </div>

      {/* Device Actions (MeshCore) — non-destructive commands */}
      {(onSendAdvert || onSyncClock || capabilities?.protocol === 'meshcore') && (
        <div className="space-y-3">
          <h3 className="text-muted text-sm font-medium">{t('radioPanel.deviceActions')}</h3>
          <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2">
            {onSendAdvert && (
              <button
                type="button"
                onClick={() => void handleSendAdvert()}
                disabled={!isConnected || advertLoading}
                className="bg-brand-green/20 text-brand-green border-brand-green/30 hover:bg-brand-green/30 rounded border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40"
              >
                {advertLoading ? (
                  <span className="border-brand-green inline-block h-3 w-3 animate-spin rounded-full border border-t-transparent" />
                ) : (
                  t('radioPanel.floodAdvertButton')
                )}
              </button>
            )}
            {onSyncClock && (
              <button
                type="button"
                onClick={() => void handleSyncClock()}
                disabled={!isConnected || syncClockLoading}
                className="rounded border border-blue-700 bg-blue-900/50 px-3 py-1 text-xs font-medium text-blue-300 transition-colors hover:bg-blue-800/60 disabled:opacity-40"
              >
                {syncClockLoading ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border border-blue-400 border-t-transparent" />
                ) : (
                  t('radioPanel.syncClockButton')
                )}
              </button>
            )}
            {capabilities?.protocol === 'meshcore' && <ContactCountBadge />}
          </div>
        </div>
      )}

      {/* Device Commands — keep at bottom of Radio panel, directly above Danger Zone; do not reorder */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-orange-400">{t('radioPanel.deviceCommands')}</h3>
        <div className="space-y-2 rounded-lg border border-orange-900 p-4">
          <p className="text-xs text-orange-400/80">
            {t('radioPanel.deviceCommandsImmediateWarning')}
          </p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <button
              type="button"
              onClick={() => {
                executeWithConfirmation({
                  name: t('radioPanel.enterDfuName'),
                  title: t('radioPanel.enterDfuTitle'),
                  message: t('radioPanel.enterDfuMessage'),
                  confirmLabel: t('radioPanel.enterDfuConfirm'),
                  action: () => onEnterDfu?.() ?? Promise.resolve(),
                });
              }}
              disabled={!isConnected || !onEnterDfu}
              className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
            >
              {t('radioPanel.enterDfuButton')}
            </button>

            <button
              type="button"
              onClick={() => {
                executeWithConfirmation({
                  name: t('radioPanel.rebootName'),
                  title: t('radioPanel.rebootTitle'),
                  message:
                    capabilities?.protocol === 'meshcore'
                      ? t('radioPanel.rebootMessageMeshcore')
                      : t('radioPanel.rebootMessageMeshtastic'),
                  confirmLabel: t('radioPanel.rebootConfirm'),
                  action: () => onReboot(2),
                });
              }}
              disabled={!isConnected}
              className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
            >
              {t('radioPanel.rebootButton')}
            </button>

            <button
              type="button"
              onClick={() => {
                executeWithConfirmation({
                  name: t('radioPanel.rebootOtaName'),
                  title: t('radioPanel.rebootOtaTitle'),
                  message: t('radioPanel.rebootOtaMessage'),
                  confirmLabel: t('radioPanel.rebootOtaConfirm'),
                  action: () => onRebootOta?.(10) ?? Promise.resolve(),
                });
              }}
              disabled={!isConnected || !onRebootOta}
              className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
            >
              {t('radioPanel.rebootOtaButton')}
            </button>

            {capabilities?.hasNodeDbReset !== false && (
              <button
                type="button"
                onClick={() => {
                  executeWithConfirmation({
                    name: t('radioPanel.resetNodeDbName'),
                    title: t('radioPanel.resetNodeDbTitle'),
                    message: t('radioPanel.resetNodeDbMessage'),
                    confirmLabel: t('radioPanel.resetNodeDbConfirm'),
                    action: () => onResetNodeDb(),
                  });
                }}
                disabled={!isConnected}
                className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
              >
                {t('radioPanel.resetNodeDbButton')}
              </button>
            )}

            {capabilities?.hasShutdown !== false && (
              <button
                type="button"
                onClick={() => {
                  executeWithConfirmation({
                    name: t('radioPanel.shutdownName'),
                    title: t('radioPanel.shutdownTitle'),
                    message: t('radioPanel.shutdownMessage'),
                    confirmLabel: t('radioPanel.shutdownConfirm'),
                    action: () => onShutdown(2),
                  });
                }}
                disabled={!isConnected}
                className="rounded-lg border border-orange-800/60 bg-orange-900/30 px-4 py-3 text-sm font-medium text-orange-200 transition-colors hover:bg-orange-900/50 disabled:opacity-50"
              >
                {t('radioPanel.shutdownButton')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Danger Zone — keep at bottom of Radio panel after Device Commands; do not reorder */}
      {capabilities?.hasFactoryReset !== false && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-red-400">{t('radioPanel.dangerZone')}</h3>
          <div className="space-y-2 rounded-lg border border-red-900 p-4">
            <p className="text-xs text-red-400/80">{t('radioPanel.dangerZonePermanent')}</p>
            <button
              type="button"
              onClick={() => {
                executeWithConfirmation({
                  name: t('radioPanel.factoryResetConfigName'),
                  title: t('radioPanel.factoryResetConfigTitle'),
                  message: t('radioPanel.factoryResetConfigMessage'),
                  confirmLabel: t('radioPanel.factoryResetConfigConfirm'),
                  danger: true,
                  action: () => onFactoryResetConfig?.() ?? Promise.resolve(),
                });
              }}
              disabled={!isConnected || !onFactoryResetConfig}
              className="w-full rounded-lg border border-red-800/60 bg-red-900/40 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/60 disabled:opacity-50"
            >
              {t('radioPanel.factoryResetConfigButton')}
            </button>
            <button
              type="button"
              onClick={() => {
                executeWithConfirmation({
                  name: t('radioPanel.factoryResetName'),
                  title: t('radioPanel.factoryResetTitle'),
                  message: t('radioPanel.factoryResetMessage'),
                  confirmLabel: t('radioPanel.factoryResetConfirm'),
                  danger: true,
                  action: () => onFactoryReset(),
                });
              }}
              disabled={!isConnected}
              className="w-full rounded-lg border border-red-800 bg-red-900/50 px-4 py-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-900/70 disabled:opacity-50"
            >
              {t('radioPanel.factoryResetButton')}
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
          onCancel={() => {
            setPendingAction(null);
          }}
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
  const { t } = useTranslation();
  if (level === 'encrypted') {
    return (
      <span
        title={t('radioPanel.aesEncryptedTooltip')}
        className="flex items-center text-green-400"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
      ? t('radioPanel.securityOpenLocationUplinkTooltip')
      : level === 'open-location'
        ? t('radioPanel.securityOpenLocationTooltip')
        : t('radioPanel.securityNoEncryptionTooltip');
  return (
    <span title={tooltip} className="flex items-center gap-0.5 text-yellow-500">
      <svg
        className={`h-3.5 w-3.5 ${level !== 'open' ? 'text-red-400' : ''}`}
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
          className="h-3.5 w-3.5 text-red-400"
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

// ─── Channel URL import / export (Meshtastic) ───────────────────
function ChannelUrlImportExport({
  channelConfigs,
  meshtasticLoraConfig,
  onApplyChannelSet,
  disabled,
  setStatus,
}: {
  channelConfigs: ChannelConfig[];
  meshtasticLoraConfig?: MeshtasticLoraConfig | null;
  onApplyChannelSet?: (
    parsed: ParsedChannelSet,
    options?: { applyLora?: boolean },
  ) => Promise<void>;
  disabled: boolean;
  setStatus: (s: string) => void;
}) {
  const { t } = useTranslation();
  const [includeSecondary, setIncludeSecondary] = useState(true);
  const [httpsUrl, setHttpsUrl] = useState('');
  const [meshtasticUrl, setMeshtasticUrl] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [parsed, setParsed] = useState<ParsedChannelSet | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [applyLoraOnAdd, setApplyLoraOnAdd] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmApply, setConfirmApply] = useState<ParsedChannelSet | null>(null);

  const channelRowsForExport = useMemo(
    () =>
      channelConfigs.map((c) => ({
        index: c.index,
        role: c.role,
        name: c.name,
        psk: c.psk,
        uplinkEnabled: c.uplinkEnabled,
        downlinkEnabled: c.downlinkEnabled,
        positionPrecision: c.positionPrecision,
      })),
    [channelConfigs],
  );

  const handleGenerate = () => {
    try {
      const urls = generateConfigUrl(channelRowsForExport, meshtasticLoraConfig ?? undefined, {
        includeAll: includeSecondary,
      });
      setHttpsUrl(urls.httpsUrl);
      setMeshtasticUrl(urls.meshtasticUrl);
    } catch (e) {
      console.debug('[RadioPanel] channel URL export failed ' + errLikeToLogString(e));
      const msg = e instanceof Error ? e.message : t('common.unknown');
      setStatus(t('radioPanel.channelUrl.exportFailed', { message: msg }));
    }
  };

  const handleCopy = async (text: string) => {
    if (!text) return;
    try {
      await writeClipboardText(text);
      setStatus(t('radioPanel.channelUrl.copied'));
    } catch (e) {
      console.warn('[RadioPanel] channel URL copy failed ' + errLikeToLogString(e));
      setStatus(t('radioPanel.channelUrl.copyFailed'));
    }
  };

  useEffect(() => {
    const trimmed = importUrl.trim();
    if (!trimmed) {
      setParsed(null);
      setParseError(null);
      return;
    }
    try {
      setParsed(parseConfigUrl(trimmed));
      setParseError(null);
    } catch (e) {
      // catch-no-log-ok expected while user pastes invalid channel URLs; parseError shown in UI
      setParsed(null);
      setParseError(
        e instanceof MeshtasticUrlError
          ? e.message
          : t('radioPanel.channelUrl.exportFailed', { message: t('common.unknown') }),
      );
    }
  }, [importUrl, t]);

  const runApply = async (target: ParsedChannelSet) => {
    if (!onApplyChannelSet) return;
    setApplying(true);
    try {
      await onApplyChannelSet(target, {
        applyLora: target.mode === 'replace' ? true : applyLoraOnAdd,
      });
      setStatus(t('radioPanel.channelUrl.applySuccess'));
      setImportUrl('');
      setConfirmApply(null);
    } catch (e) {
      console.warn('[RadioPanel] apply channel URL failed ' + errLikeToLogString(e));
      setStatus(
        t('radioPanel.channelUrl.applyFailed', {
          message: e instanceof Error ? e.message : t('common.unknown'),
        }),
      );
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-gray-700/80 pt-3">
      <h4 className="text-sm font-medium text-gray-300">
        {t('radioPanel.channelUrl.sectionTitle')}
      </h4>

      <div className="space-y-2">
        <p className="text-muted text-xs font-medium">{t('radioPanel.channelUrl.exportTitle')}</p>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={includeSecondary}
            onChange={(e) => {
              setIncludeSecondary(e.target.checked);
            }}
            disabled={disabled}
            className="rounded"
          />
          {t('radioPanel.channelUrl.includeSecondary')}
        </label>
        {!meshtasticLoraConfig && (
          <p className="text-xs text-yellow-500/90">
            {t('radioPanel.channelUrl.loraMissingWarning')}
          </p>
        )}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={disabled}
          className="bg-secondary-dark disabled:text-muted rounded-lg px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-600 disabled:opacity-50"
          aria-label={t('radioPanel.channelUrl.generateLink')}
        >
          {t('radioPanel.channelUrl.generateLink')}
        </button>
        {httpsUrl && (
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-muted text-xs">
                {t('radioPanel.channelUrl.httpsUrlLabel')}
              </label>
              <input
                readOnly
                value={httpsUrl}
                className="bg-deep-black/60 w-full rounded border border-gray-700 px-2 py-1 font-mono text-xs text-gray-300"
                aria-label={t('radioPanel.channelUrl.httpsUrlLabel')}
              />
              <button
                type="button"
                onClick={() => {
                  void handleCopy(httpsUrl);
                }}
                className="text-bright-green text-xs hover:underline"
                aria-label={t('radioPanel.channelUrl.copyHttps')}
              >
                {t('radioPanel.channelUrl.copyHttps')}
              </button>
            </div>
            <div className="space-y-1">
              <label className="text-muted text-xs">
                {t('radioPanel.channelUrl.meshtasticUrlLabel')}
              </label>
              <input
                readOnly
                value={meshtasticUrl}
                className="bg-deep-black/60 w-full rounded border border-gray-700 px-2 py-1 font-mono text-xs text-gray-300"
                aria-label={t('radioPanel.channelUrl.meshtasticUrlLabel')}
              />
              <button
                type="button"
                onClick={() => {
                  void handleCopy(meshtasticUrl);
                }}
                className="text-bright-green text-xs hover:underline"
                aria-label={t('radioPanel.channelUrl.copyMeshtastic')}
              >
                {t('radioPanel.channelUrl.copyMeshtastic')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-muted text-xs font-medium">{t('radioPanel.channelUrl.importTitle')}</p>
        <label className="text-muted text-xs">{t('radioPanel.channelUrl.pasteUrlLabel')}</label>
        <input
          type="text"
          value={importUrl}
          onChange={(e) => {
            setImportUrl(e.target.value);
          }}
          placeholder={t('radioPanel.channelUrl.pasteUrlPlaceholder')}
          disabled={disabled || applying}
          className="bg-deep-black/60 w-full rounded border border-gray-700 px-2 py-1.5 text-sm text-gray-200"
          aria-label={t('radioPanel.channelUrl.pasteUrlLabel')}
        />
        {parseError && <p className="text-xs text-red-400">{parseError}</p>}
        {parsed && (
          <div className="bg-deep-black/40 space-y-2 rounded-lg border border-gray-700/60 p-3 text-xs">
            <span
              className={`inline-block rounded px-2 py-0.5 font-medium ${
                parsed.mode === 'add'
                  ? 'bg-blue-900/50 text-blue-300'
                  : 'bg-yellow-900/40 text-yellow-300'
              }`}
            >
              {parsed.mode === 'add'
                ? t('radioPanel.channelUrl.modeAdd')
                : t('radioPanel.channelUrl.modeReplace')}
            </span>
            <p className="text-muted">
              {parsed.mode === 'add'
                ? t('radioPanel.channelUrl.addWarning')
                : t('radioPanel.channelUrl.replaceWarning')}
            </p>
            <p className="font-medium text-gray-300">
              {t('radioPanel.channelUrl.previewChannels')}
            </p>
            <ul className="text-muted space-y-1">
              {parsed.settings.map((ch, i) => (
                <li key={i}>
                  {t('radioPanel.channelUrl.channelRow', {
                    role:
                      i === 0
                        ? t('radioPanel.channelUrl.rolePrimary')
                        : t('radioPanel.channelUrl.roleSecondary'),
                    name: ch.name || t('radioPanel.channelRolePrimary'),
                    psk: pskFingerprint(ch.psk),
                    uplink: ch.uplinkEnabled ? '✓' : '✗',
                    downlink: ch.downlinkEnabled ? '✓' : '✗',
                  })}
                </li>
              ))}
            </ul>
            {parsed.loraConfig && (
              <p className="text-muted">
                {typeof parsed.loraConfig.region === 'number'
                  ? t('radioPanel.channelUrl.previewLora', {
                      region: parsed.loraConfig.region,
                      preset: parsed.loraConfig.modemPreset ?? 0,
                      usePreset: String(parsed.loraConfig.usePreset ?? true),
                    })
                  : t('radioPanel.channelUrl.previewLoraUnknown')}
              </p>
            )}
            {parsed.mode === 'add' && parsed.loraConfig && (
              <label className="flex items-center gap-2 text-gray-300">
                <input
                  type="checkbox"
                  checked={applyLoraOnAdd}
                  onChange={(e) => {
                    setApplyLoraOnAdd(e.target.checked);
                  }}
                  className="rounded"
                />
                {t('radioPanel.channelUrl.applyLoraOnAdd')}
              </label>
            )}
            {!onApplyChannelSet ? (
              <p className="text-yellow-500/90">{t('radioPanel.channelUrl.connectToImport')}</p>
            ) : (
              <button
                type="button"
                disabled={disabled || applying}
                onClick={() => {
                  setConfirmApply(parsed);
                }}
                className="bg-readable-green hover:bg-readable-green/90 disabled:text-muted rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:bg-gray-600"
                aria-label={t('radioPanel.channelUrl.apply')}
              >
                {applying ? '…' : t('radioPanel.channelUrl.apply')}
              </button>
            )}
          </div>
        )}
      </div>

      {confirmApply && (
        <ConfirmModal
          title={
            confirmApply.mode === 'add'
              ? t('radioPanel.channelUrl.confirmAddTitle')
              : t('radioPanel.channelUrl.confirmReplaceTitle')
          }
          message={
            confirmApply.mode === 'add'
              ? t('radioPanel.channelUrl.confirmAddMessage')
              : t('radioPanel.channelUrl.confirmReplaceMessage')
          }
          confirmLabel={t('radioPanel.channelUrl.confirmApply')}
          danger={confirmApply.mode === 'replace'}
          onConfirm={() => void runApply(confirmApply)}
          onCancel={() => {
            setConfirmApply(null);
          }}
        />
      )}
    </div>
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
  meshtasticLoraConfig,
  onApplyChannelSet,
}: {
  channelConfigs: ChannelConfig[];
  onSetChannel: Props['onSetChannel'];
  onClearChannel: Props['onClearChannel'];
  onCommit: Props['onCommit'];
  disabled: boolean;
  setStatus: (s: string) => void;
  meshtasticLoraConfig?: MeshtasticLoraConfig | null;
  onApplyChannelSet?: (
    parsed: ParsedChannelSet,
    options?: { applyLora?: boolean },
  ) => Promise<void>;
}) {
  const { t } = useTranslation();
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
      setValidationError(t('radioPanel.validationAes128'));
      return;
    }
    if (editKeySize === 'aes256' && psk.length !== 32) {
      setValidationError(t('radioPanel.validationAes256'));
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
      setStatus(t('radioPanel.channelSavedStatus', { index: selectedIndex }));
    } catch (err) {
      console.warn('[RadioPanel] save channel failed ' + errLikeToLogString(err));
      setStatus(
        t('radioPanel.channelSaveFailed', {
          message: err instanceof Error ? err.message : t('common.unknown'),
        }),
      );
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
      console.warn('[RadioPanel] reset channel failed ' + errLikeToLogString(err));
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
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>{t('radioPanel.channels')}</span>
        <svg
          className="text-muted h-4 w-4 transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="space-y-3 px-4 pb-4">
        {/* ── Channel List ── */}
        <div className="space-y-1">
          {slots.map((cfg, i) => {
            const isSelected = selectedIndex === i;
            const role = cfg?.role ?? 0;
            const secLevel = cfg && role !== 0 ? getSecurityLevel(cfg) : null;
            return (
              <button
                key={i}
                onClick={() => {
                  setSelectedIndex(i);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                  isSelected
                    ? 'border border-gray-500 bg-gray-700'
                    : 'bg-deep-black/60 border border-gray-700/50 hover:bg-gray-800'
                }`}
              >
                {/* Index badge */}
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-xs font-bold ${
                    i === 0 ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  {i}
                </span>
                {/* Name */}
                <span
                  className={`flex-1 text-sm ${role !== 0 ? 'text-gray-200' : 'text-muted italic'}`}
                >
                  {cfg?.name ||
                    (i === 0
                      ? t('radioPanel.channelRolePrimary')
                      : role !== 0
                        ? t('radioPanel.channelN', { num: i })
                        : t('radioPanel.channelRoleDisabled'))}
                </span>
                {/* Role badge */}
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${
                    role === 1
                      ? 'bg-brand-green/10 text-bright-green'
                      : role === 2
                        ? 'bg-blue-900/50 text-blue-400'
                        : 'text-muted bg-gray-800'
                  }`}
                >
                  {role === 1
                    ? t('radioPanel.channelRolePrimary')
                    : role === 2
                      ? t('radioPanel.channelRoleSecondary')
                      : t('radioPanel.channelRoleDisabled')}
                </span>
                {/* Security indicator */}
                {secLevel && <SecurityIcon level={secLevel} />}
              </button>
            );
          })}
        </div>

        {/* ── Edit Form ── */}
        {selectedIndex !== null && (
          <div className="bg-deep-black/60 mt-3 space-y-3 rounded-lg border border-gray-600 p-3">
            <h4 className="text-sm font-medium text-gray-200">Edit Channel {selectedIndex}</h4>

            {/* Name */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="radio-mt-ch-name" className="text-muted text-xs">
                  Name
                </label>
                <span className="text-muted text-xs">{editName.length}/11</span>
              </div>
              <input
                id="radio-mt-ch-name"
                type="text"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                }}
                maxLength={11}
                disabled={disabled}
                placeholder={
                  selectedIndex === 0
                    ? t('radioPanel.channelNamePrimary')
                    : t('radioPanel.channelNameSecondary')
                }
                className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Role — locked for ch0 */}
            {selectedIndex !== 0 && (
              <div className="space-y-1">
                <label htmlFor="radio-mt-ch-role" className="text-muted text-xs">
                  Role
                </label>
                <select
                  id="radio-mt-ch-role"
                  value={editRole}
                  onChange={(e) => {
                    setEditRole(Number(e.target.value));
                  }}
                  disabled={disabled}
                  className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
                >
                  <option value={0}>{t('radioPanel.channelRoleDisabled')}</option>
                  <option value={2}>{t('radioPanel.channelRoleSecondary')}</option>
                </select>
              </div>
            )}

            {/* Key Size */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <label htmlFor="radio-mt-ch-key-size" className="text-muted text-xs">
                  {t('radioPanel.keySizeLabel')}
                </label>
                <HelpTooltip text={t('radioPanel.keySizeTooltip')} />
              </div>
              <select
                id="radio-mt-ch-key-size"
                value={editKeySize}
                onChange={(e) => {
                  handleKeySizeChange(e.target.value as KeySize);
                }}
                disabled={disabled}
                className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
              >
                <option value="none">{t('radioPanel.encryptionNone')}</option>
                <option value="simple">{t('radioPanel.encryptionSimple')}</option>
                <option value="aes128">{t('radioPanel.encryptionAes128')}</option>
                <option value="aes256">{t('radioPanel.encryptionAes256')}</option>
              </select>
            </div>

            {/* Encryption Key */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <label htmlFor="radio-mt-ch-psk" className="text-muted text-xs">
                  {t('radioPanel.encryptionKeyLabel')}
                </label>
                <HelpTooltip text={t('radioPanel.encryptionKeyTooltip')} />
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
                  placeholder={t('radioPanel.pskBase64Placeholder')}
                  className="bg-secondary-dark focus:border-brand-green flex-1 rounded border border-gray-600 px-2 py-1.5 font-mono text-xs text-gray-200 read-only:opacity-60 focus:outline-none disabled:opacity-50"
                />
                {isAesKey && (
                  <button
                    onClick={() => {
                      setEditPskB64(
                        pskToBase64(generateRandomPsk(editKeySize === 'aes128' ? 16 : 32)),
                      );
                    }}
                    disabled={disabled}
                    className="bg-secondary-dark text-muted rounded border border-gray-600 px-2 py-1.5 text-xs whitespace-nowrap hover:text-gray-200 disabled:opacity-50"
                    title={t('radioPanel.generateRandomKey')}
                  >
                    {t('radioPanel.regeneratePsk')}
                  </button>
                )}
              </div>
              {validationError && <p className="text-xs text-red-400">{validationError}</p>}
            </div>

            {/* MQTT Uplink */}
            <ConfigToggle
              label={t('radioPanel.mqttUplinkLabel')}
              checked={editUplink}
              onChange={setEditUplink}
              disabled={disabled}
              description={t('radioPanel.mqttUplinkDesc')}
            />

            {/* MQTT Downlink */}
            <ConfigToggle
              label={t('radioPanel.mqttDownlinkLabel')}
              checked={editDownlink}
              onChange={setEditDownlink}
              disabled={disabled}
              description={t('radioPanel.mqttDownlinkDesc')}
            />

            {/* Position Precision */}
            <div className="space-y-1">
              <label htmlFor="radio-mt-ch-pos-precision" className="text-muted text-xs">
                {t('radioPanel.positionPrecisionChannelLabel')}
              </label>
              <input
                id="radio-mt-ch-pos-precision"
                type="number"
                value={editPosPrecision}
                onChange={(e) => {
                  setEditPosPrecision(Number(e.target.value));
                }}
                min={0}
                max={32}
                disabled={disabled}
                className="bg-secondary-dark focus:border-brand-green w-28 rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveChannel}
                disabled={disabled || saving}
                className="bg-readable-green hover:bg-readable-green/90 disabled:text-muted flex-1 rounded px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:bg-gray-600"
              >
                {saving ? t('radioPanel.savingChannel') : t('radioPanel.saveChannel')}
              </button>
              <button
                onClick={resetChannel}
                disabled={disabled || saving}
                className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-600 disabled:opacity-50"
                title={
                  selectedIndex === 0
                    ? t('radioPanel.resetChannelDefaults')
                    : t('radioPanel.disableChannel')
                }
              >
                Reset
              </button>
            </div>
          </div>
        )}

        <p className="text-muted text-xs">
          Select a channel to edit. AES-128/256 keys are shown in base64 (Meshtastic convention).
        </p>

        <ChannelUrlImportExport
          channelConfigs={channelConfigs}
          meshtasticLoraConfig={meshtasticLoraConfig}
          onApplyChannelSet={onApplyChannelSet}
          disabled={disabled}
          setStatus={setStatus}
        />
      </div>
    </details>
  );
}

// ─── MeshCore Channel Management Section ─────────────────────────────────
function hexToBytes(hex: string): Uint8Array {
  // Validate hex string
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error('Invalid hex string. Must be exactly 32 hexadecimal characters.');
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    const byteStr = hex.slice(i * 2, i * 2 + 2);
    const byte = parseInt(byteStr, 16);
    if (isNaN(byte) || byte < 0 || byte > 255) {
      throw new Error(`Invalid hex byte: ${byteStr} at position ${i}`);
    }
    bytes[i] = byte;
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
  const { t } = useTranslation();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editKeyHex, setEditKeyHex] = useState('');
  const [revealedIdx, setRevealedIdx] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newIdx, setNewIdx] = useState('');
  const [deriveKeyBusy, setDeriveKeyBusy] = useState(false);
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
    setEditKeyHex(ch.secret?.length === 16 ? bytesToHex(ch.secret) : '');
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
    if (isNaN(idx) || idx < 0 || idx > MESHCORE_CHANNEL_INDEX_MAX) return;
    if (!isValidHex) return;
    const finalName = editName.trim();
    if (!finalName) {
      alert('Channel name must not be empty.');
      return;
    }
    setSaving(true);
    try {
      await onSetChannel(idx, finalName, hexToBytes(editKeyHex));
      setEditingIdx(null);
      setAddingNew(false);
    } catch (e) {
      const errorMsg = serializeErrorLike(e) || 'Unknown error';
      console.warn(`[MeshcoreChannelSection] save failed ${errorMsg}`);
      // Show error to user - could add toast notification here
      alert(`Failed to save channel: ${errorMsg}`);
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
      console.warn('[MeshcoreChannelSection] delete failed ' + errLikeToLogString(e));
    } finally {
      setSaving(false);
    }
  }

  function generateKey() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    setEditKeyHex(bytesToHex(bytes));
  }

  async function handleDeriveKeyFromChannelName() {
    if (!editName.trim()) return;
    setDeriveKeyBusy(true);
    try {
      const hex = await meshcoreDeriveChannelKeyHexFromName(editName);
      setEditKeyHex(hex);
    } catch (e) {
      console.warn('[MeshcoreChannelSection] derive key failed ' + errLikeToLogString(e));
    } finally {
      setDeriveKeyBusy(false);
    }
  }

  const showForm = editingIdx !== null || addingNew;

  return (
    <details ref={detailsRef} className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>{t('radioPanel.channelsMeshcore')}</span>
        <svg
          className="text-muted h-4 w-4 transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="space-y-4 px-4 pb-4">
        {/* ── Channel List ── */}
        <div className="space-y-1">
          {channels.length === 0 && (
            <p className="text-muted text-xs italic">{t('radioPanel.noChannels')}</p>
          )}
          {channels.map((ch) => {
            const revealed = revealedIdx.has(ch.index);
            return (
              <div
                key={ch.index}
                className="bg-deep-black/60 flex items-center gap-2 rounded-lg border border-gray-700/50 px-3 py-2"
              >
                <span className="rounded bg-gray-700 px-1.5 py-0.5 font-mono text-xs font-bold text-gray-400">
                  {ch.index}
                </span>
                <span className="flex-1 text-sm text-gray-200">
                  {ch.name || `Channel ${ch.index}`}
                </span>
                <span className="text-muted font-mono text-xs">
                  {revealed ? bytesToHex(ch.secret) : '••••••••••••••••'}
                </span>
                <button
                  onClick={() => {
                    setRevealedIdx((prev) => {
                      const next = new Set(prev);
                      if (next.has(ch.index)) next.delete(ch.index);
                      else next.add(ch.index);
                      return next;
                    });
                  }}
                  className="text-muted px-1 text-xs hover:text-gray-300"
                  title={revealed ? t('radioPanel.hideKey') : t('radioPanel.revealKey')}
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
                  className="px-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
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
                      onClick={() => {
                        setConfirmDeleteIdx(null);
                      }}
                      className="text-muted text-xs hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      setConfirmDeleteIdx(ch.index);
                    }}
                    disabled={disabled || saving}
                    className="px-1 text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
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
            className="bg-deep-black/60 mt-3 space-y-3 rounded-lg border border-gray-600 p-3"
          >
            <h4 className="text-sm font-medium text-gray-200">
              {addingNew ? 'Add Channel' : `Edit Channel ${editingIdx}`}
            </h4>

            {addingNew && (
              <div className="space-y-1">
                <label htmlFor="radio-mc-ch-idx" className="text-muted text-xs">
                  Index (0–{MESHCORE_CHANNEL_INDEX_MAX})
                </label>
                <input
                  id="radio-mc-ch-idx"
                  type="number"
                  value={newIdx}
                  onChange={(e) => {
                    setNewIdx(e.target.value);
                  }}
                  min={0}
                  max={MESHCORE_CHANNEL_INDEX_MAX}
                  disabled={disabled}
                  className="bg-secondary-dark focus:border-brand-green w-20 rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
                />
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="radio-mc-ch-name" className="text-muted text-xs">
                {t('radioPanel.meshcoreChannelNameLabel')}
              </label>
              <input
                id="radio-mc-ch-name"
                type="text"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                }}
                maxLength={11}
                disabled={disabled}
                className="bg-secondary-dark focus:border-brand-green w-full rounded border border-gray-600 px-2 py-1.5 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
              />
            </div>

            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="radio-mc-ch-key" className="text-muted text-xs">
                  {t('radioPanel.meshcoreChannelKeyLabel')}
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void handleDeriveKeyFromChannelName();
                    }}
                    disabled={disabled || deriveKeyBusy || !editName.trim()}
                    className="text-brand-green hover:text-bright-green px-1 text-xs disabled:opacity-50"
                    title={t('radioPanel.meshcoreSha256KeyTitle')}
                  >
                    {deriveKeyBusy
                      ? t('radioPanel.meshcoreDeriving')
                      : t('radioPanel.meshcoreDeriveFromName')}
                  </button>
                  <button
                    type="button"
                    onClick={generateKey}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    {t('radioPanel.meshcoreGenerateRandomKey')}
                  </button>
                </div>
              </div>
              <input
                id="radio-mc-ch-key"
                type="text"
                value={editKeyHex}
                onChange={(e) => {
                  setEditKeyHex(e.target.value.toLowerCase());
                }}
                maxLength={32}
                placeholder={t('radioPanel.meshcorePskHexPlaceholder')}
                disabled={disabled}
                className={`bg-secondary-dark w-full rounded border px-2 py-1.5 font-mono text-sm focus:outline-none disabled:opacity-50 ${
                  editKeyHex.length > 0 && !isValidHex
                    ? 'border-red-500 text-red-400'
                    : 'focus:border-brand-green border-gray-600 text-gray-200'
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
                className="bg-readable-green hover:bg-readable-green/90 disabled:text-muted flex-1 rounded px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:bg-gray-600"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setEditingIdx(null);
                  setAddingNew(false);
                }}
                className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-600"
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
            className="text-muted w-full rounded border border-dashed border-gray-600 px-3 py-1.5 text-xs transition-colors hover:border-gray-400 hover:text-gray-300 disabled:opacity-50"
          >
            + Add Channel
          </button>
        )}

        <p className="text-muted text-xs">
          Keys are 128-bit (16 bytes), shown as 32 hex characters. Up to{' '}
          {MESHCORE_CHANNEL_INDEX_MAX + 1} channels (indices 0–{MESHCORE_CHANNEL_INDEX_MAX}). For
          #channels, use &quot;Derive from name&quot; (SHA-256 of the name with a leading #).
        </p>
      </div>
    </details>
  );
}
