import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { formatMeshtasticModuleApplyError } from '@/renderer/lib/meshtastic/meshtasticApplyErrorMessage';
import {
  buildMeshtasticMqttModuleApplyValue,
  type MeshtasticDeviceNetworkCapabilities,
  meshtasticDeviceRequiresMqttProxyToClient,
  validateMeshtasticMqttModuleApply,
} from '@/renderer/lib/meshtastic/meshtasticMqttModuleApply';
import { MS_PER_MINUTE } from '@/renderer/lib/timeConstants';
import type { ConfigTargetContext } from '@/renderer/lib/types';

import { HelpTooltip } from './HelpTooltip';
import { useToast } from './Toast';

interface PacketMessage {
  from: number;
  data: Uint8Array;
  timestamp: number;
}

/** Narrow unknown module config payloads from IPC/protobuf to a plain record for field reads. */
function moduleConfigSlice(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
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
  ipTunnelMessages?: Map<number, PacketMessage[]>;
}

// ─── Reusable config components (same pattern as RadioPanel) ─────

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
}: {
  title: string;
  children: React.ReactNode;
  onApply: () => void;
  applying: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
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
        <button
          type="button"
          onClick={onApply}
          disabled={disabled || applying}
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

function StatusOnlySection({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <details className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>{title}</span>
        <span className="text-xs text-gray-500">{t('modulePanel.readOnly')}</span>
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}

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
  const disabled = !isConnected || (configTarget?.mode === 'remote' && !configTarget.isReady);
  const remoteTarget = configTarget?.mode === 'remote';
  const [applyingSection, setApplyingSection] = useState<string | null>(null);

  // ─── Telemetry module ──────────────────────────────────────────
  const telCfg = moduleConfigSlice(moduleConfigs.telemetry);
  const [telDeviceInterval, setTelDeviceInterval] = useState<number>(
    cfgNum(telCfg.deviceUpdateInterval, 1800),
  );
  const [telEnvInterval, setTelEnvInterval] = useState<number>(
    cfgNum(telCfg.environmentUpdateInterval, 1800),
  );
  const [telEnvEnabled, setTelEnvEnabled] = useState<boolean>(
    cfgBool(telCfg.environmentMeasurementEnabled, false),
  );
  const [telPowerEnabled, setTelPowerEnabled] = useState<boolean>(
    cfgBool(telCfg.powerMeasurementEnabled, false),
  );
  const [telAirQualityEnabled, setTelAirQualityEnabled] = useState<boolean>(
    cfgBool(telCfg.airQualityEnabled, false),
  );

  // ─── MQTT relay module ─────────────────────────────────────────
  const mqttCfg = moduleConfigSlice(moduleConfigs.mqtt);
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

  useEffect(() => {
    const cfg = moduleConfigSlice(moduleConfigs.mqtt);
    if (Object.keys(cfg).length === 0) return;
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
  }, [moduleConfigs.mqtt]);

  useEffect(() => {
    if (mqttEnabled && meshtasticDeviceRequiresMqttProxyToClient(deviceNetwork)) {
      setMqttProxyToClient(true);
    }
  }, [mqttEnabled, deviceNetwork?.hasWifi, deviceNetwork?.hasEthernet, deviceNetwork]);

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
    proxyToClientEnabled: mqttProxyToClient,
  });

  // ─── Canned messages ──────────────────────────────────────────
  const cannedCfg = moduleConfigSlice(moduleConfigs.cannedMessage);
  const [cannedEnabled, setCannedEnabled] = useState<boolean>(cfgBool(cannedCfg.enabled, false));
  const [cannedText, setCannedText] = useState<string>(cfgStr(cannedCfg.messages, ''));

  // ─── Serial module ─────────────────────────────────────────────
  const serialCfg = moduleConfigSlice(moduleConfigs.serial);
  const [serialEnabled, setSerialEnabled] = useState<boolean>(cfgBool(serialCfg.enabled, false));
  const [serialEcho, setSerialEcho] = useState<boolean>(cfgBool(serialCfg.echo, false));
  const [serialBaud, setSerialBaud] = useState<number>(cfgNum(serialCfg.baud, 38400));

  // ─── Range test module ─────────────────────────────────────────
  const rangeCfg = moduleConfigSlice(moduleConfigs.rangeTest);
  const [rangeEnabled, setRangeEnabled] = useState<boolean>(cfgBool(rangeCfg.enabled, false));
  const [rangeSenderInterval, setRangeSenderInterval] = useState<number>(
    cfgNum(rangeCfg.sender, 0),
  );
  const [rangeSave, setRangeSave] = useState<boolean>(cfgBool(rangeCfg.save, false));

  // ─── Store and Forward module ──────────────────────────────────
  const sfCfg = moduleConfigSlice(moduleConfigs.storeForward);
  const [sfEnabled, setSfEnabled] = useState<boolean>(cfgBool(sfCfg.enabled, false));
  const [sfHeartbeat, setSfHeartbeat] = useState<boolean>(cfgBool(sfCfg.heartbeat, false));
  const [sfNumRecords, setSfNumRecords] = useState<number>(cfgNum(sfCfg.numRecords, 0));
  const [sfHistoryMax, setSfHistoryMax] = useState<number>(cfgNum(sfCfg.historyReturnMax, 25));
  const [sfHistoryWindow, setSfHistoryWindow] = useState<number>(
    cfgNum(sfCfg.historyReturnWindow, 7200),
  );

  // ─── Detection sensor module ──────────────────────────────────
  const detectCfg = moduleConfigSlice(moduleConfigs.detectionSensor);
  const [detectEnabled, setDetectEnabled] = useState<boolean>(cfgBool(detectCfg.enabled, false));
  const [detectName, setDetectName] = useState<string>(cfgStr(detectCfg.name, ''));
  const [detectMinBroadcast, setDetectMinBroadcast] = useState<number>(
    cfgNum(detectCfg.minimumBroadcastSecs, 0),
  );
  const [detectStateBroadcast, setDetectStateBroadcast] = useState<number>(
    cfgNum(detectCfg.stateBroadcastSecs, 0),
  );

  // ─── Pax counter module ────────────────────────────────────────
  const paxCfg = moduleConfigSlice(moduleConfigs.paxcounter);
  const [paxEnabled, setPaxEnabled] = useState<boolean>(cfgBool(paxCfg.enabled, false));
  const [paxInterval, setPaxInterval] = useState<number>(
    cfgNum(paxCfg.paxcounterUpdateInterval, 0),
  );

  // ─── External Notification module ─────────────────────────────
  const extNotifCfg = moduleConfigSlice(moduleConfigs.externalNotification);
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
  const ambientCfg = moduleConfigSlice(moduleConfigs.ambientLighting);
  const [ambientLedState, setAmbientLedState] = useState<boolean>(
    cfgBool(ambientCfg.ledState, false),
  );
  const [ambientRed, setAmbientRed] = useState<number>(cfgNum(ambientCfg.red, 0));
  const [ambientGreen, setAmbientGreen] = useState<number>(cfgNum(ambientCfg.green, 0));
  const [ambientBlue, setAmbientBlue] = useState<number>(cfgNum(ambientCfg.blue, 0));
  const [ambientCurrent, setAmbientCurrent] = useState<number>(cfgNum(ambientCfg.current, 10));

  // ─── RTTTL Ringtone ───────────────────────────────────────────
  const [ringtoneText, setRingtoneText] = useState<string>(ringtone ?? '');

  const ambientHex = `#${[ambientRed, ambientGreen, ambientBlue].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const handleAmbientColorChange = (hex: string) => {
    setAmbientRed(parseInt(hex.slice(1, 3), 16));
    setAmbientGreen(parseInt(hex.slice(3, 5), 16));
    setAmbientBlue(parseInt(hex.slice(5, 7), 16));
  };

  const applyModule = async (sectionName: string, moduleCase: string, value: unknown) => {
    setApplyingSection(sectionName);
    try {
      await onSetModuleConfig({ payloadVariant: { case: moduleCase, value } });
      addToast(t('modulePanel.sectionSent', { name: sectionName }), 'success');
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

      {Object.keys(moduleConfigs).length === 0 && isConnected && (
        <div className="bg-deep-black/50 text-muted rounded-lg border border-gray-700 px-4 py-3 text-sm">
          {t('modulePanel.waitingForModuleConfig')}
        </div>
      )}

      {/* ═══ Ambient Lighting Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionAmbientLighting')}
        onApply={() => {
          void applyModule('Ambient Lighting', 'ambientLighting', {
            ledState: ambientLedState,
            red: ambientRed,
            green: ambientGreen,
            blue: ambientBlue,
            current: ambientCurrent,
          });
        }}
        applying={applyingSection === 'Ambient Lighting'}
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

      {/* ═══ Canned Messages ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionCannedMessages')}
        onApply={async () => {
          setApplyingSection('Canned Messages');
          try {
            const lines = cannedText
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean);
            await onSetCannedMessages(lines);
            await onSetModuleConfig({
              payloadVariant: {
                case: 'cannedMessage',
                value: { enabled: cannedEnabled },
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
        applying={applyingSection === 'Canned Messages'}
        disabled={disabled || remoteTarget}
      >
        <ConfigToggle
          label={t('modulePanel.fields.cannedMessagesEnabled')}
          checked={cannedEnabled}
          onChange={setCannedEnabled}
          disabled={disabled}
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

      {/* ═══ Detection Sensor Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionDetectionSensor')}
        onApply={() => {
          void applyModule('Detection Sensor', 'detectionSensor', {
            enabled: detectEnabled,
            name: detectName,
            minimumBroadcastSecs: detectMinBroadcast,
            stateBroadcastSecs: detectStateBroadcast,
          });
        }}
        applying={applyingSection === 'Detection Sensor'}
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
          unit="seconds"
          description={t('modulePanel.fields.minBroadcastIntervalDesc')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.stateBroadcastInterval')}
          value={detectStateBroadcast}
          onChange={setDetectStateBroadcast}
          disabled={disabled || !detectEnabled}
          min={0}
          unit="seconds"
          description={t('modulePanel.fields.stateBroadcastIntervalDesc')}
        />
      </ModuleSection>

      {/* ═══ External Notification Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionExternalNotification')}
        onApply={() => {
          void applyModule('External Notification', 'externalNotification', {
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
          });
        }}
        applying={applyingSection === 'External Notification'}
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
          unit="seconds"
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

      {/* ═══ IP Tunnel ═══ */}
      <StatusOnlySection title={t('modulePanel.sectionIpTunnel')}>
        <ModuleStatus packets={ipTunnelMessages} label={t('modulePanel.statusLabels.ipTunnel')} />
        <p className="text-muted text-xs">{t('modulePanel.fields.ipTunnelHint')}</p>
      </StatusOnlySection>

      {/* ═══ MQTT Relay Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionMqttRelay')}
        onApply={() => {
          const validationError = validateMqttRelayBeforeApply();
          if (validationError) {
            addToast(validationError, 'error');
            return;
          }
          void applyModule(
            'MQTT Relay',
            'mqtt',
            buildMeshtasticMqttModuleApplyValue(mqttCfg, buildMqttUiValues(), deviceNetwork),
          );
        }}
        applying={applyingSection === 'MQTT Relay'}
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
          checked={mqttProxyToClient}
          onChange={setMqttProxyToClient}
          disabled={disabled || !mqttEnabled}
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

      {/* ═══ Pax Counter Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionPaxCounter')}
        onApply={() => {
          void applyModule('Pax Counter', 'paxcounter', {
            enabled: paxEnabled,
            paxcounterUpdateInterval: paxInterval,
          });
        }}
        applying={applyingSection === 'Pax Counter'}
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
          unit="seconds"
          description={t('modulePanel.fields.paxUpdateIntervalDesc')}
        />
      </ModuleSection>

      {/* ═══ Remote Hardware ═══ */}
      <StatusOnlySection title={t('modulePanel.sectionRemoteHardware')}>
        <ModuleStatus packets={remoteHardwareMessages} label={t('modulePanel.statusLabels.gpio')} />
        <p className="text-muted text-xs">{t('modulePanel.fields.remoteHardwareHint')}</p>
      </StatusOnlySection>

      {/* ═══ Range Test Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionRangeTest')}
        onApply={() => {
          void applyModule('Range Test', 'rangeTest', {
            enabled: rangeEnabled,
            sender: rangeSenderInterval,
            save: rangeSave,
          });
        }}
        applying={applyingSection === 'Range Test'}
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
          unit="seconds"
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

      {/* ═══ RTTTL Ringtone ═══ */}
      {onSetRingtone && (
        <ModuleSection
          title={t('modulePanel.sectionRtttlRingtone')}
          onApply={async () => {
            setApplyingSection('RTTTL Ringtone');
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
          applying={applyingSection === 'RTTTL Ringtone'}
          disabled={disabled || remoteTarget}
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

      {/* ═══ Serial Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionSerialModule')}
        onApply={() => {
          void applyModule('Serial Module', 'serial', {
            enabled: serialEnabled,
            echo: serialEcho,
            baud: serialBaud,
          });
        }}
        applying={applyingSection === 'Serial Module'}
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
        <div className="space-y-1">
          <label htmlFor="module-serial-baud" className="text-muted text-sm">
            {t('modulePanel.fields.baudRate')}
          </label>
          <select
            id="module-serial-baud"
            value={serialBaud}
            onChange={(e) => {
              setSerialBaud(Number(e.target.value));
            }}
            disabled={disabled || !serialEnabled}
            className="bg-secondary-dark focus:border-brand-green w-full rounded-lg border border-gray-600 px-3 py-2 text-gray-200 focus:outline-none disabled:opacity-50"
          >
            {[9600, 19200, 38400, 57600, 115200, 230400].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </ModuleSection>

      {/* ═══ Store & Forward Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionStoreForward')}
        onApply={() => {
          void applyModule('Store & Forward', 'storeForward', {
            enabled: sfEnabled,
            heartbeat: sfHeartbeat,
            numRecords: sfNumRecords,
            historyReturnMax: sfHistoryMax,
            historyReturnWindow: sfHistoryWindow,
          });
        }}
        applying={applyingSection === 'Store & Forward'}
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
          unit="seconds"
          description={t('modulePanel.fields.historyReturnWindowDesc')}
        />
      </ModuleSection>

      {/* ═══ Telemetry Module ═══ */}
      <ModuleSection
        title={t('modulePanel.sectionTelemetryModule')}
        onApply={() => {
          void applyModule('Telemetry Module', 'telemetry', {
            deviceUpdateInterval: telDeviceInterval,
            environmentUpdateInterval: telEnvInterval,
            environmentMeasurementEnabled: telEnvEnabled,
            powerMeasurementEnabled: telPowerEnabled,
            airQualityEnabled: telAirQualityEnabled,
          });
        }}
        applying={applyingSection === 'Telemetry Module'}
        disabled={disabled}
      >
        <ConfigNumber
          label={t('modulePanel.fields.telDeviceInterval')}
          value={telDeviceInterval}
          onChange={setTelDeviceInterval}
          disabled={disabled}
          min={0}
          max={86400}
          unit="seconds"
          description={t('modulePanel.telemetryDeviceMetricsDescription')}
          tooltip={t('modulePanel.telemetryDeviceMetricsTooltip')}
        />
        <ConfigNumber
          label={t('modulePanel.fields.telEnvInterval')}
          value={telEnvInterval}
          onChange={setTelEnvInterval}
          disabled={disabled}
          min={0}
          max={86400}
          unit="seconds"
          description={t('modulePanel.fields.telEnvIntervalDesc')}
        />
        <ConfigToggle
          label={t('modulePanel.fields.telEnvEnabled')}
          checked={telEnvEnabled}
          onChange={setTelEnvEnabled}
          disabled={disabled}
        />
        <ConfigToggle
          label={t('modulePanel.fields.telPowerEnabled')}
          checked={telPowerEnabled}
          onChange={setTelPowerEnabled}
          disabled={disabled}
        />
        <ConfigToggle
          label={t('modulePanel.fields.telAirQualityEnabled')}
          checked={telAirQualityEnabled}
          onChange={setTelAirQualityEnabled}
          disabled={disabled}
        />
      </ModuleSection>
    </div>
  );
}
