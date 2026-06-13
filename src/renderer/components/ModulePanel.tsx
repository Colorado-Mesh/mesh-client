import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSyncFormFromConfig } from '@/renderer/hooks/useSyncFormFromConfig';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { DetailsChevron } from '@/renderer/lib/icons/detailsChevron';
import { formatMeshtasticModuleApplyError } from '@/renderer/lib/meshtastic/meshtasticApplyErrorMessage';
import { clearMeshtasticClientNotification } from '@/renderer/lib/meshtastic/meshtasticClientNotification';
import {
  buildMeshtasticModuleApplyValue,
  mergeMeshtasticConfigApplyValue,
  meshtasticConfigSlice,
  meshtasticConfigSliceHydrated,
} from '@/renderer/lib/meshtastic/meshtasticConfigApply';
import {
  buildMeshtasticMqttModuleApplyValue,
  type MeshtasticDeviceNetworkCapabilities,
  meshtasticDeviceRequiresMqttProxyToClient,
  validateMeshtasticMqttModuleApply,
} from '@/renderer/lib/meshtastic/meshtasticMqttModuleApply';
import { validateMeshtasticSerialModuleApply } from '@/renderer/lib/meshtastic/meshtasticSerialModuleApply';
import { MS_PER_MINUTE } from '@/renderer/lib/timeConstants';
import type { ConfigTargetContext } from '@/renderer/lib/types';

import { ConfigApplyNotice } from './ConfigApplyNotice';
import { ConfirmModal } from './ConfirmModal';
import { HelpTooltip } from './HelpTooltip';
import { useToast } from './Toast';

interface PacketMessage {
  from: number;
  data: Uint8Array;
  timestamp: number;
}

function storeForwardRecordsFromCfg(cfg: Record<string, unknown>): number {
  return cfgNum(cfg.records ?? cfg.numRecords, 0);
}

function cfgBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function cfgNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function cfgStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

interface Props {
  configTarget?: ConfigTargetContext;
  moduleConfigs: Record<string, unknown>;
  onSetModuleConfig: (config: unknown) => Promise<void>;
  onSetCannedMessages: (messages: string[]) => Promise<void>;
  onSetRingtone?: (ringtone: string) => Promise<void>;
  ringtone?: string;
  onCommit: () => Promise<void>;
  isConnected: boolean;
  /** Meshtastic DeviceMetadata network flags; used for MQTT proxy requirement. */
  deviceNetwork?: MeshtasticDeviceNetworkCapabilities;
  storeForwardMessages?: Map<number, PacketMessage[]>;
  rangeTestPackets?: Map<number, PacketMessage[]>;
  serialMessages?: Map<number, PacketMessage[]>;
  remoteHardwareMessages?: Map<number, PacketMessage[]>;
  /** IP tunnel packet stream; null/absent = daemon not running. */
  ipTunnelMessages?: Map<number, PacketMessage[]>;
}

// ─── Reusable config components (same pattern as RadioPanel) ─────

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
  options: { value: number; label: string }[];
  onChange: (val: number) => void;
  disabled: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-muted text-sm">{label}</label>
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

function ConfigToggle({
  label,
  checked,
  onChange,
  disabled,
  description,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
  description?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-300">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => {
            onChange(!checked);
          }}
          disabled={disabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
            checked ? 'bg-readable-green' : 'bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
              checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </button>
      </div>
      {description && <p className="text-muted text-xs">{description}</p>}
    </div>
  );
}

function ConfigNumber({
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
  onChange: (v: number) => void;
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

function ConfigText({
  label,
  value,
  onChange,
  disabled,
  description,
  password,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  description?: string;
  password?: boolean;
}) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1">
      <label className="text-muted text-sm">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type={password && !show ? 'password' : 'text'}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          disabled={disabled}
          className="bg-secondary-dark focus:border-brand-green flex-1 rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
        />
        {password && (
          <button
            type="button"
            onClick={() => {
              setShow((s) => !s);
            }}
            className="text-muted px-2 py-2 text-xs hover:text-gray-300"
          >
            {show ? t('common.hide') : t('common.show')}
          </button>
        )}
      </div>
      {description && <p className="text-muted text-xs">{description}</p>}
    </div>
  );
}

function ModuleSection({
  title,
  children,
  onApply,
  applying,
  disabled,
  sliceReady = true,
  showSliceWaiting = false,
  globalApplyLocked = false,
}: {
  title: string;
  children: React.ReactNode;
  onApply: () => void;
  applying: boolean;
  disabled: boolean;
  /** When false, Apply stays disabled until device module slice is hydrated. */
  sliceReady?: boolean;
  /** Show "waiting for settings" hint (pass when connected and slice not ready). */
  showSliceWaiting?: boolean;
  /** When true, Apply is disabled while any module section is applying. */
  globalApplyLocked?: boolean;
}) {
  const { t } = useTranslation();
  const applyDisabled = disabled || applying || !sliceReady || globalApplyLocked;
  return (
    <details className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>{title}</span>
        <DetailsChevron />
      </summary>
      <div className="space-y-4 px-4 pb-4">
        {showSliceWaiting && !sliceReady && (
          <p className="text-xs text-yellow-300/90">
            {t('radioPanel.waitingForConfigSection', { section: title })}
          </p>
        )}
        {children}
        <button
          type="button"
          onClick={onApply}
          disabled={applyDisabled}
          className="bg-readable-green hover:bg-readable-green/90 disabled:text-muted w-full rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:bg-gray-600"
        >
          {applying
            ? t('modulePanel.applyingButton')
            : t('modulePanel.applySection', { section: title })}
        </button>
      </div>
    </details>
  );
}

function StatusOnlySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>{title}</span>
        <DetailsChevron />
      </summary>
      <div className="space-y-4 px-4 pb-4">{children}</div>
    </details>
  );
}

const RTTTL_PRESETS = [
  { name: 'Beep', value: 'Beep:d=8,o=5,b=180:a' },
  { name: 'Two Beeps', value: 'TwoBeeps:d=8,o=5,b=180:a,p,a' },
  {
    name: 'Thunderbirds',
    value:
      'Thunderbirds:d=4,o=5,b=160:32c,32d#,32f,32g,16a#,16a,16g,16f,16d#,32c,32d#,32f,16g,8a#,8a,8g,8f,8d#,8c',
  },
  {
    name: 'Star Wars',
    value:
      'StarWars:d=4,o=5,b=45:32p,32f#,32f#,32f#,8b.,8f#.16p,16e,16d#,16c#,8b.16p,32f#,32f#,32f#,8e.,16p,16e,16d#,16c#,8b.',
  },
  { name: 'Nokia', value: 'NokiaTune:d=4,o=5,b=225:8e6,8d6,f#,g#,8c#6,8b,d,e,8b,8a,c#,e,2a' },
];

function isValidRtttl(s: string): boolean {
  const parts = s.split(':');
  return (
    parts.length === 3 &&
    parts[0].trim().length > 0 &&
    /d=\d+/.test(parts[1]) &&
    /o=\d+/.test(parts[1]) &&
    /b=\d+/.test(parts[1])
  );
}

function formatTimeAgo(ts: number, t: TFunction): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < MS_PER_MINUTE) return t('common.justNow');
  return t('common.minutesAgo', { count: Math.floor(diff / MS_PER_MINUTE) });
}

function ModuleStatus({
  packets,
  label,
}: {
  packets?: Map<number, { from: number; data: Uint8Array; timestamp: number }[]>;
  label: string;
}) {
  const { t } = useTranslation();
  if (!packets || packets.size === 0) {
    return (
      <div className="rounded bg-gray-800/50 px-3 py-2 text-xs">
        <span className="text-gray-500">{t('modulePanel.statusNoPackets', { label })}</span>
      </div>
    );
  }
  const total = Array.from(packets.values()).reduce((sum, arr) => sum + arr.length, 0);
  const latest = Math.max(
    ...Array.from(packets.values()).flatMap((arr) => arr.map((p) => p.timestamp)),
  );
  const lastSeen = formatTimeAgo(latest, t);
  return (
    <div className="rounded bg-gray-800/50 px-3 py-2 text-xs">
      <span className="text-gray-400">
        {t('modulePanel.statusLine', {
          count: packets.size,
          label,
          total,
          lastSeen,
        })}
      </span>
    </div>
  );
}

const INPUT_EVENT_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 10, label: 'Select (Enter)' },
  { value: 17, label: 'Up' },
  { value: 18, label: 'Down' },
  { value: 19, label: 'Left' },
  { value: 20, label: 'Right' },
  { value: 27, label: 'Back (Esc)' },
  { value: 24, label: 'Cancel' },
];

export default function ModulePanel({
  configTarget,
  moduleConfigs,
  onSetModuleConfig,
  onSetCannedMessages,
  onSetRingtone,
  ringtone,
  onCommit,
  isConnected,
  deviceNetwork,
  storeForwardMessages,
  rangeTestPackets,
  serialMessages,
  remoteHardwareMessages,
  ipTunnelMessages,
}: Props) {
  const { addToast } = useToast();
  const { t } = useTranslation();
  const secondsUnit = t('radioPanel.secondsUnit');
  const disabled = !isConnected || (configTarget?.mode === 'remote' && !configTarget.isReady);
  const remoteTarget = configTarget?.mode === 'remote';
  const moduleSliceReady = (key: string) => meshtasticConfigSliceHydrated(moduleConfigs[key]);
  const moduleSectionProps = (key: string) => ({
    sliceReady: moduleSliceReady(key),
    showSliceWaiting: isConnected,
    globalApplyLocked: applyingSection !== null,
  });
  const [applyingSection, setApplyingSection] = useState<string | null>(null);
  const [rhPendingConfirm, setRhPendingConfirm] = useState<'enable' | 'undefinedPins' | null>(null);

  // ─── Telemetry module ──────────────────────────────────────────
  const telCfg = meshtasticConfigSlice(moduleConfigs.telemetry);
  const [telDeviceTelemetryEnabled, setTelDeviceTelemetryEnabled] = useState<boolean>(
    cfgBool(telCfg.deviceTelemetryEnabled, false),
  );
  const [telDeviceInterval, setTelDeviceInterval] = useState<number>(
    cfgNum(telCfg.deviceUpdateInterval, 1800),
  );
  const [telEnvEnabled, setTelEnvEnabled] = useState<boolean>(
    cfgBool(telCfg.environmentMeasurementEnabled, false),
  );
  const [telEnvInterval, setTelEnvInterval] = useState<number>(
    cfgNum(telCfg.environmentUpdateInterval, 1800),
  );
  const [telEnvScreenEnabled, setTelEnvScreenEnabled] = useState<boolean>(
    cfgBool(telCfg.environmentScreenEnabled, false),
  );
  const [telEnvFahrenheit, setTelEnvFahrenheit] = useState<boolean>(
    cfgBool(telCfg.environmentDisplayFahrenheit, false),
  );
  const [telAirQualityEnabled, setTelAirQualityEnabled] = useState<boolean>(
    cfgBool(telCfg.airQualityEnabled, false),
  );
  const [telAirQualityInterval, setTelAirQualityInterval] = useState<number>(
    cfgNum(telCfg.airQualityInterval, 0),
  );
  const [telPowerEnabled, setTelPowerEnabled] = useState<boolean>(
    cfgBool(telCfg.powerMeasurementEnabled, false),
  );
  const [telPowerInterval, setTelPowerInterval] = useState<number>(
    cfgNum(telCfg.powerUpdateInterval, 0),
  );
  const [telPowerScreenEnabled, setTelPowerScreenEnabled] = useState<boolean>(
    cfgBool(telCfg.powerScreenEnabled, false),
  );

  // ─── MQTT relay module ─────────────────────────────────────────
  const mqttCfg = meshtasticConfigSlice(moduleConfigs.mqtt);
  const [mqttEnabled, setMqttEnabled] = useState<boolean>(cfgBool(mqttCfg.enabled, false));
  const [mqttAddress, setMqttAddress] = useState<string>(cfgStr(mqttCfg.address, ''));
  const [mqttUsername, setMqttUsername] = useState<string>(cfgStr(mqttCfg.username, ''));
  const [mqttPassword, setMqttPassword] = useState<string>(cfgStr(mqttCfg.password, ''));
  const [mqttEncryption, setMqttEncryption] = useState<boolean>(
    cfgBool(mqttCfg.encryptionEnabled, false),
  );
  const [mqttJson, setMqttJson] = useState<boolean>(cfgBool(mqttCfg.jsonEnabled, false));
  const [mqttTls, setMqttTls] = useState<boolean>(cfgBool(mqttCfg.tlsEnabled, false));
  const [mqttRoot, setMqttRoot] = useState<string>(cfgStr(mqttCfg.root, ''));
  const [mqttMapReporting, setMqttMapReporting] = useState<boolean>(
    cfgBool(mqttCfg.mapReportingEnabled, false),
  );
  const [mqttProxyToClient, setMqttProxyToClient] = useState<boolean>(
    cfgBool(mqttCfg.proxyToClientEnabled, false),
  );
  const mqttProxyForced = mqttEnabled && meshtasticDeviceRequiresMqttProxyToClient(deviceNetwork);
  const mqttProxyToClientChecked = mqttProxyForced || mqttProxyToClient;

  const buildMqttUiValues = () => ({
    enabled: mqttEnabled,
    address: mqttAddress,
    username: mqttUsername,
    password: mqttPassword,
    encryptionEnabled: mqttEncryption,
    jsonEnabled: mqttJson,
    tlsEnabled: mqttTls,
    root: mqttRoot,
    mapReportingEnabled: mqttMapReporting,
    proxyToClientEnabled: mqttProxyToClientChecked,
  });

  // ─── Canned messages ──────────────────────────────────────────
  const cannedCfg = meshtasticConfigSlice(moduleConfigs.cannedMessage);
  const [cannedEnabled, setCannedEnabled] = useState<boolean>(cfgBool(cannedCfg.enabled, false));
  const [cannedRotary1Enabled, setCannedRotary1Enabled] = useState<boolean>(
    cfgBool(cannedCfg.rotary1Enabled, false),
  );
  const [cannedPinA, setCannedPinA] = useState<number>(cfgNum(cannedCfg.inputbrokerPinA, 0));
  const [cannedPinB, setCannedPinB] = useState<number>(cfgNum(cannedCfg.inputbrokerPinB, 0));
  const [cannedPinPress, setCannedPinPress] = useState<number>(
    cfgNum(cannedCfg.inputbrokerPinPress, 0),
  );
  const [cannedEventCw, setCannedEventCw] = useState<number>(
    cfgNum(cannedCfg.inputbrokerEventCw, 0),
  );
  const [cannedEventCcw, setCannedEventCcw] = useState<number>(
    cfgNum(cannedCfg.inputbrokerEventCcw, 0),
  );
  const [cannedEventPress, setCannedEventPress] = useState<number>(
    cfgNum(cannedCfg.inputbrokerEventPress, 0),
  );
  const [cannedUpdown1Enabled, setCannedUpdown1Enabled] = useState<boolean>(
    cfgBool(cannedCfg.updown1Enabled, false),
  );
  const [cannedAllowInputSource, setCannedAllowInputSource] = useState<string>(
    cfgStr(cannedCfg.allowInputSource, ''),
  );
  const [cannedSendBell, setCannedSendBell] = useState<boolean>(cfgBool(cannedCfg.sendBell, false));
  const [cannedText, setCannedText] = useState<string>(cfgStr(cannedCfg.messages, ''));

  // ─── Serial module ─────────────────────────────────────────────
  const serialCfg = meshtasticConfigSlice(moduleConfigs.serial);
  const [serialEnabled, setSerialEnabled] = useState<boolean>(cfgBool(serialCfg.enabled, false));
  const [serialEcho, setSerialEcho] = useState<boolean>(cfgBool(serialCfg.echo, false));
  const [serialRxd, setSerialRxd] = useState<number>(cfgNum(serialCfg.rxd, 0));
  const [serialTxd, setSerialTxd] = useState<number>(cfgNum(serialCfg.txd, 0));
  const [serialBaud, setSerialBaud] = useState<number>(cfgNum(serialCfg.baud, 0));
  const [serialTimeout, setSerialTimeout] = useState<number>(cfgNum(serialCfg.timeout, 0));
  const [serialMode, setSerialMode] = useState<number>(cfgNum(serialCfg.mode, 0));
  const [serialOverrideConsole, setSerialOverrideConsole] = useState<boolean>(
    cfgBool(serialCfg.overrideConsoleSerialPort, false),
  );

  // ─── Range test module ─────────────────────────────────────────
  const rangeCfg = meshtasticConfigSlice(moduleConfigs.rangeTest);
  const [rangeEnabled, setRangeEnabled] = useState<boolean>(cfgBool(rangeCfg.enabled, false));
  const [rangeSenderInterval, setRangeSenderInterval] = useState<number>(
    cfgNum(rangeCfg.sender, 0),
  );
  const [rangeSave, setRangeSave] = useState<boolean>(cfgBool(rangeCfg.save, false));

  // ─── Store and Forward module ──────────────────────────────────
  const sfCfg = meshtasticConfigSlice(moduleConfigs.storeForward);
  const [sfEnabled, setSfEnabled] = useState<boolean>(cfgBool(sfCfg.enabled, false));
  const [sfHeartbeat, setSfHeartbeat] = useState<boolean>(cfgBool(sfCfg.heartbeat, false));
  const [sfNumRecords, setSfNumRecords] = useState<number>(storeForwardRecordsFromCfg(sfCfg));
  const [sfHistoryMax, setSfHistoryMax] = useState<number>(cfgNum(sfCfg.historyReturnMax, 25));
  const [sfHistoryWindow, setSfHistoryWindow] = useState<number>(
    cfgNum(sfCfg.historyReturnWindow, 7200),
  );

  // ─── Detection sensor module ──────────────────────────────────
  const detectCfg = meshtasticConfigSlice(moduleConfigs.detectionSensor);
  const [detectEnabled, setDetectEnabled] = useState<boolean>(cfgBool(detectCfg.enabled, false));
  const [detectName, setDetectName] = useState<string>(cfgStr(detectCfg.name, ''));
  const [detectMinBroadcast, setDetectMinBroadcast] = useState<number>(
    cfgNum(detectCfg.minimumBroadcastSecs, 0),
  );
  const [detectStateBroadcast, setDetectStateBroadcast] = useState<number>(
    cfgNum(detectCfg.stateBroadcastSecs, 0),
  );

  // ─── Remote Hardware module ────────────────────────────────────
  const remoteHardwareCfg = meshtasticConfigSlice(moduleConfigs.remoteHardware);
  const [remoteHardwareEnabled, setRemoteHardwareEnabled] = useState<boolean>(
    cfgBool(remoteHardwareCfg.enabled, false),
  );
  const [remoteHardwareAllowUndefinedPins, setRemoteHardwareAllowUndefinedPins] = useState<boolean>(
    cfgBool(remoteHardwareCfg.allowUndefinedPinAccess, false),
  );

  // ─── Neighbor Info module ──────────────────────────────────────
  const neighborInfoCfg = meshtasticConfigSlice(moduleConfigs.neighborInfo);
  const [neighborInfoEnabled, setNeighborInfoEnabled] = useState<boolean>(
    cfgBool(neighborInfoCfg.enabled, false),
  );
  const [neighborInfoUpdateInterval, setNeighborInfoUpdateInterval] = useState<number>(
    cfgNum(neighborInfoCfg.updateInterval, 0),
  );
  const [neighborInfoTransmitOverLora, setNeighborInfoTransmitOverLora] = useState<boolean>(
    cfgBool(neighborInfoCfg.transmitOverLora, false),
  );

  // ─── TAK module ────────────────────────────────────────────────
  const takCfg = meshtasticConfigSlice(moduleConfigs.tak);
  const [takTeam, setTakTeam] = useState<number>(cfgNum(takCfg.team, 0));
  const [takRole, setTakRole] = useState<number>(cfgNum(takCfg.role, 0));

  // ─── Traffic Management module ─────────────────────────────────
  const trafficMgmtCfg = meshtasticConfigSlice(moduleConfigs.trafficManagement);
  const [tmEnabled, setTmEnabled] = useState<boolean>(cfgBool(trafficMgmtCfg.enabled, false));
  const [tmPositionDedupEnabled, setTmPositionDedupEnabled] = useState<boolean>(
    cfgBool(trafficMgmtCfg.positionDedupEnabled, false),
  );
  const [tmPositionPrecisionBits, setTmPositionPrecisionBits] = useState<number>(
    cfgNum(trafficMgmtCfg.positionPrecisionBits, 0),
  );
  const [tmPositionMinIntervalSecs, setTmPositionMinIntervalSecs] = useState<number>(
    cfgNum(trafficMgmtCfg.positionMinIntervalSecs, 0),
  );
  const [tmNodeinfoDirectResponse, setTmNodeinfoDirectResponse] = useState<boolean>(
    cfgBool(trafficMgmtCfg.nodeinfoDirectResponse, false),
  );
  const [tmNodeinfoDirectResponseMaxHops, setTmNodeinfoDirectResponseMaxHops] = useState<number>(
    cfgNum(trafficMgmtCfg.nodeinfoDirectResponseMaxHops, 0),
  );
  const [tmRateLimitEnabled, setTmRateLimitEnabled] = useState<boolean>(
    cfgBool(trafficMgmtCfg.rateLimitEnabled, false),
  );
  const [tmRateLimitWindowSecs, setTmRateLimitWindowSecs] = useState<number>(
    cfgNum(trafficMgmtCfg.rateLimitWindowSecs, 0),
  );
  const [tmRateLimitMaxPackets, setTmRateLimitMaxPackets] = useState<number>(
    cfgNum(trafficMgmtCfg.rateLimitMaxPackets, 0),
  );
  const [tmDropUnknownEnabled, setTmDropUnknownEnabled] = useState<boolean>(
    cfgBool(trafficMgmtCfg.dropUnknownEnabled, false),
  );
  const [tmUnknownPacketThreshold, setTmUnknownPacketThreshold] = useState<number>(
    cfgNum(trafficMgmtCfg.unknownPacketThreshold, 0),
  );
  const [tmExhaustHopTelemetry, setTmExhaustHopTelemetry] = useState<boolean>(
    cfgBool(trafficMgmtCfg.exhaustHopTelemetry, false),
  );
  const [tmExhaustHopPosition, setTmExhaustHopPosition] = useState<boolean>(
    cfgBool(trafficMgmtCfg.exhaustHopPosition, false),
  );
  const [tmRouterPreserveHops, setTmRouterPreserveHops] = useState<boolean>(
    cfgBool(trafficMgmtCfg.routerPreserveHops, false),
  );

  // ─── Pax counter module ────────────────────────────────────────
  const paxCfg = meshtasticConfigSlice(moduleConfigs.paxcounter);
  const [paxEnabled, setPaxEnabled] = useState<boolean>(cfgBool(paxCfg.enabled, false));
  const [paxInterval, setPaxInterval] = useState<number>(
    cfgNum(paxCfg.paxcounterUpdateInterval, 0),
  );

  // ─── External Notification module ─────────────────────────────
  const extNotifCfg = meshtasticConfigSlice(moduleConfigs.externalNotification);
  const [extEnabled, setExtEnabled] = useState<boolean>(cfgBool(extNotifCfg.enabled, false));
  const [extActive, setExtActive] = useState<boolean>(cfgBool(extNotifCfg.active, false));
  const [extOutput, setExtOutput] = useState<number>(cfgNum(extNotifCfg.output, 0));
  const [extOutputBuzzer, setExtOutputBuzzer] = useState<number>(
    cfgNum(extNotifCfg.outputBuzzer, 0),
  );
  const [extOutputVibra, setExtOutputVibra] = useState<number>(cfgNum(extNotifCfg.outputVibra, 0));
  const [extOutputMs, setExtOutputMs] = useState<number>(cfgNum(extNotifCfg.outputMs, 1000));
  const [extNagTimeout, setExtNagTimeout] = useState<number>(cfgNum(extNotifCfg.nagTimeout, 0));
  const [extAlertMessage, setExtAlertMessage] = useState<boolean>(
    cfgBool(extNotifCfg.alertMessage, false),
  );
  const [extAlertMessageBuzzer, setExtAlertMessageBuzzer] = useState<boolean>(
    cfgBool(extNotifCfg.alertMessageBuzzer, false),
  );
  const [extAlertMessageVibra, setExtAlertMessageVibra] = useState<boolean>(
    cfgBool(extNotifCfg.alertMessageVibra, false),
  );
  const [extAlertBell, setExtAlertBell] = useState<boolean>(cfgBool(extNotifCfg.alertBell, false));
  const [extAlertBellBuzzer, setExtAlertBellBuzzer] = useState<boolean>(
    cfgBool(extNotifCfg.alertBellBuzzer, false),
  );
  const [extAlertBellVibra, setExtAlertBellVibra] = useState<boolean>(
    cfgBool(extNotifCfg.alertBellVibra, false),
  );
  const [extUsePwm, setExtUsePwm] = useState<boolean>(cfgBool(extNotifCfg.usePwm, false));
  const [extUseI2sAsBuzzer, setExtUseI2sAsBuzzer] = useState<boolean>(
    cfgBool(extNotifCfg.useI2sAsBuzzer, false),
  );

  // ─── Ambient Lighting module ───────────────────────────────────
  const ambientCfg = meshtasticConfigSlice(moduleConfigs.ambientLighting);
  const [ambientLedState, setAmbientLedState] = useState<boolean>(
    cfgBool(ambientCfg.ledState, false),
  );
  const [ambientRed, setAmbientRed] = useState<number>(cfgNum(ambientCfg.red, 0));
  const [ambientGreen, setAmbientGreen] = useState<number>(cfgNum(ambientCfg.green, 0));
  const [ambientBlue, setAmbientBlue] = useState<number>(cfgNum(ambientCfg.blue, 0));
  const [ambientCurrent, setAmbientCurrent] = useState<number>(cfgNum(ambientCfg.current, 10));

  // ─── RTTTL Ringtone ───────────────────────────────────────────
  const [ringtoneText, setRingtoneText] = useState<string>(ringtone ?? '');

  useSyncFormFromConfig(moduleConfigs.telemetry, (cfg) => {
    setTelDeviceTelemetryEnabled(cfgBool(cfg.deviceTelemetryEnabled, false));
    setTelDeviceInterval(cfgNum(cfg.deviceUpdateInterval, 1800));
    setTelEnvEnabled(cfgBool(cfg.environmentMeasurementEnabled, false));
    setTelEnvInterval(cfgNum(cfg.environmentUpdateInterval, 1800));
    setTelEnvScreenEnabled(cfgBool(cfg.environmentScreenEnabled, false));
    setTelEnvFahrenheit(cfgBool(cfg.environmentDisplayFahrenheit, false));
    setTelAirQualityEnabled(cfgBool(cfg.airQualityEnabled, false));
    setTelAirQualityInterval(cfgNum(cfg.airQualityInterval, 0));
    setTelPowerEnabled(cfgBool(cfg.powerMeasurementEnabled, false));
    setTelPowerInterval(cfgNum(cfg.powerUpdateInterval, 0));
    setTelPowerScreenEnabled(cfgBool(cfg.powerScreenEnabled, false));
  });

  useSyncFormFromConfig(moduleConfigs.mqtt, (cfg) => {
    setMqttEnabled(cfgBool(cfg.enabled, false));
    setMqttAddress(cfgStr(cfg.address, ''));
    setMqttUsername(cfgStr(cfg.username, ''));
    setMqttPassword(cfgStr(cfg.password, ''));
    setMqttEncryption(cfgBool(cfg.encryptionEnabled, false));
    setMqttJson(cfgBool(cfg.jsonEnabled, false));
    setMqttTls(cfgBool(cfg.tlsEnabled, false));
    setMqttRoot(cfgStr(cfg.root, ''));
    setMqttMapReporting(cfgBool(cfg.mapReportingEnabled, false));
    setMqttProxyToClient(cfgBool(cfg.proxyToClientEnabled, false));
  });

  useSyncFormFromConfig(moduleConfigs.cannedMessage, (cfg) => {
    setCannedEnabled(cfgBool(cfg.enabled, false));
    setCannedText(cfgStr(cfg.messages, ''));
  });

  useSyncFormFromConfig(moduleConfigs.serial, (cfg) => {
    setSerialEnabled(cfgBool(cfg.enabled, false));
    setSerialEcho(cfgBool(cfg.echo, false));
    setSerialBaud(cfgNum(cfg.baud, 38400));
  });

  useSyncFormFromConfig(moduleConfigs.rangeTest, (cfg) => {
    setRangeEnabled(cfgBool(cfg.enabled, false));
    setRangeSenderInterval(cfgNum(cfg.sender, 0));
    setRangeSave(cfgBool(cfg.save, false));
  });

  useSyncFormFromConfig(moduleConfigs.storeForward, (cfg) => {
    setSfEnabled(cfgBool(cfg.enabled, false));
    setSfHeartbeat(cfgBool(cfg.heartbeat, false));
    setSfNumRecords(storeForwardRecordsFromCfg(cfg));
    setSfHistoryMax(cfgNum(cfg.historyReturnMax, 25));
    setSfHistoryWindow(cfgNum(cfg.historyReturnWindow, 7200));
  });

  useSyncFormFromConfig(moduleConfigs.detectionSensor, (cfg) => {
    setDetectEnabled(cfgBool(cfg.enabled, false));
    setDetectName(cfgStr(cfg.name, ''));
    setDetectMinBroadcast(cfgNum(cfg.minimumBroadcastSecs, 0));
    setDetectStateBroadcast(cfgNum(cfg.stateBroadcastSecs, 0));
  });

  useSyncFormFromConfig(moduleConfigs.remoteHardware, (cfg) => {
    setRemoteHardwareEnabled(cfgBool(cfg.enabled, false));
    setRemoteHardwareAllowUndefinedPins(cfgBool(cfg.allowUndefinedPinAccess, false));
  });

  useSyncFormFromConfig(moduleConfigs.paxcounter, (cfg) => {
    setPaxEnabled(cfgBool(cfg.enabled, false));
    setPaxInterval(cfgNum(cfg.paxcounterUpdateInterval, 0));
  });
  useSyncFormFromConfig(moduleConfigs.neighborInfo, (cfg) => {
    setNeighborInfoEnabled(cfgBool(cfg.enabled, false));
    setNeighborInfoUpdateInterval(cfgNum(cfg.updateInterval, 0));
    setNeighborInfoTransmitOverLora(cfgBool(cfg.transmitOverLora, false));
  });

  useSyncFormFromConfig(moduleConfigs.tak, (cfg) => {
    setTakTeam(cfgNum(cfg.team, 0));
    setTakRole(cfgNum(cfg.role, 0));
  });

  useSyncFormFromConfig(moduleConfigs.trafficManagement, (cfg) => {
    setTmEnabled(cfgBool(cfg.enabled, false));
    setTmPositionDedupEnabled(cfgBool(cfg.positionDedupEnabled, false));
    setTmPositionPrecisionBits(cfgNum(cfg.positionPrecisionBits, 0));
    setTmPositionMinIntervalSecs(cfgNum(cfg.positionMinIntervalSecs, 0));
    setTmNodeinfoDirectResponse(cfgBool(cfg.nodeinfoDirectResponse, false));
    setTmNodeinfoDirectResponseMaxHops(cfgNum(cfg.nodeinfoDirectResponseMaxHops, 0));
    setTmRateLimitEnabled(cfgBool(cfg.rateLimitEnabled, false));
    setTmRateLimitWindowSecs(cfgNum(cfg.rateLimitWindowSecs, 0));
    setTmRateLimitMaxPackets(cfgNum(cfg.rateLimitMaxPackets, 0));
    setTmDropUnknownEnabled(cfgBool(cfg.dropUnknownEnabled, false));
    setTmUnknownPacketThreshold(cfgNum(cfg.unknownPacketThreshold, 0));
    setTmExhaustHopTelemetry(cfgBool(cfg.exhaustHopTelemetry, false));
    setTmExhaustHopPosition(cfgBool(cfg.exhaustHopPosition, false));
    setTmRouterPreserveHops(cfgBool(cfg.routerPreserveHops, false));
  });

  useSyncFormFromConfig(moduleConfigs.externalNotification, (cfg) => {
    setExtEnabled(cfgBool(cfg.enabled, false));
    setExtActive(cfgBool(cfg.active, false));
    setExtOutput(cfgNum(cfg.output, 0));
    setExtOutputBuzzer(cfgNum(cfg.outputBuzzer, 0));
    setExtOutputVibra(cfgNum(cfg.outputVibra, 0));
    setExtOutputMs(cfgNum(cfg.outputMs, 1000));
    setExtNagTimeout(cfgNum(cfg.nagTimeout, 0));
    setExtAlertMessage(cfgBool(cfg.alertMessage, false));
    setExtAlertMessageBuzzer(cfgBool(cfg.alertMessageBuzzer, false));
    setExtAlertMessageVibra(cfgBool(cfg.alertMessageVibra, false));
    setExtAlertBell(cfgBool(cfg.alertBell, false));
    setExtAlertBellBuzzer(cfgBool(cfg.alertBellBuzzer, false));
    setExtAlertBellVibra(cfgBool(cfg.alertBellVibra, false));
    setExtUsePwm(cfgBool(cfg.usePwm, false));
    setExtUseI2sAsBuzzer(cfgBool(cfg.useI2sAsBuzzer, false));
  });

  useSyncFormFromConfig(moduleConfigs.ambientLighting, (cfg) => {
    setAmbientLedState(cfgBool(cfg.ledState, false));
    setAmbientRed(cfgNum(cfg.red, 0));
    setAmbientGreen(cfgNum(cfg.green, 0));
    setAmbientBlue(cfgNum(cfg.blue, 0));
    setAmbientCurrent(cfgNum(cfg.current, 10));
  });

  const ambientHex = `#${[ambientRed, ambientGreen, ambientBlue].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const parseAmbientHexByte = (hex: string) => {
    const n = parseInt(hex, 16);
    return Number.isFinite(n) ? Math.min(255, Math.max(0, n)) : 0;
  };
  const handleAmbientColorChange = (hex: string) => {
    setAmbientRed(parseAmbientHexByte(hex.slice(1, 3)));
    setAmbientGreen(parseAmbientHexByte(hex.slice(3, 5)));
    setAmbientBlue(parseAmbientHexByte(hex.slice(5, 7)));
  };

  const applyModule = async (sectionLabel: string, moduleCase: string, value: unknown) => {
    clearMeshtasticClientNotification();
    setApplyingSection(moduleCase);
    try {
      await onSetModuleConfig({ payloadVariant: { case: moduleCase, value } });
      addToast(t('modulePanel.sectionSent', { name: sectionLabel }), 'success');
      try {
        await onCommit();
      } catch (err: unknown) {
        // catch-no-log-ok commit failure surfaced in module panel toast
        addToast(
          t('modulePanel.commitFailed', {
            message: formatMeshtasticModuleApplyError(err, t),
          }),
          'error',
        );
      }
    } catch (err: unknown) {
      console.warn('[ModulePanel] apply failed ' + errLikeToLogString(err));
      addToast(
        t('modulePanel.failed', {
          message: formatMeshtasticModuleApplyError(err, t),
        }),
        'error',
      );
    } finally {
      setApplyingSection(null);
    }
  };

  const applyMeshtasticModule = (
    sectionLabel: string,
    moduleCase: string,
    deviceSlice: unknown,
    uiOverrides: Record<string, unknown>,
  ) => {
    void applyModule(
      sectionLabel,
      moduleCase,
      buildMeshtasticModuleApplyValue(moduleCase, deviceSlice, uiOverrides),
    );
  };

  const validateMqttRelayBeforeApply = (): string | null => {
    const merged = buildMeshtasticMqttModuleApplyValue(mqttCfg, buildMqttUiValues(), deviceNetwork);
    return validateMeshtasticMqttModuleApply(merged, t, deviceNetwork);
  };

  return (
    <div className="w-full space-y-4">
      <h2 className="text-xl font-semibold text-gray-200">{t('modulePanel.title')}</h2>

      {!isConnected && (
        <div className="rounded-lg border border-yellow-700 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-300">
          {t('modulePanel.connectToDevice')}
        </div>
      )}

      {configTarget?.mode === 'remote' && configTarget.isLoading && (
        <p className="text-muted text-sm">{t('configureNode.loading')}</p>
      )}

      {configTarget?.mode === 'remote' && configTarget.error && (
        <p className="text-sm text-red-400">{t(configTarget.error)}</p>
      )}

      <ConfigApplyNotice />

      {Object.keys(moduleConfigs).length === 0 && isConnected && (
        <div className="bg-deep-black/50 text-muted rounded-lg border border-gray-700 px-4 py-3 text-sm">
          {t('modulePanel.waitingForModuleConfig')}
        </div>
      )}

      {/* ═══ MQTT Relay Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionMqttRelay')}
        {...moduleSectionProps('mqtt')}
        onApply={() => {
          const validationError = validateMqttRelayBeforeApply();
          if (validationError) {
            addToast(validationError, 'error');
            return;
          }
          void applyModule(
            t('modulePanel.sectionMqttRelay'),
            'mqtt',
            buildMeshtasticMqttModuleApplyValue(mqttCfg, buildMqttUiValues(), deviceNetwork),
          );
        }}
        applying={applyingSection === 'mqtt'}
        disabled={disabled}
      >
        <ConfigToggle
          label={t('modulePanel.fields.mqttRelayEnabled')}
          checked={mqttEnabled}
          onChange={setMqttEnabled}
          disabled={disabled}
          description={t('modulePanel.fields.mqttRelayEnabledDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.mqttProxyToClientEnabled')}
          checked={mqttProxyToClientChecked}
          onChange={setMqttProxyToClient}
          disabled={disabled || !mqttEnabled || mqttProxyForced}
          description={t('modulePanel.fields.mqttProxyToClientEnabledDesc')}
        />
        <ConfigText
          label={t('modulePanel.fields.serverAddress')}
          value={mqttAddress}
          onChange={setMqttAddress}
          disabled={disabled || !mqttEnabled}
          description={t('modulePanel.fields.serverAddressDesc')}
        />
        <ConfigText
          label={t('modulePanel.fields.username')}
          value={mqttUsername}
          onChange={setMqttUsername}
          disabled={disabled || !mqttEnabled}
        />
        <ConfigText
          label={t('modulePanel.fields.password')}
          value={mqttPassword}
          onChange={setMqttPassword}
          disabled={disabled || !mqttEnabled}
          password
        />
        <ConfigText
          label={t('modulePanel.fields.rootTopic')}
          value={mqttRoot}
          onChange={setMqttRoot}
          disabled={disabled || !mqttEnabled}
          description={t('modulePanel.fields.rootTopicDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.encryptionEnabled')}
          checked={mqttEncryption}
          onChange={setMqttEncryption}
          disabled={disabled || !mqttEnabled}
          description={t('modulePanel.fields.encryptionEnabledDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.jsonOutputEnabled')}
          checked={mqttJson}
          onChange={setMqttJson}
          disabled={disabled || !mqttEnabled}
          description={t('modulePanel.fields.jsonOutputEnabledDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.tlsEnabled')}
          checked={mqttTls}
          onChange={setMqttTls}
          disabled={disabled || !mqttEnabled}
        />
        <ConfigToggle
          label={t('modulePanel.fields.mapReportingEnabled')}
          checked={mqttMapReporting}
          onChange={setMqttMapReporting}
          disabled={disabled || !mqttEnabled}
          description={t('modulePanel.fields.mapReportingEnabledDesc')}
        />
      </ModuleSection>

      {/* ═══ Serial Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionSerialModule')}
        {...moduleSectionProps('serial')}
        onApply={() => {
          const merged = buildMeshtasticModuleApplyValue('serial', serialCfg, {
            enabled: serialEnabled,
            echo: serialEcho,
            rxd: serialRxd,
            txd: serialTxd,
            baud: serialBaud,
            timeout: serialTimeout,
            mode: serialMode,
            overrideConsoleSerialPort: serialOverrideConsole,
          });
          const validationError = validateMeshtasticSerialModuleApply(merged, t);
          if (validationError) {
            addToast(validationError, 'error');
            return;
          }
          void applyModule(t('modulePanel.sectionSerialModule'), 'serial', merged);
        }}
        applying={applyingSection === 'serial'}
        disabled={disabled}
      >
        <ModuleStatus packets={serialMessages} label={t('modulePanel.statusLabels.serial')} />
        <ConfigToggle
          label={t('modulePanel.fields.serialModuleEnabled')}
          checked={serialEnabled}
          onChange={setSerialEnabled}
          disabled={disabled}
          description={t('modulePanel.fields.serialModuleEnabledDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.echoMode')}
          checked={serialEcho}
          onChange={setSerialEcho}
          disabled={disabled || !serialEnabled}
          description={t('modulePanel.fields.serialEchoDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.serialRxd')}
          value={serialRxd}
          onChange={setSerialRxd}
          disabled={disabled || !serialEnabled}
          min={0}
          description={t('modulePanel.fields.serialRxdDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.serialTxd')}
          value={serialTxd}
          onChange={setSerialTxd}
          disabled={disabled || !serialEnabled}
          min={0}
          description={t('modulePanel.fields.serialTxdDesc')}
        />
        <ConfigSelect
          label={t('modulePanel.fields.baudRate')}
          value={serialBaud}
          onChange={setSerialBaud}
          disabled={disabled || !serialEnabled}
          options={[
            { value: 0, label: 'Default' },
            { value: 1, label: '110' },
            { value: 2, label: '300' },
            { value: 3, label: '600' },
            { value: 4, label: '1200' },
            { value: 5, label: '2400' },
            { value: 6, label: '4800' },
            { value: 7, label: '9600' },
            { value: 8, label: '19200' },
            { value: 9, label: '38400' },
            { value: 10, label: '57600' },
            { value: 11, label: '115200' },
            { value: 12, label: '230400' },
            { value: 13, label: '460800' },
            { value: 14, label: '576000' },
            { value: 15, label: '921600' },
          ]}
        />
        <ConfigNumber
          label={t('modulePanel.fields.serialTimeout')}
          value={serialTimeout}
          onChange={setSerialTimeout}
          disabled={disabled || !serialEnabled}
          min={0}
          unit="ms"
          description={t('modulePanel.fields.serialTimeoutDesc')}
        />
        <ConfigSelect
          label={t('modulePanel.fields.serialMode')}
          value={serialMode}
          onChange={setSerialMode}
          disabled={disabled || !serialEnabled}
          options={[
            { value: 0, label: 'Default' },
            { value: 1, label: 'Simple' },
            { value: 2, label: 'Proto' },
            { value: 3, label: 'Text message' },
            { value: 4, label: 'NMEA' },
            { value: 5, label: 'CalTopo' },
            { value: 6, label: 'WS85' },
            { value: 7, label: 'VE.Direct' },
            { value: 8, label: 'MeshSolar config' },
            { value: 9, label: 'Log (all packets)' },
            { value: 10, label: 'Log (text only)' },
          ]}
          description={t('modulePanel.fields.serialModeDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.serialOverrideConsole')}
          checked={serialOverrideConsole}
          onChange={setSerialOverrideConsole}
          disabled={disabled || !serialEnabled}
          description={t('modulePanel.fields.serialOverrideConsoleDesc')}
        />
      </ModuleSection>

      {/* ═══ External Notification Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionExternalNotification')}
        {...moduleSectionProps('externalNotification')}
        onApply={() => {
          applyMeshtasticModule(
            t('modulePanel.sectionExternalNotification'),
            'externalNotification',
            extNotifCfg,
            {
              enabled: extEnabled,
              active: extActive,
              output: extOutput,
              outputBuzzer: extOutputBuzzer,
              outputVibra: extOutputVibra,
              outputMs: extOutputMs,
              nagTimeout: extNagTimeout,
              alertMessage: extAlertMessage,
              alertMessageBuzzer: extAlertMessageBuzzer,
              alertMessageVibra: extAlertMessageVibra,
              alertBell: extAlertBell,
              alertBellBuzzer: extAlertBellBuzzer,
              alertBellVibra: extAlertBellVibra,
              usePwm: extUsePwm,
              useI2sAsBuzzer: extUseI2sAsBuzzer,
            },
          );
        }}
        applying={applyingSection === 'externalNotification'}
        disabled={disabled}
      >
        <ConfigToggle
          label={t('modulePanel.fields.extNotifModuleEnabled')}
          checked={extEnabled}
          onChange={setExtEnabled}
          disabled={disabled}
          description={t('modulePanel.fields.extNotifModuleDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.activeHigh')}
          checked={extActive}
          onChange={setExtActive}
          disabled={disabled || !extEnabled}
          description={t('modulePanel.fields.activeHighDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.primaryOutputGpio')}
          value={extOutput}
          onChange={setExtOutput}
          disabled={disabled || !extEnabled}
          min={0}
          max={48}
          description={t('modulePanel.fields.primaryOutputGpioDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.buzzerGpio')}
          value={extOutputBuzzer}
          onChange={setExtOutputBuzzer}
          disabled={disabled || !extEnabled}
          min={0}
          max={48}
          description={t('modulePanel.fields.buzzerGpioDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.vibrationGpio')}
          value={extOutputVibra}
          onChange={setExtOutputVibra}
          disabled={disabled || !extEnabled}
          min={0}
          max={48}
          description={t('modulePanel.fields.vibrationGpioDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.outputDuration')}
          value={extOutputMs}
          onChange={setExtOutputMs}
          disabled={disabled || !extEnabled}
          min={0}
          max={32767}
          unit="ms"
          description={t('modulePanel.fields.outputDurationDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.nagTimeout')}
          value={extNagTimeout}
          onChange={setExtNagTimeout}
          disabled={disabled || !extEnabled}
          min={0}
          max={32767}
          unit={secondsUnit}
          description={t('modulePanel.fields.nagTimeoutDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.alertOnMessage')}
          checked={extAlertMessage}
          onChange={setExtAlertMessage}
          disabled={disabled || !extEnabled}
          description={t('modulePanel.fields.alertOnMessageDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.buzzerOnMessage')}
          checked={extAlertMessageBuzzer}
          onChange={setExtAlertMessageBuzzer}
          disabled={disabled || !extEnabled || !extAlertMessage}
          description={t('modulePanel.fields.buzzerOnMessageDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.vibrationOnMessage')}
          checked={extAlertMessageVibra}
          onChange={setExtAlertMessageVibra}
          disabled={disabled || !extEnabled || !extAlertMessage}
          description={t('modulePanel.fields.vibrationOnMessageDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.alertOnBell')}
          checked={extAlertBell}
          onChange={setExtAlertBell}
          disabled={disabled || !extEnabled}
          description={t('modulePanel.fields.alertOnBellDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.buzzerOnBell')}
          checked={extAlertBellBuzzer}
          onChange={setExtAlertBellBuzzer}
          disabled={disabled || !extEnabled || !extAlertBell}
          description={t('modulePanel.fields.buzzerOnBellDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.vibrationOnBell')}
          checked={extAlertBellVibra}
          onChange={setExtAlertBellVibra}
          disabled={disabled || !extEnabled || !extAlertBell}
          description={t('modulePanel.fields.vibrationOnBellDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.usePwmBuzzer')}
          checked={extUsePwm}
          onChange={setExtUsePwm}
          disabled={disabled || !extEnabled}
          description={t('modulePanel.fields.usePwmBuzzerDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.useI2sBuzzer')}
          checked={extUseI2sAsBuzzer}
          onChange={setExtUseI2sAsBuzzer}
          disabled={disabled || !extEnabled}
          description={t('modulePanel.fields.useI2sBuzzerDesc')}
        />
      </ModuleSection>

      {/* ═══ Store & Forward Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionStoreForward')}
        {...moduleSectionProps('storeForward')}
        onApply={() => {
          applyMeshtasticModule(t('modulePanel.sectionStoreForward'), 'storeForward', sfCfg, {
            enabled: sfEnabled,
            heartbeat: sfHeartbeat,
            records: sfNumRecords,
            historyReturnMax: sfHistoryMax,
            historyReturnWindow: sfHistoryWindow,
          });
        }}
        applying={applyingSection === 'storeForward'}
        disabled={disabled}
      >
        <ModuleStatus
          packets={storeForwardMessages}
          label={t('modulePanel.statusLabels.storeForward')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.storeForwardEnabled')}
          checked={sfEnabled}
          onChange={setSfEnabled}
          disabled={disabled}
          description={t('modulePanel.fields.sfEnabledDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.sendHeartbeat')}
          checked={sfHeartbeat}
          onChange={setSfHeartbeat}
          disabled={disabled || !sfEnabled}
          description={t('modulePanel.fields.sfHeartbeatDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.maxStoredRecords')}
          value={sfNumRecords}
          onChange={setSfNumRecords}
          disabled={disabled || !sfEnabled}
          min={0}
          description={t('modulePanel.fields.sfNumRecordsDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.historyReturnMax')}
          value={sfHistoryMax}
          onChange={setSfHistoryMax}
          disabled={disabled || !sfEnabled}
          min={1}
          max={300}
          description={t('modulePanel.fields.historyReturnMaxDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.historyReturnWindow')}
          value={sfHistoryWindow}
          onChange={setSfHistoryWindow}
          disabled={disabled || !sfEnabled}
          min={0}
          unit={secondsUnit}
          description={t('modulePanel.fields.historyReturnWindowDesc')}
        />
      </ModuleSection>

      {/* ═══ Range Test Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionRangeTest')}
        {...moduleSectionProps('rangeTest')}
        onApply={() => {
          applyMeshtasticModule(t('modulePanel.sectionRangeTest'), 'rangeTest', rangeCfg, {
            enabled: rangeEnabled,
            sender: rangeSenderInterval,
            save: rangeSave,
          });
        }}
        applying={applyingSection === 'rangeTest'}
        disabled={disabled}
      >
        <ModuleStatus packets={rangeTestPackets} label={t('modulePanel.statusLabels.rangeTest')} />
        <ConfigToggle
          label={t('modulePanel.fields.rangeTestEnabled')}
          checked={rangeEnabled}
          onChange={setRangeEnabled}
          disabled={disabled}
        />
        <ConfigNumber
          label={t('modulePanel.fields.senderInterval')}
          value={rangeSenderInterval}
          onChange={setRangeSenderInterval}
          disabled={disabled || !rangeEnabled}
          min={0}
          max={3600}
          unit={secondsUnit}
          description={t('modulePanel.fields.senderIntervalDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.saveResultsToFile')}
          checked={rangeSave}
          onChange={setRangeSave}
          disabled={disabled || !rangeEnabled}
          description={t('modulePanel.fields.saveResultsToFileDesc')}
        />
      </ModuleSection>

      {/* ═══ Telemetry Module ═══ */}
      {'telemetry' in moduleConfigs && (
        <ModuleSection
          title={t('modulePanel.sectionTelemetryModule')}
          {...moduleSectionProps('telemetry')}
          onApply={() => {
            applyMeshtasticModule(t('modulePanel.sectionTelemetryModule'), 'telemetry', telCfg, {
              deviceTelemetryEnabled: telDeviceTelemetryEnabled,
              deviceUpdateInterval: telDeviceInterval,
              environmentMeasurementEnabled: telEnvEnabled,
              environmentUpdateInterval: telEnvInterval,
              environmentScreenEnabled: telEnvScreenEnabled,
              environmentDisplayFahrenheit: telEnvFahrenheit,
              airQualityEnabled: telAirQualityEnabled,
              airQualityInterval: telAirQualityInterval,
              powerMeasurementEnabled: telPowerEnabled,
              powerUpdateInterval: telPowerInterval,
              powerScreenEnabled: telPowerScreenEnabled,
            });
          }}
          applying={applyingSection === 'telemetry'}
          disabled={disabled}
        >
          <ConfigToggle
            label={t('modulePanel.fields.telDeviceTelemetryEnabled')}
            checked={telDeviceTelemetryEnabled}
            onChange={setTelDeviceTelemetryEnabled}
            disabled={disabled}
            description={t('modulePanel.fields.telDeviceTelemetryEnabledDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.telDeviceInterval')}
            value={telDeviceInterval}
            onChange={setTelDeviceInterval}
            disabled={disabled || !telDeviceTelemetryEnabled}
            min={0}
            max={86400}
            unit={t('radioPanel.secondsUnit')}
            description={t('modulePanel.telemetryDeviceMetricsDescription')}
            tooltip={t('modulePanel.telemetryDeviceMetricsTooltip')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.telEnvEnabled')}
            checked={telEnvEnabled}
            onChange={setTelEnvEnabled}
            disabled={disabled}
            description={t('modulePanel.fields.telEnvEnabledDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.telEnvInterval')}
            value={telEnvInterval}
            onChange={setTelEnvInterval}
            disabled={disabled || !telEnvEnabled}
            min={0}
            max={86400}
            unit={secondsUnit}
            description={t('modulePanel.fields.telEnvIntervalDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.telEnvScreenEnabled')}
            checked={telEnvScreenEnabled}
            onChange={setTelEnvScreenEnabled}
            disabled={disabled || !telEnvEnabled}
            description={t('modulePanel.fields.telEnvScreenEnabledDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.telEnvFahrenheit')}
            checked={telEnvFahrenheit}
            onChange={setTelEnvFahrenheit}
            disabled={disabled || !telEnvEnabled}
            description={t('modulePanel.fields.telEnvFahrenheitDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.telAirQualityEnabled')}
            checked={telAirQualityEnabled}
            onChange={setTelAirQualityEnabled}
            disabled={disabled}
            description={t('modulePanel.fields.telAirQualityEnabledDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.telAirQualityInterval')}
            value={telAirQualityInterval}
            onChange={setTelAirQualityInterval}
            disabled={disabled || !telAirQualityEnabled}
            min={0}
            max={86400}
            unit={secondsUnit}
            description={t('modulePanel.fields.telAirQualityIntervalDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.telPowerEnabled')}
            checked={telPowerEnabled}
            onChange={setTelPowerEnabled}
            disabled={disabled}
            description={t('modulePanel.fields.telPowerEnabledDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.telPowerInterval')}
            value={telPowerInterval}
            onChange={setTelPowerInterval}
            disabled={disabled || !telPowerEnabled}
            min={0}
            max={86400}
            unit={secondsUnit}
            description={t('modulePanel.fields.telPowerIntervalDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.telPowerScreenEnabled')}
            checked={telPowerScreenEnabled}
            onChange={setTelPowerScreenEnabled}
            disabled={disabled || !telPowerEnabled}
            description={t('modulePanel.fields.telPowerScreenEnabledDesc')}
          />
        </ModuleSection>
      )}

      {/* ═══ Canned Messages ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionCannedMessages')}
        {...moduleSectionProps('cannedMessage')}
        onApply={async () => {
          setApplyingSection('cannedMessage');
          try {
            const lines = cannedText
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean);
            await onSetCannedMessages(lines);
            await onSetModuleConfig({
              payloadVariant: {
                case: 'cannedMessage',
                value: mergeMeshtasticConfigApplyValue(cannedCfg, {
                  enabled: cannedEnabled,
                  rotary1Enabled: cannedRotary1Enabled,
                  inputbrokerPinA: cannedPinA,
                  inputbrokerPinB: cannedPinB,
                  inputbrokerPinPress: cannedPinPress,
                  inputbrokerEventCw: cannedEventCw,
                  inputbrokerEventCcw: cannedEventCcw,
                  inputbrokerEventPress: cannedEventPress,
                  updown1Enabled: cannedUpdown1Enabled,
                  allowInputSource: cannedAllowInputSource,
                  sendBell: cannedSendBell,
                }),
              },
            });
            await onCommit();
            addToast(t('modulePanel.cannedMessagesApplied'), 'success');
          } catch (err) {
            console.warn('[ModulePanel] canned messages failed ' + errLikeToLogString(err));
            addToast(
              t('modulePanel.failed', {
                message: formatMeshtasticModuleApplyError(err, t),
              }),
              'error',
            );
          } finally {
            setApplyingSection(null);
          }
        }}
        applying={applyingSection === 'cannedMessage'}
        disabled={disabled || remoteTarget}
      >
        <ConfigToggle
          label={t('modulePanel.fields.cannedMessagesEnabled')}
          checked={cannedEnabled}
          onChange={setCannedEnabled}
          disabled={disabled}
        />
        <ConfigToggle
          label={t('modulePanel.fields.cannedRotary1Enabled')}
          checked={cannedRotary1Enabled}
          onChange={setCannedRotary1Enabled}
          disabled={disabled}
          description={t('modulePanel.fields.cannedRotary1EnabledDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.cannedPinA')}
          value={cannedPinA}
          onChange={setCannedPinA}
          disabled={disabled || !cannedRotary1Enabled}
          min={0}
          description={t('modulePanel.fields.cannedPinADesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.cannedPinB')}
          value={cannedPinB}
          onChange={setCannedPinB}
          disabled={disabled || !cannedRotary1Enabled}
          min={0}
          description={t('modulePanel.fields.cannedPinBDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.cannedPinPress')}
          value={cannedPinPress}
          onChange={setCannedPinPress}
          disabled={disabled || !cannedRotary1Enabled}
          min={0}
          description={t('modulePanel.fields.cannedPinPressDesc')}
        />
        <ConfigSelect
          label={t('modulePanel.fields.cannedEventCw')}
          value={cannedEventCw}
          onChange={setCannedEventCw}
          disabled={disabled || !cannedRotary1Enabled}
          options={INPUT_EVENT_OPTIONS}
          description={t('modulePanel.fields.cannedEventCwDesc')}
        />
        <ConfigSelect
          label={t('modulePanel.fields.cannedEventCcw')}
          value={cannedEventCcw}
          onChange={setCannedEventCcw}
          disabled={disabled || !cannedRotary1Enabled}
          options={INPUT_EVENT_OPTIONS}
          description={t('modulePanel.fields.cannedEventCcwDesc')}
        />
        <ConfigSelect
          label={t('modulePanel.fields.cannedEventPress')}
          value={cannedEventPress}
          onChange={setCannedEventPress}
          disabled={disabled || !cannedRotary1Enabled}
          options={INPUT_EVENT_OPTIONS}
          description={t('modulePanel.fields.cannedEventPressDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.cannedUpdown1Enabled')}
          checked={cannedUpdown1Enabled}
          onChange={setCannedUpdown1Enabled}
          disabled={disabled}
          description={t('modulePanel.fields.cannedUpdown1EnabledDesc')}
        />
        <ConfigText
          label={t('modulePanel.fields.cannedAllowInputSource')}
          value={cannedAllowInputSource}
          onChange={setCannedAllowInputSource}
          disabled={disabled}
          description={t('modulePanel.fields.cannedAllowInputSourceDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.cannedSendBell')}
          checked={cannedSendBell}
          onChange={setCannedSendBell}
          disabled={disabled}
          description={t('modulePanel.fields.cannedSendBellDesc')}
        />
        <div className="space-y-1">
          <label htmlFor="module-canned-messages" className="text-muted text-sm">
            {t('modulePanel.fields.messagesOnePerLine')}
          </label>
          <textarea
            id="module-canned-messages"
            value={cannedText}
            onChange={(e) => {
              setCannedText(e.target.value);
            }}
            disabled={disabled || !cannedEnabled}
            rows={6}
            placeholder={t('modulePanel.fields.cannedMessagesPlaceholder')}
            spellCheck={false}
            className="bg-secondary-dark focus:border-brand-green w-full resize-y rounded-lg border border-gray-600 px-3 py-2 font-mono text-xs text-gray-200 focus:outline-none disabled:opacity-50"
          />
          <p className="text-muted text-xs">{t('modulePanel.fields.cannedMessagesHint')}</p>
        </div>
      </ModuleSection>

      {/* ═══ Neighbor Info Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionNeighborInfo')}
        {...moduleSectionProps('neighborInfo')}
        onApply={() => {
          applyMeshtasticModule(
            t('modulePanel.sectionNeighborInfo'),
            'neighborInfo',
            neighborInfoCfg,
            {
              enabled: neighborInfoEnabled,
              updateInterval: neighborInfoUpdateInterval,
              transmitOverLora: neighborInfoTransmitOverLora,
            },
          );
        }}
        applying={applyingSection === 'neighborInfo'}
        disabled={disabled}
      >
        <ConfigToggle
          label={t('modulePanel.fields.neighborInfoEnabled')}
          checked={neighborInfoEnabled}
          onChange={setNeighborInfoEnabled}
          disabled={disabled}
          description={t('modulePanel.fields.neighborInfoEnabledDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.neighborInfoUpdateInterval')}
          value={neighborInfoUpdateInterval}
          onChange={setNeighborInfoUpdateInterval}
          disabled={disabled || !neighborInfoEnabled}
          min={0}
          unit={secondsUnit}
          description={t('modulePanel.fields.neighborInfoUpdateIntervalDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.neighborInfoTransmitOverLora')}
          checked={neighborInfoTransmitOverLora}
          onChange={setNeighborInfoTransmitOverLora}
          disabled={disabled || !neighborInfoEnabled}
          description={t('modulePanel.fields.neighborInfoTransmitOverLoraDesc')}
        />
      </ModuleSection>

      {/* ═══ Ambient Lighting Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionAmbientLighting')}
        {...moduleSectionProps('ambientLighting')}
        onApply={() => {
          applyMeshtasticModule(
            t('modulePanel.sectionAmbientLighting'),
            'ambientLighting',
            ambientCfg,
            {
              ledState: ambientLedState,
              red: ambientRed,
              green: ambientGreen,
              blue: ambientBlue,
              current: ambientCurrent,
            },
          );
        }}
        applying={applyingSection === 'ambientLighting'}
        disabled={disabled}
      >
        <ConfigToggle
          label={t('modulePanel.fields.ledEnabled')}
          checked={ambientLedState}
          onChange={setAmbientLedState}
          disabled={disabled}
          description={t('modulePanel.fields.ledEnabledDesc')}
        />
        <div className="space-y-1">
          <label htmlFor="module-ambient-color" className="text-muted text-sm">
            {t('modulePanel.fields.color')}
          </label>
          <div className="flex items-center gap-3">
            <input
              id="module-ambient-color"
              type="color"
              value={ambientHex}
              onChange={(e) => {
                handleAmbientColorChange(e.target.value);
              }}
              disabled={disabled || !ambientLedState}
              className="bg-secondary-dark h-9 w-16 cursor-pointer rounded border border-gray-600 p-0.5 disabled:opacity-50"
            />
            <span className="font-mono text-sm text-gray-400">{ambientHex.toUpperCase()}</span>
            <span className="text-muted text-xs">
              R:{ambientRed} G:{ambientGreen} B:{ambientBlue}
            </span>
          </div>
        </div>
        <div className="space-y-1">
          <label htmlFor="module-ambient-current" className="text-muted text-sm">
            {t('modulePanel.fields.brightnessCurrent', { value: ambientCurrent })}
          </label>
          <input
            id="module-ambient-current"
            type="range"
            min={0}
            max={31}
            value={ambientCurrent}
            onChange={(e) => {
              setAmbientCurrent(Number(e.target.value));
            }}
            disabled={disabled || !ambientLedState}
            className="accent-readable-green w-full disabled:opacity-50"
          />
          <p className="text-muted text-xs">{t('modulePanel.fields.brightnessHint')}</p>
        </div>
      </ModuleSection>

      {/* ═══ Detection Sensor Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionDetectionSensor')}
        {...moduleSectionProps('detectionSensor')}
        onApply={() => {
          applyMeshtasticModule(
            t('modulePanel.sectionDetectionSensor'),
            'detectionSensor',
            detectCfg,
            {
              enabled: detectEnabled,
              name: detectName,
              minimumBroadcastSecs: detectMinBroadcast,
              stateBroadcastSecs: detectStateBroadcast,
            },
          );
        }}
        applying={applyingSection === 'detectionSensor'}
        disabled={disabled}
      >
        <ConfigToggle
          label={t('modulePanel.fields.detectionSensorEnabled')}
          checked={detectEnabled}
          onChange={setDetectEnabled}
          disabled={disabled}
          description={t('modulePanel.fields.detectionSensorDesc')}
        />
        <ConfigText
          label={t('modulePanel.fields.sensorName')}
          value={detectName}
          onChange={setDetectName}
          disabled={disabled || !detectEnabled}
          description={t('modulePanel.fields.sensorNameDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.minBroadcastInterval')}
          value={detectMinBroadcast}
          onChange={setDetectMinBroadcast}
          disabled={disabled || !detectEnabled}
          min={0}
          unit={secondsUnit}
          description={t('modulePanel.fields.minBroadcastIntervalDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.stateBroadcastInterval')}
          value={detectStateBroadcast}
          onChange={setDetectStateBroadcast}
          disabled={disabled || !detectEnabled}
          min={0}
          unit={secondsUnit}
          description={t('modulePanel.fields.stateBroadcastIntervalDesc')}
        />
      </ModuleSection>

      {/* ═══ Remote Hardware Module ═══ */}
      {'remoteHardware' in moduleConfigs && (
        <ModuleSection
          title={t('modulePanel.sectionRemoteHardware')}
          {...moduleSectionProps('remoteHardware')}
          onApply={() => {
            applyMeshtasticModule(
              t('modulePanel.sectionRemoteHardware'),
              'remoteHardware',
              remoteHardwareCfg,
              {
                enabled: remoteHardwareEnabled,
                allowUndefinedPinAccess: remoteHardwareEnabled && remoteHardwareAllowUndefinedPins,
              },
            );
          }}
          applying={applyingSection === 'remoteHardware'}
          disabled={disabled}
        >
          {remoteHardwareMessages != null && (
            <ModuleStatus
              packets={remoteHardwareMessages}
              label={t('modulePanel.statusLabels.gpio')}
            />
          )}
          <ConfigToggle
            label={t('modulePanel.fields.remoteHardwareEnabled')}
            checked={remoteHardwareEnabled}
            onChange={(enabled) => {
              if (enabled && !remoteHardwareEnabled) {
                setRhPendingConfirm('enable');
                return;
              }
              setRemoteHardwareEnabled(enabled);
              if (!enabled) setRemoteHardwareAllowUndefinedPins(false);
            }}
            disabled={disabled}
            description={t('modulePanel.fields.remoteHardwareEnabledDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.remoteHardwareAllowUndefinedPins')}
            checked={remoteHardwareAllowUndefinedPins}
            onChange={(allow) => {
              if (allow && !remoteHardwareAllowUndefinedPins) {
                setRhPendingConfirm('undefinedPins');
                return;
              }
              setRemoteHardwareAllowUndefinedPins(allow);
            }}
            disabled={disabled || !remoteHardwareEnabled}
            description={t('modulePanel.fields.remoteHardwareAllowUndefinedPinsDesc')}
          />
          <p className="text-muted text-xs">{t('modulePanel.fields.remoteHardwareHint')}</p>
        </ModuleSection>
      )}

      {/* ═══ Pax Counter Module ═══ */}
      {'paxcounter' in moduleConfigs && (
        <ModuleSection
          title={t('modulePanel.sectionPaxCounter')}
          {...moduleSectionProps('paxcounter')}
          onApply={() => {
            applyMeshtasticModule(t('modulePanel.sectionPaxCounter'), 'paxcounter', paxCfg, {
              enabled: paxEnabled,
              paxcounterUpdateInterval: paxInterval,
            });
          }}
          applying={applyingSection === 'paxcounter'}
          disabled={disabled}
        >
          <ConfigToggle
            label={t('modulePanel.fields.paxCounterEnabled')}
            checked={paxEnabled}
            onChange={setPaxEnabled}
            disabled={disabled}
            description={t('modulePanel.fields.paxCounterEnabledDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.paxUpdateInterval')}
            value={paxInterval}
            onChange={setPaxInterval}
            disabled={disabled || !paxEnabled}
            min={0}
            unit={secondsUnit}
            description={t('modulePanel.fields.paxUpdateIntervalDesc')}
          />
        </ModuleSection>
      )}

      {/* ═══ Traffic Management Module ═══ */}
      {'trafficManagement' in moduleConfigs && (
        <ModuleSection
          title={t('modulePanel.sectionTrafficManagement')}
          {...moduleSectionProps('trafficManagement')}
          onApply={() => {
            applyMeshtasticModule(
              t('modulePanel.sectionTrafficManagement'),
              'trafficManagement',
              trafficMgmtCfg,
              {
                enabled: tmEnabled,
                positionDedupEnabled: tmPositionDedupEnabled,
                positionPrecisionBits: tmPositionPrecisionBits,
                positionMinIntervalSecs: tmPositionMinIntervalSecs,
                nodeinfoDirectResponse: tmNodeinfoDirectResponse,
                nodeinfoDirectResponseMaxHops: tmNodeinfoDirectResponseMaxHops,
                rateLimitEnabled: tmRateLimitEnabled,
                rateLimitWindowSecs: tmRateLimitWindowSecs,
                rateLimitMaxPackets: tmRateLimitMaxPackets,
                dropUnknownEnabled: tmDropUnknownEnabled,
                unknownPacketThreshold: tmUnknownPacketThreshold,
                exhaustHopTelemetry: tmExhaustHopTelemetry,
                exhaustHopPosition: tmExhaustHopPosition,
                routerPreserveHops: tmRouterPreserveHops,
              },
            );
          }}
          applying={applyingSection === 'trafficManagement'}
          disabled={disabled}
        >
          <ConfigToggle
            label={t('modulePanel.fields.tmEnabled')}
            checked={tmEnabled}
            onChange={setTmEnabled}
            disabled={disabled}
            description={t('modulePanel.fields.tmEnabledDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.tmPositionDedupEnabled')}
            checked={tmPositionDedupEnabled}
            onChange={setTmPositionDedupEnabled}
            disabled={disabled || !tmEnabled}
            description={t('modulePanel.fields.tmPositionDedupEnabledDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.tmPositionPrecisionBits')}
            value={tmPositionPrecisionBits}
            onChange={setTmPositionPrecisionBits}
            disabled={disabled || !tmEnabled || !tmPositionDedupEnabled}
            min={0}
            max={32}
            description={t('modulePanel.fields.tmPositionPrecisionBitsDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.tmPositionMinIntervalSecs')}
            value={tmPositionMinIntervalSecs}
            onChange={setTmPositionMinIntervalSecs}
            disabled={disabled || !tmEnabled}
            min={0}
            unit={secondsUnit}
            description={t('modulePanel.fields.tmPositionMinIntervalSecsDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.tmNodeinfoDirectResponse')}
            checked={tmNodeinfoDirectResponse}
            onChange={setTmNodeinfoDirectResponse}
            disabled={disabled || !tmEnabled}
            description={t('modulePanel.fields.tmNodeinfoDirectResponseDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.tmNodeinfoDirectResponseMaxHops')}
            value={tmNodeinfoDirectResponseMaxHops}
            onChange={setTmNodeinfoDirectResponseMaxHops}
            disabled={disabled || !tmEnabled || !tmNodeinfoDirectResponse}
            min={0}
            description={t('modulePanel.fields.tmNodeinfoDirectResponseMaxHopsDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.tmRateLimitEnabled')}
            checked={tmRateLimitEnabled}
            onChange={setTmRateLimitEnabled}
            disabled={disabled || !tmEnabled}
            description={t('modulePanel.fields.tmRateLimitEnabledDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.tmRateLimitWindowSecs')}
            value={tmRateLimitWindowSecs}
            onChange={setTmRateLimitWindowSecs}
            disabled={disabled || !tmEnabled || !tmRateLimitEnabled}
            min={0}
            unit={secondsUnit}
            description={t('modulePanel.fields.tmRateLimitWindowSecsDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.tmRateLimitMaxPackets')}
            value={tmRateLimitMaxPackets}
            onChange={setTmRateLimitMaxPackets}
            disabled={disabled || !tmEnabled || !tmRateLimitEnabled}
            min={0}
            description={t('modulePanel.fields.tmRateLimitMaxPacketsDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.tmDropUnknownEnabled')}
            checked={tmDropUnknownEnabled}
            onChange={setTmDropUnknownEnabled}
            disabled={disabled || !tmEnabled}
            description={t('modulePanel.fields.tmDropUnknownEnabledDesc')}
          />
          <ConfigNumber
            label={t('modulePanel.fields.tmUnknownPacketThreshold')}
            value={tmUnknownPacketThreshold}
            onChange={setTmUnknownPacketThreshold}
            disabled={disabled || !tmEnabled || !tmDropUnknownEnabled}
            min={0}
            description={t('modulePanel.fields.tmUnknownPacketThresholdDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.tmExhaustHopTelemetry')}
            checked={tmExhaustHopTelemetry}
            onChange={setTmExhaustHopTelemetry}
            disabled={disabled || !tmEnabled}
            description={t('modulePanel.fields.tmExhaustHopTelemetryDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.tmExhaustHopPosition')}
            checked={tmExhaustHopPosition}
            onChange={setTmExhaustHopPosition}
            disabled={disabled || !tmEnabled}
            description={t('modulePanel.fields.tmExhaustHopPositionDesc')}
          />
          <ConfigToggle
            label={t('modulePanel.fields.tmRouterPreserveHops')}
            checked={tmRouterPreserveHops}
            onChange={setTmRouterPreserveHops}
            disabled={disabled || !tmEnabled}
            description={t('modulePanel.fields.tmRouterPreserveHopsDesc')}
          />
        </ModuleSection>
      )}

      {/* ═══ TAK Module ═══ */}
      {'tak' in moduleConfigs && (
        <ModuleSection
          title={t('modulePanel.sectionTak')}
          {...moduleSectionProps('tak')}
          onApply={() => {
            applyMeshtasticModule(t('modulePanel.sectionTak'), 'tak', takCfg, {
              team: takTeam,
              role: takRole,
            });
          }}
          applying={applyingSection === 'tak'}
          disabled={disabled}
        >
          <ConfigSelect
            label={t('modulePanel.fields.takTeam')}
            value={takTeam}
            onChange={setTakTeam}
            disabled={disabled}
            description={t('modulePanel.fields.takTeamDesc')}
            options={[
              { value: 0, label: t('modulePanel.fields.takTeamUnspecified') },
              { value: 1, label: 'White' },
              { value: 2, label: 'Yellow' },
              { value: 3, label: 'Orange' },
              { value: 4, label: 'Magenta' },
              { value: 5, label: 'Red' },
              { value: 6, label: 'Maroon' },
              { value: 7, label: 'Purple' },
              { value: 8, label: 'Dark Blue' },
              { value: 9, label: 'Blue' },
              { value: 10, label: 'Cyan' },
              { value: 11, label: 'Teal' },
              { value: 12, label: 'Green' },
              { value: 13, label: 'Dark Green' },
              { value: 14, label: 'Brown' },
            ]}
          />
          <ConfigSelect
            label={t('modulePanel.fields.takRole')}
            value={takRole}
            onChange={setTakRole}
            disabled={disabled}
            description={t('modulePanel.fields.takRoleDesc')}
            options={[
              { value: 0, label: t('modulePanel.fields.takRoleUnspecified') },
              { value: 1, label: 'Team Member' },
              { value: 2, label: 'Team Lead' },
              { value: 3, label: 'HQ' },
              { value: 4, label: 'Sniper' },
              { value: 5, label: 'Medic' },
              { value: 6, label: 'Forward Observer' },
              { value: 7, label: 'RTO' },
              { value: 8, label: 'K9' },
            ]}
          />
        </ModuleSection>
      )}

      {/* ═══ RTTTL Ringtone ═══ */}
      {onSetRingtone && (
        <ModuleSection
          title={t('modulePanel.sectionRtttlRingtone')}
          onApply={async () => {
            if (ringtoneText.length > 0 && !isValidRtttl(ringtoneText)) {
              addToast(t('modulePanel.fields.invalidRtttl'), 'error');
              return;
            }
            setApplyingSection('rtttlRingtone');
            try {
              await onSetRingtone(ringtoneText);
              await onCommit();
              addToast(t('modulePanel.rtttlSaved'), 'success');
            } catch (err) {
              console.warn('[ModulePanel] RTTTL apply failed ' + errLikeToLogString(err));
              addToast(
                t('modulePanel.failed', {
                  message: formatMeshtasticModuleApplyError(err, t),
                }),
                'error',
              );
            } finally {
              setApplyingSection(null);
            }
          }}
          applying={applyingSection === 'rtttlRingtone'}
          disabled={disabled || remoteTarget}
          globalApplyLocked={applyingSection !== null}
        >
          <div className="space-y-1">
            <label htmlFor="module-rtttl-preset" className="text-muted text-sm">
              {t('modulePanel.fields.loadPreset')}
            </label>
            <select
              id="module-rtttl-preset"
              disabled={disabled}
              className="bg-secondary-dark focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 focus:outline-none disabled:opacity-50"
              value=""
              onChange={(e) => {
                if (e.target.value) setRingtoneText(e.target.value);
              }}
            >
              <option value="">{t('modulePanel.selectPreset')}</option>
              {RTTTL_PRESETS.map((p) => (
                <option key={p.name} value={p.value}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="module-rtttl-ringtone" className="text-muted text-sm">
              {t('modulePanel.fields.ringtoneStringLabel')}
            </label>
            <textarea
              id="module-rtttl-ringtone"
              value={ringtoneText}
              onChange={(e) => {
                setRingtoneText(e.target.value.slice(0, 230));
              }}
              disabled={disabled}
              rows={4}
              placeholder={t('modulePanel.fields.rtttlPlaceholder')}
              spellCheck={false}
              className="bg-secondary-dark focus:border-brand-green w-full resize-y rounded-lg border border-gray-600 px-3 py-2 font-mono text-xs text-gray-200 focus:outline-none disabled:opacity-50"
            />
            <div className="text-muted flex justify-between text-xs">
              <span>
                {ringtoneText.length > 0 && !isValidRtttl(ringtoneText) && (
                  <span className="text-red-400">{t('modulePanel.fields.invalidRtttl')}</span>
                )}
              </span>
              <span>{ringtoneText.length}/230</span>
            </div>
          </div>
        </ModuleSection>
      )}

      {/* ═══ IP Tunnel ═══ */}
      {ipTunnelMessages != null && (
        <StatusOnlySection title={t('modulePanel.sectionIpTunnel')}>
          <ModuleStatus packets={ipTunnelMessages} label={t('modulePanel.statusLabels.ipTunnel')} />
          <p className="text-muted text-xs">{t('modulePanel.fields.ipTunnelHint')}</p>
        </StatusOnlySection>
      )}

      {rhPendingConfirm === 'enable' && (
        <ConfirmModal
          title={t('modulePanel.remoteHardwareConfirmEnableTitle')}
          message={t('modulePanel.remoteHardwareConfirmEnableMessage')}
          confirmLabel={t('modulePanel.remoteHardwareConfirmEnableLabel')}
          onConfirm={() => {
            setRemoteHardwareEnabled(true);
            setRhPendingConfirm(null);
          }}
          onCancel={() => {
            setRhPendingConfirm(null);
          }}
        />
      )}
      {rhPendingConfirm === 'undefinedPins' && (
        <ConfirmModal
          title={t('modulePanel.remoteHardwareConfirmUndefinedPinsTitle')}
          message={t('modulePanel.remoteHardwareConfirmUndefinedPinsMessage')}
          confirmLabel={t('modulePanel.remoteHardwareConfirmUndefinedPinsLabel')}
          danger
          onConfirm={() => {
            setRemoteHardwareAllowUndefinedPins(true);
            setRhPendingConfirm(null);
          }}
          onCancel={() => {
            setRhPendingConfirm(null);
          }}
        />
      )}
    </div>
  );
}
