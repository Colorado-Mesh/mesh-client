import { useState } from 'react';

import {
  MESHTASTIC_DEVICE_METRICS_HELP_TOOLTIP,
  MESHTASTIC_MODULE_DEVICE_METRICS_DESCRIPTION,
} from '@/renderer/lib/meshtasticTelemetryLocalClientCopy';
import { MS_PER_MINUTE } from '@/renderer/lib/timeConstants';

import { HelpTooltip } from './HelpTooltip';
import { useToast } from './Toast';

interface PacketMessage {
  from: number;
  data: Uint8Array;
  timestamp: number;
}

interface Props {
  moduleConfigs: Record<string, unknown>;
  onSetModuleConfig: (config: unknown) => Promise<void>;
  onSetCannedMessages: (messages: string[]) => Promise<void>;
  onSetRingtone?: (ringtone: string) => Promise<void>;
  ringtone?: string;
  onCommit: () => Promise<void>;
  isConnected: boolean;
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
            {show ? 'Hide' : 'Show'}
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
          onClick={onApply}
          disabled={disabled || applying}
          className="bg-readable-green hover:bg-readable-green/90 disabled:text-muted w-full rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:bg-gray-600"
        >
          {applying ? 'Applying...' : `Apply ${title}`}
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

function formatTimeAgo(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < MS_PER_MINUTE) return 'Just now';
  return `${Math.floor(diff / MS_PER_MINUTE)}m ago`;
}

function ModuleStatus({
  packets,
  label,
}: {
  packets?: Map<number, { from: number; data: Uint8Array; timestamp: number }[]>;
  label: string;
}) {
  if (!packets || packets.size === 0) {
    return (
      <div className="rounded bg-gray-800/50 px-3 py-2 text-xs">
        <span className="text-gray-500">{label}: No packets received</span>
      </div>
    );
  }
  const total = Array.from(packets.values()).reduce((sum, arr) => sum + arr.length, 0);
  const latest = Math.max(
    ...Array.from(packets.values()).flatMap((arr) => arr.map((p) => p.timestamp)),
  );
  return (
    <div className="rounded bg-gray-800/50 px-3 py-2 text-xs">
      <span className="text-gray-400">
        {label}: {total} packets from {packets.size} node{packets.size !== 1 ? 's' : ''} (last{' '}
        {formatTimeAgo(latest)})
      </span>
    </div>
  );
}

function StatusOnlySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group bg-deep-black/50 rounded-lg border border-gray-700">
      <summary className="flex cursor-pointer items-center justify-between rounded-lg px-4 py-3 font-medium text-gray-200 transition-colors hover:bg-gray-800">
        <span>{title}</span>
        <span className="text-xs text-gray-500">Read-only</span>
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}

export default function ModulePanel({
  moduleConfigs,
  onSetModuleConfig,
  onSetCannedMessages,
  onSetRingtone,
  ringtone,
  onCommit,
  isConnected,
  storeForwardMessages,
  rangeTestPackets,
  serialMessages,
  remoteHardwareMessages,
  ipTunnelMessages,
}: Props) {
  const { addToast } = useToast();
  const disabled = !isConnected;
  const [applyingSection, setApplyingSection] = useState<string | null>(null);

  // ─── Telemetry module ──────────────────────────────────────────
  const telCfg = (moduleConfigs.telemetry as any) ?? {};
  const [telDeviceInterval, setTelDeviceInterval] = useState<number>(
    telCfg.deviceUpdateInterval ?? 1800,
  );
  const [telEnvInterval, setTelEnvInterval] = useState<number>(
    telCfg.environmentUpdateInterval ?? 1800,
  );
  const [telEnvEnabled, setTelEnvEnabled] = useState<boolean>(
    telCfg.environmentMeasurementEnabled ?? false,
  );
  const [telPowerEnabled, setTelPowerEnabled] = useState<boolean>(
    telCfg.powerMeasurementEnabled ?? false,
  );
  const [telAirQualityEnabled, setTelAirQualityEnabled] = useState<boolean>(
    telCfg.airQualityEnabled ?? false,
  );

  // ─── MQTT relay module ─────────────────────────────────────────
  const mqttCfg = (moduleConfigs.mqtt as any) ?? {};
  const [mqttEnabled, setMqttEnabled] = useState<boolean>(mqttCfg.enabled ?? false);
  const [mqttAddress, setMqttAddress] = useState<string>(mqttCfg.address ?? '');
  const [mqttUsername, setMqttUsername] = useState<string>(mqttCfg.username ?? '');
  const [mqttPassword, setMqttPassword] = useState<string>(mqttCfg.password ?? '');
  const [mqttEncryption, setMqttEncryption] = useState<boolean>(mqttCfg.encryptionEnabled ?? false);
  const [mqttJson, setMqttJson] = useState<boolean>(mqttCfg.jsonEnabled ?? false);
  const [mqttTls, setMqttTls] = useState<boolean>(mqttCfg.tlsEnabled ?? false);
  const [mqttRoot, setMqttRoot] = useState<string>(mqttCfg.root ?? '');
  const [mqttMapReporting, setMqttMapReporting] = useState<boolean>(
    mqttCfg.mapReportingEnabled ?? false,
  );

  // ─── Canned messages ──────────────────────────────────────────
  const cannedCfg = (moduleConfigs.cannedMessage as any) ?? {};
  const [cannedEnabled, setCannedEnabled] = useState<boolean>(cannedCfg.enabled ?? false);
  const [cannedText, setCannedText] = useState<string>(cannedCfg.messages ?? '');

  // ─── Serial module ─────────────────────────────────────────────
  const serialCfg = (moduleConfigs.serial as any) ?? {};
  const [serialEnabled, setSerialEnabled] = useState<boolean>(serialCfg.enabled ?? false);
  const [serialEcho, setSerialEcho] = useState<boolean>(serialCfg.echo ?? false);
  const [serialBaud, setSerialBaud] = useState<number>(serialCfg.baud ?? 38400);

  // ─── Range test module ─────────────────────────────────────────
  const rangeCfg = (moduleConfigs.rangeTest as any) ?? {};
  const [rangeEnabled, setRangeEnabled] = useState<boolean>(rangeCfg.enabled ?? false);
  const [rangeSenderInterval, setRangeSenderInterval] = useState<number>(rangeCfg.sender ?? 0);
  const [rangeSave, setRangeSave] = useState<boolean>(rangeCfg.save ?? false);

  // ─── Store and Forward module ──────────────────────────────────
  const sfCfg = (moduleConfigs.storeForward as any) ?? {};
  const [sfEnabled, setSfEnabled] = useState<boolean>(sfCfg.enabled ?? false);
  const [sfHeartbeat, setSfHeartbeat] = useState<boolean>(sfCfg.heartbeat ?? false);
  const [sfNumRecords, setSfNumRecords] = useState<number>(sfCfg.numRecords ?? 0);
  const [sfHistoryMax, setSfHistoryMax] = useState<number>(sfCfg.historyReturnMax ?? 25);
  const [sfHistoryWindow, setSfHistoryWindow] = useState<number>(sfCfg.historyReturnWindow ?? 7200);

  // ─── Detection sensor module ──────────────────────────────────
  const detectCfg = (moduleConfigs.detectionSensor as any) ?? {};
  const [detectEnabled, setDetectEnabled] = useState<boolean>(detectCfg.enabled ?? false);
  const [detectName, setDetectName] = useState<string>(detectCfg.name ?? '');
  const [detectMinBroadcast, setDetectMinBroadcast] = useState<number>(
    detectCfg.minimumBroadcastSecs ?? 0,
  );
  const [detectStateBroadcast, setDetectStateBroadcast] = useState<number>(
    detectCfg.stateBroadcastSecs ?? 0,
  );

  // ─── Pax counter module ────────────────────────────────────────
  const paxCfg = (moduleConfigs.paxcounter as any) ?? {};
  const [paxEnabled, setPaxEnabled] = useState<boolean>(paxCfg.enabled ?? false);
  const [paxInterval, setPaxInterval] = useState<number>(paxCfg.paxcounterUpdateInterval ?? 0);

  // ─── External Notification module ─────────────────────────────
  const extNotifCfg = (moduleConfigs.externalNotification as any) ?? {};
  const [extEnabled, setExtEnabled] = useState<boolean>(extNotifCfg.enabled ?? false);
  const [extActive, setExtActive] = useState<boolean>(extNotifCfg.active ?? false);
  const [extOutput, setExtOutput] = useState<number>(extNotifCfg.output ?? 0);
  const [extOutputBuzzer, setExtOutputBuzzer] = useState<number>(extNotifCfg.outputBuzzer ?? 0);
  const [extOutputVibra, setExtOutputVibra] = useState<number>(extNotifCfg.outputVibra ?? 0);
  const [extOutputMs, setExtOutputMs] = useState<number>(extNotifCfg.outputMs ?? 1000);
  const [extNagTimeout, setExtNagTimeout] = useState<number>(extNotifCfg.nagTimeout ?? 0);
  const [extAlertMessage, setExtAlertMessage] = useState<boolean>(
    extNotifCfg.alertMessage ?? false,
  );
  const [extAlertMessageBuzzer, setExtAlertMessageBuzzer] = useState<boolean>(
    extNotifCfg.alertMessageBuzzer ?? false,
  );
  const [extAlertMessageVibra, setExtAlertMessageVibra] = useState<boolean>(
    extNotifCfg.alertMessageVibra ?? false,
  );
  const [extAlertBell, setExtAlertBell] = useState<boolean>(extNotifCfg.alertBell ?? false);
  const [extAlertBellBuzzer, setExtAlertBellBuzzer] = useState<boolean>(
    extNotifCfg.alertBellBuzzer ?? false,
  );
  const [extAlertBellVibra, setExtAlertBellVibra] = useState<boolean>(
    extNotifCfg.alertBellVibra ?? false,
  );
  const [extUsePwm, setExtUsePwm] = useState<boolean>(extNotifCfg.usePwm ?? false);
  const [extUseI2sAsBuzzer, setExtUseI2sAsBuzzer] = useState<boolean>(
    extNotifCfg.useI2sAsBuzzer ?? false,
  );

  // ─── Ambient Lighting module ───────────────────────────────────
  const ambientCfg = (moduleConfigs.ambientLighting as any) ?? {};
  const [ambientLedState, setAmbientLedState] = useState<boolean>(ambientCfg.ledState ?? false);
  const [ambientRed, setAmbientRed] = useState<number>(ambientCfg.red ?? 0);
  const [ambientGreen, setAmbientGreen] = useState<number>(ambientCfg.green ?? 0);
  const [ambientBlue, setAmbientBlue] = useState<number>(ambientCfg.blue ?? 0);
  const [ambientCurrent, setAmbientCurrent] = useState<number>(ambientCfg.current ?? 10);

  // ─── RTTTL Ringtone ───────────────────────────────────────────
  const [ringtoneText, setRingtoneText] = useState<string>(ringtone ?? '');

  const ambientHex = `#${[ambientRed, ambientGreen, ambientBlue].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  const handleAmbientColorChange = (hex: string) => {
    setAmbientRed(parseInt(hex.slice(1, 3), 16));
    setAmbientGreen(parseInt(hex.slice(3, 5), 16));
    setAmbientBlue(parseInt(hex.slice(5, 7), 16));
  };

  const applyModule = (sectionName: string, moduleCase: string, value: unknown) => {
    setApplyingSection(sectionName);
    const setPromise = onSetModuleConfig({ payloadVariant: { case: moduleCase, value } });
    void setPromise
      .then(() => {
        addToast(`${sectionName} sent. Device may briefly reboot.`, 'success');
        return onCommit()
          .then(() => {})
          .catch((err: unknown) => {
            addToast(
              `Commit failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
              'error',
            );
          });
      })
      .catch((err: unknown) => {
        console.warn('[ModulePanel] apply failed', err);
        addToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
      });
    setApplyingSection(null);
  };

  return (
    <div className="w-full space-y-4">
      <h2 className="text-xl font-semibold text-gray-200">Module Configuration</h2>

      {!isConnected && (
        <div className="rounded-lg border border-yellow-700 bg-yellow-900/30 px-4 py-2 text-sm text-yellow-300">
          Connect to a device to modify module configuration.
        </div>
      )}

      {Object.keys(moduleConfigs).length === 0 && isConnected && (
        <div className="bg-deep-black/50 text-muted rounded-lg border border-gray-700 px-4 py-3 text-sm">
          Waiting for module config from device…
        </div>
      )}

      {/* ═══ Ambient Lighting Module ═══ */}
      <ModuleSection
        title="Ambient Lighting Module"
        onApply={() => {
          applyModule('Ambient Lighting', 'ambientLighting', {
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
          label="LED enabled"
          checked={ambientLedState}
          onChange={setAmbientLedState}
          disabled={disabled}
          description="Turn the onboard RGB LED on or off."
        />
        <div className="space-y-1">
          <label htmlFor="module-ambient-color" className="text-muted text-sm">
            Color
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
            Brightness / current: {ambientCurrent}
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
          <p className="text-muted text-xs">LED drive current (0–31). Higher = brighter.</p>
        </div>
      </ModuleSection>

      {/* ═══ Canned Messages ═══ */}
      <ModuleSection
        title="Canned Messages"
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
            addToast('Canned Messages applied.', 'success');
          } catch (err) {
            console.warn('[ModulePanel] canned messages failed', err);
            addToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
          } finally {
            setApplyingSection(null);
          }
        }}
        applying={applyingSection === 'Canned Messages'}
        disabled={disabled}
      >
        <ConfigToggle
          label="Canned messages enabled"
          checked={cannedEnabled}
          onChange={setCannedEnabled}
          disabled={disabled}
        />
        <div className="space-y-1">
          <label htmlFor="module-canned-messages" className="text-muted text-sm">
            Messages (one per line, max 30 chars each)
          </label>
          <textarea
            id="module-canned-messages"
            value={cannedText}
            onChange={(e) => {
              setCannedText(e.target.value);
            }}
            disabled={disabled || !cannedEnabled}
            rows={6}
            placeholder={'Hello\nOK\nOn my way\nNeed help'}
            spellCheck={false}
            className="bg-secondary-dark focus:border-brand-green w-full resize-y rounded-lg border border-gray-600 px-3 py-2 font-mono text-xs text-gray-200 focus:outline-none disabled:opacity-50"
          />
          <p className="text-muted text-xs">
            Enter one message per line. Used with the input peripheral buttons.
          </p>
        </div>
      </ModuleSection>

      {/* ═══ Detection Sensor Module ═══ */}
      <ModuleSection
        title="Detection Sensor Module"
        onApply={() => {
          applyModule('Detection Sensor', 'detectionSensor', {
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
          label="Detection sensor enabled"
          checked={detectEnabled}
          onChange={setDetectEnabled}
          disabled={disabled}
          description="Broadcast detection events (PIR, door sensor, etc.) to the mesh."
        />
        <ConfigText
          label="Sensor name"
          value={detectName}
          onChange={setDetectName}
          disabled={disabled || !detectEnabled}
          description="Shown in detection alert messages."
        />
        <ConfigNumber
          label="Minimum broadcast interval"
          value={detectMinBroadcast}
          onChange={setDetectMinBroadcast}
          disabled={disabled || !detectEnabled}
          min={0}
          unit="seconds"
          description="Minimum seconds between broadcasts even if repeatedly triggered."
        />
        <ConfigNumber
          label="State broadcast interval"
          value={detectStateBroadcast}
          onChange={setDetectStateBroadcast}
          disabled={disabled || !detectEnabled}
          min={0}
          unit="seconds"
          description="How often to broadcast the current state even without a change."
        />
      </ModuleSection>

      {/* ═══ External Notification Module ═══ */}
      <ModuleSection
        title="External Notification Module"
        onApply={() => {
          applyModule('External Notification', 'externalNotification', {
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
          label="Module enabled"
          checked={extEnabled}
          onChange={setExtEnabled}
          disabled={disabled}
          description="Enable GPIO-based external alerts for buzzers, vibration motors, and LEDs."
        />
        <ConfigToggle
          label="Active high"
          checked={extActive}
          onChange={setExtActive}
          disabled={disabled || !extEnabled}
          description="GPIO active level. On = active high (3.3 V triggers output); Off = active low."
        />
        <ConfigNumber
          label="Primary output GPIO"
          value={extOutput}
          onChange={setExtOutput}
          disabled={disabled || !extEnabled}
          min={0}
          max={48}
          description="GPIO pin for primary notification output. 0 = unset."
        />
        <ConfigNumber
          label="Buzzer GPIO"
          value={extOutputBuzzer}
          onChange={setExtOutputBuzzer}
          disabled={disabled || !extEnabled}
          min={0}
          max={48}
          description="GPIO pin for buzzer. 0 = unset."
        />
        <ConfigNumber
          label="Vibration motor GPIO"
          value={extOutputVibra}
          onChange={setExtOutputVibra}
          disabled={disabled || !extEnabled}
          min={0}
          max={48}
          description="GPIO pin for vibration motor. 0 = unset."
        />
        <ConfigNumber
          label="Output duration"
          value={extOutputMs}
          onChange={setExtOutputMs}
          disabled={disabled || !extEnabled}
          min={0}
          max={32767}
          unit="ms"
          description="How long to keep the output active per alert (milliseconds)."
        />
        <ConfigNumber
          label="Nag timeout"
          value={extNagTimeout}
          onChange={setExtNagTimeout}
          disabled={disabled || !extEnabled}
          min={0}
          max={32767}
          unit="seconds"
          description="Keep repeating the alert for this many seconds. 0 = single trigger only."
        />
        <ConfigToggle
          label="Alert on message"
          checked={extAlertMessage}
          onChange={setExtAlertMessage}
          disabled={disabled || !extEnabled}
          description="Trigger primary output GPIO when a text message is received."
        />
        <ConfigToggle
          label="Buzzer on message"
          checked={extAlertMessageBuzzer}
          onChange={setExtAlertMessageBuzzer}
          disabled={disabled || !extEnabled || !extAlertMessage}
          description="Also trigger buzzer GPIO on incoming messages."
        />
        <ConfigToggle
          label="Vibration on message"
          checked={extAlertMessageVibra}
          onChange={setExtAlertMessageVibra}
          disabled={disabled || !extEnabled || !extAlertMessage}
          description="Also trigger vibration GPIO on incoming messages."
        />
        <ConfigToggle
          label="Alert on bell"
          checked={extAlertBell}
          onChange={setExtAlertBell}
          disabled={disabled || !extEnabled}
          description="Trigger primary output GPIO on bell / tapback signals."
        />
        <ConfigToggle
          label="Buzzer on bell"
          checked={extAlertBellBuzzer}
          onChange={setExtAlertBellBuzzer}
          disabled={disabled || !extEnabled || !extAlertBell}
          description="Also trigger buzzer GPIO on bell signals."
        />
        <ConfigToggle
          label="Vibration on bell"
          checked={extAlertBellVibra}
          onChange={setExtAlertBellVibra}
          disabled={disabled || !extEnabled || !extAlertBell}
          description="Also trigger vibration GPIO on bell signals."
        />
        <ConfigToggle
          label="Use PWM buzzer mode"
          checked={extUsePwm}
          onChange={setExtUsePwm}
          disabled={disabled || !extEnabled}
          description="Use PWM frequency for tone-capable buzzers (e.g. RAK buzzer)."
        />
        <ConfigToggle
          label="Use I2S as buzzer"
          checked={extUseI2sAsBuzzer}
          onChange={setExtUseI2sAsBuzzer}
          disabled={disabled || !extEnabled}
          description="Use I2S audio output as buzzer (T-Watch S3, T-Deck with speaker)."
        />
      </ModuleSection>

      {/* ═══ IP Tunnel ═══ */}
      <StatusOnlySection title="IP Tunnel">
        <ModuleStatus packets={ipTunnelMessages} label="IP Tunnel" />
        <p className="text-muted text-xs">
          IP Tunnel packets forward network traffic through the mesh. Configure tunnel settings in
          the device network configuration.
        </p>
      </StatusOnlySection>

      {/* ═══ MQTT Relay Module ═══ */}
      <ModuleSection
        title="MQTT Relay (Device-Side)"
        onApply={() => {
          applyModule('MQTT Relay', 'mqtt', {
            enabled: mqttEnabled,
            address: mqttAddress,
            username: mqttUsername,
            password: mqttPassword,
            encryptionEnabled: mqttEncryption,
            jsonEnabled: mqttJson,
            tlsEnabled: mqttTls,
            root: mqttRoot,
            mapReportingEnabled: mqttMapReporting,
          });
        }}
        applying={applyingSection === 'MQTT Relay'}
        disabled={disabled}
      >
        <ConfigToggle
          label="MQTT relay enabled"
          checked={mqttEnabled}
          onChange={setMqttEnabled}
          disabled={disabled}
          description="Enable the device to relay packets to/from an MQTT broker."
        />
        <ConfigText
          label="Server address"
          value={mqttAddress}
          onChange={setMqttAddress}
          disabled={disabled || !mqttEnabled}
          description="Leave empty to use default mqtt.meshtastic.org"
        />
        <ConfigText
          label="Username"
          value={mqttUsername}
          onChange={setMqttUsername}
          disabled={disabled || !mqttEnabled}
        />
        <ConfigText
          label="Password"
          value={mqttPassword}
          onChange={setMqttPassword}
          disabled={disabled || !mqttEnabled}
          password
        />
        <ConfigText
          label="Root topic"
          value={mqttRoot}
          onChange={setMqttRoot}
          disabled={disabled || !mqttEnabled}
          description="Topic prefix (e.g. 'msh/US'). Leave empty for default."
        />
        <ConfigToggle
          label="Encryption enabled"
          checked={mqttEncryption}
          onChange={setMqttEncryption}
          disabled={disabled || !mqttEnabled}
          description="Encrypt packets before publishing to MQTT."
        />
        <ConfigToggle
          label="JSON output enabled"
          checked={mqttJson}
          onChange={setMqttJson}
          disabled={disabled || !mqttEnabled}
          description="Also publish decoded JSON payloads alongside protobuf."
        />
        <ConfigToggle
          label="TLS enabled"
          checked={mqttTls}
          onChange={setMqttTls}
          disabled={disabled || !mqttEnabled}
        />
        <ConfigToggle
          label="Map reporting enabled"
          checked={mqttMapReporting}
          onChange={setMqttMapReporting}
          disabled={disabled || !mqttEnabled}
          description="Periodically publish node position to the Meshtastic map."
        />
      </ModuleSection>

      {/* ═══ Pax Counter Module ═══ */}
      <ModuleSection
        title="Pax Counter Module"
        onApply={() => {
          applyModule('Pax Counter', 'paxcounter', {
            enabled: paxEnabled,
            paxcounterUpdateInterval: paxInterval,
          });
        }}
        applying={applyingSection === 'Pax Counter'}
        disabled={disabled}
      >
        <ConfigToggle
          label="Pax counter enabled"
          checked={paxEnabled}
          onChange={setPaxEnabled}
          disabled={disabled}
          description="Count nearby Bluetooth and WiFi devices as a crowd density metric."
        />
        <ConfigNumber
          label="Update interval"
          value={paxInterval}
          onChange={setPaxInterval}
          disabled={disabled || !paxEnabled}
          min={0}
          unit="seconds"
          description="How often to broadcast pax counter readings. 0 = use default."
        />
      </ModuleSection>

      {/* ═══ Remote Hardware ═══ */}
      <StatusOnlySection title="Remote Hardware">
        <ModuleStatus packets={remoteHardwareMessages} label="GPIO" />
        <p className="text-muted text-xs">
          GPIO messages are received automatically when enabled on the device. Configure GPIO pins
          in the device hardware settings.
        </p>
      </StatusOnlySection>

      {/* ═══ Range Test Module ═══ */}
      <ModuleSection
        title="Range Test Module"
        onApply={() => {
          applyModule('Range Test', 'rangeTest', {
            enabled: rangeEnabled,
            sender: rangeSenderInterval,
            save: rangeSave,
          });
        }}
        applying={applyingSection === 'Range Test'}
        disabled={disabled}
      >
        <ModuleStatus packets={rangeTestPackets} label="Range test" />
        <ConfigToggle
          label="Range test enabled"
          checked={rangeEnabled}
          onChange={setRangeEnabled}
          disabled={disabled}
        />
        <ConfigNumber
          label="Sender interval"
          value={rangeSenderInterval}
          onChange={setRangeSenderInterval}
          disabled={disabled || !rangeEnabled}
          min={0}
          max={3600}
          unit="seconds"
          description="How often this node sends range test packets. 0 = receiver only."
        />
        <ConfigToggle
          label="Save results to file"
          checked={rangeSave}
          onChange={setRangeSave}
          disabled={disabled || !rangeEnabled}
          description="Log range test results to the device filesystem."
        />
      </ModuleSection>

      {/* ═══ RTTTL Ringtone ═══ */}
      {onSetRingtone && (
        <ModuleSection
          title="RTTTL Ringtone"
          onApply={async () => {
            setApplyingSection('RTTTL Ringtone');
            try {
              await onSetRingtone(ringtoneText);
              await onCommit();
              addToast('RTTTL ringtone saved.', 'success');
            } catch (err) {
              console.warn('[ModulePanel] RTTTL apply failed', err);
              addToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
            } finally {
              setApplyingSection(null);
            }
          }}
          applying={applyingSection === 'RTTTL Ringtone'}
          disabled={disabled}
        >
          <div className="space-y-1">
            <label htmlFor="module-rtttl-preset" className="text-muted text-sm">
              Load preset
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
              <option value="">Select a preset…</option>
              {RTTTL_PRESETS.map((p) => (
                <option key={p.name} value={p.value}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="module-rtttl-ringtone" className="text-muted text-sm">
              Ringtone string (RTTTL format)
            </label>
            <textarea
              id="module-rtttl-ringtone"
              value={ringtoneText}
              onChange={(e) => {
                setRingtoneText(e.target.value.slice(0, 230));
              }}
              disabled={disabled}
              rows={4}
              placeholder="Name:d=4,o=5,b=120:notes..."
              spellCheck={false}
              className="bg-secondary-dark focus:border-brand-green w-full resize-y rounded-lg border border-gray-600 px-3 py-2 font-mono text-xs text-gray-200 focus:outline-none disabled:opacity-50"
            />
            <div className="text-muted flex justify-between text-xs">
              <span>
                {ringtoneText.length > 0 && !isValidRtttl(ringtoneText) && (
                  <span className="text-red-400">
                    Invalid RTTTL — expected Name:d=N,o=N,b=N:notes
                  </span>
                )}
              </span>
              <span>{ringtoneText.length}/230</span>
            </div>
          </div>
        </ModuleSection>
      )}

      {/* ═══ Serial Module ═══ */}
      <ModuleSection
        title="Serial Module"
        onApply={() => {
          applyModule('Serial Module', 'serial', {
            enabled: serialEnabled,
            echo: serialEcho,
            baud: serialBaud,
          });
        }}
        applying={applyingSection === 'Serial Module'}
        disabled={disabled}
      >
        <ModuleStatus packets={serialMessages} label="Serial" />
        <ConfigToggle
          label="Serial module enabled"
          checked={serialEnabled}
          onChange={setSerialEnabled}
          disabled={disabled}
          description="Enable serial port data forwarding via the mesh."
        />
        <ConfigToggle
          label="Echo mode"
          checked={serialEcho}
          onChange={setSerialEcho}
          disabled={disabled || !serialEnabled}
          description="Echo received serial data back to sender."
        />
        <div className="space-y-1">
          <label htmlFor="module-serial-baud" className="text-muted text-sm">
            Baud rate
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
        title="Store & Forward Module"
        onApply={() => {
          applyModule('Store & Forward', 'storeForward', {
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
        <ModuleStatus packets={storeForwardMessages} label="Received S&F" />
        <ConfigToggle
          label="Store & Forward enabled"
          checked={sfEnabled}
          onChange={setSfEnabled}
          disabled={disabled}
          description="Buffer messages for nodes that rejoin the mesh."
        />
        <ConfigToggle
          label="Send heartbeat"
          checked={sfHeartbeat}
          onChange={setSfHeartbeat}
          disabled={disabled || !sfEnabled}
          description="Periodically broadcast presence so clients know S&F is available."
        />
        <ConfigNumber
          label="Max stored records"
          value={sfNumRecords}
          onChange={setSfNumRecords}
          disabled={disabled || !sfEnabled}
          min={0}
          description="Maximum messages to store. 0 = use default."
        />
        <ConfigNumber
          label="History return max"
          value={sfHistoryMax}
          onChange={setSfHistoryMax}
          disabled={disabled || !sfEnabled}
          min={1}
          max={300}
          description="Max messages to return when a node requests history."
        />
        <ConfigNumber
          label="History return window"
          value={sfHistoryWindow}
          onChange={setSfHistoryWindow}
          disabled={disabled || !sfEnabled}
          min={0}
          unit="seconds"
          description="How far back in time to return messages (seconds)."
        />
      </ModuleSection>

      {/* ═══ Telemetry Module ═══ */}
      <ModuleSection
        title="Telemetry Module"
        onApply={() => {
          applyModule('Telemetry Module', 'telemetry', {
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
          label="Device metrics interval"
          value={telDeviceInterval}
          onChange={setTelDeviceInterval}
          disabled={disabled}
          min={0}
          max={86400}
          unit="seconds"
          description={MESHTASTIC_MODULE_DEVICE_METRICS_DESCRIPTION}
          tooltip={MESHTASTIC_DEVICE_METRICS_HELP_TOOLTIP}
        />
        <ConfigNumber
          label="Environment metrics interval"
          value={telEnvInterval}
          onChange={setTelEnvInterval}
          disabled={disabled}
          min={0}
          max={86400}
          unit="seconds"
          description="How often to send temperature/humidity/pressure. 0 = disabled."
        />
        <ConfigToggle
          label="Environment measurement enabled"
          checked={telEnvEnabled}
          onChange={setTelEnvEnabled}
          disabled={disabled}
        />
        <ConfigToggle
          label="Power measurement enabled"
          checked={telPowerEnabled}
          onChange={setTelPowerEnabled}
          disabled={disabled}
        />
        <ConfigToggle
          label="Air quality enabled"
          checked={telAirQualityEnabled}
          onChange={setTelAirQualityEnabled}
          disabled={disabled}
        />
      </ModuleSection>
    </div>
  );
}
