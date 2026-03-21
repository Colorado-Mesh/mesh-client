import { useState } from 'react';

import { useToast } from './Toast';

interface Props {
  moduleConfigs: Record<string, unknown>;
  onSetModuleConfig: (config: unknown) => Promise<void>;
  onSetCannedMessages: (messages: string[]) => Promise<void>;
  onCommit: () => Promise<void>;
  isConnected: boolean;
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
          onClick={() => onChange(!checked)}
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
      {description && <p className="text-xs text-muted">{description}</p>}
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
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
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
      <label className="text-sm text-muted">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type={password && !show ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="flex-1 px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
        />
        {password && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="px-2 py-2 text-xs text-muted hover:text-gray-300"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {description && <p className="text-xs text-muted">{description}</p>}
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
          className="w-full px-4 py-2 bg-readable-green hover:bg-readable-green/90 disabled:bg-gray-600 disabled:text-muted text-white text-sm font-medium rounded-lg transition-colors"
        >
          {applying ? 'Applying...' : `Apply ${title}`}
        </button>
      </div>
    </details>
  );
}

export default function ModulePanel({
  moduleConfigs,
  onSetModuleConfig,
  onSetCannedMessages,
  onCommit,
  isConnected,
}: Props) {
  const { addToast } = useToast();
  const disabled = !isConnected;
  const [applyingSection, setApplyingSection] = useState<string | null>(null);

  // ─── Telemetry module ──────────────────────────────────────────
  const telCfg = (moduleConfigs['telemetry'] as any) ?? {};
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
  const mqttCfg = (moduleConfigs['mqtt'] as any) ?? {};
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
  const cannedCfg = (moduleConfigs['cannedMessage'] as any) ?? {};
  const [cannedEnabled, setCannedEnabled] = useState<boolean>(cannedCfg.enabled ?? false);
  const [cannedText, setCannedText] = useState<string>(cannedCfg.messages ?? '');

  // ─── Serial module ─────────────────────────────────────────────
  const serialCfg = (moduleConfigs['serial'] as any) ?? {};
  const [serialEnabled, setSerialEnabled] = useState<boolean>(serialCfg.enabled ?? false);
  const [serialEcho, setSerialEcho] = useState<boolean>(serialCfg.echo ?? false);
  const [serialBaud, setSerialBaud] = useState<number>(serialCfg.baud ?? 38400);

  // ─── Range test module ─────────────────────────────────────────
  const rangeCfg = (moduleConfigs['rangeTest'] as any) ?? {};
  const [rangeEnabled, setRangeEnabled] = useState<boolean>(rangeCfg.enabled ?? false);
  const [rangeSenderInterval, setRangeSenderInterval] = useState<number>(rangeCfg.sender ?? 0);
  const [rangeSave, setRangeSave] = useState<boolean>(rangeCfg.save ?? false);

  // ─── Store and Forward module ──────────────────────────────────
  const sfCfg = (moduleConfigs['storeForward'] as any) ?? {};
  const [sfEnabled, setSfEnabled] = useState<boolean>(sfCfg.enabled ?? false);
  const [sfHeartbeat, setSfHeartbeat] = useState<boolean>(sfCfg.heartbeat ?? false);
  const [sfNumRecords, setSfNumRecords] = useState<number>(sfCfg.numRecords ?? 0);
  const [sfHistoryMax, setSfHistoryMax] = useState<number>(sfCfg.historyReturnMax ?? 25);
  const [sfHistoryWindow, setSfHistoryWindow] = useState<number>(sfCfg.historyReturnWindow ?? 7200);

  // ─── Detection sensor module ──────────────────────────────────
  const detectCfg = (moduleConfigs['detectionSensor'] as any) ?? {};
  const [detectEnabled, setDetectEnabled] = useState<boolean>(detectCfg.enabled ?? false);
  const [detectName, setDetectName] = useState<string>(detectCfg.name ?? '');
  const [detectMinBroadcast, setDetectMinBroadcast] = useState<number>(
    detectCfg.minimumBroadcastSecs ?? 0,
  );
  const [detectStateBroadcast, setDetectStateBroadcast] = useState<number>(
    detectCfg.stateBroadcastSecs ?? 0,
  );

  // ─── Pax counter module ────────────────────────────────────────
  const paxCfg = (moduleConfigs['paxcounter'] as any) ?? {};
  const [paxEnabled, setPaxEnabled] = useState<boolean>(paxCfg.enabled ?? false);
  const [paxInterval, setPaxInterval] = useState<number>(paxCfg.paxcounterUpdateInterval ?? 0);

  const applyModule = async (sectionName: string, moduleCase: string, value: unknown) => {
    setApplyingSection(sectionName);
    try {
      await onSetModuleConfig({ payloadVariant: { case: moduleCase, value } });
      await onCommit();
      addToast(`${sectionName} applied.`, 'success');
    } catch (err) {
      console.warn('[ModulePanel] apply failed', err);
      addToast(`Failed: ${err instanceof Error ? err.message : 'Unknown error'}`, 'error');
    } finally {
      setApplyingSection(null);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <h2 className="text-xl font-semibold text-gray-200">Module Configuration</h2>

      {!isConnected && (
        <div className="bg-yellow-900/30 border border-yellow-700 text-yellow-300 px-4 py-2 rounded-lg text-sm">
          Connect to a device to modify module configuration.
        </div>
      )}

      {Object.keys(moduleConfigs).length === 0 && isConnected && (
        <div className="bg-deep-black/50 border border-gray-700 text-muted px-4 py-3 rounded-lg text-sm">
          Waiting for module config from device…
        </div>
      )}

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
          <label htmlFor="module-canned-messages" className="text-sm text-muted">
            Messages (one per line, max 30 chars each)
          </label>
          <textarea
            id="module-canned-messages"
            value={cannedText}
            onChange={(e) => setCannedText(e.target.value)}
            disabled={disabled || !cannedEnabled}
            rows={6}
            placeholder={'Hello\nOK\nOn my way\nNeed help'}
            spellCheck={false}
            className="w-full px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50 font-mono text-xs resize-y"
          />
          <p className="text-xs text-muted">
            Enter one message per line. Used with the input peripheral buttons.
          </p>
        </div>
      </ModuleSection>

      {/* ═══ Detection Sensor Module ═══ */}
      <ModuleSection
        title="Detection Sensor Module"
        onApply={() =>
          applyModule('Detection Sensor', 'detectionSensor', {
            enabled: detectEnabled,
            name: detectName,
            minimumBroadcastSecs: detectMinBroadcast,
            stateBroadcastSecs: detectStateBroadcast,
          })
        }
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

      {/* ═══ MQTT Relay Module ═══ */}
      <ModuleSection
        title="MQTT Relay (Device-Side)"
        onApply={() =>
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
          })
        }
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
        onApply={() =>
          applyModule('Pax Counter', 'paxcounter', {
            enabled: paxEnabled,
            paxcounterUpdateInterval: paxInterval,
          })
        }
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

      {/* ═══ Range Test Module ═══ */}
      <ModuleSection
        title="Range Test Module"
        onApply={() =>
          applyModule('Range Test', 'rangeTest', {
            enabled: rangeEnabled,
            sender: rangeSenderInterval,
            save: rangeSave,
          })
        }
        applying={applyingSection === 'Range Test'}
        disabled={disabled}
      >
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

      {/* ═══ Serial Module ═══ */}
      <ModuleSection
        title="Serial Module"
        onApply={() =>
          applyModule('Serial Module', 'serial', {
            enabled: serialEnabled,
            echo: serialEcho,
            baud: serialBaud,
          })
        }
        applying={applyingSection === 'Serial Module'}
        disabled={disabled}
      >
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
          <label htmlFor="module-serial-baud" className="text-sm text-muted">
            Baud rate
          </label>
          <select
            id="module-serial-baud"
            value={serialBaud}
            onChange={(e) => setSerialBaud(Number(e.target.value))}
            disabled={disabled || !serialEnabled}
            className="w-full px-3 py-2 bg-secondary-dark rounded-lg text-gray-200 border border-gray-600 focus:border-brand-green focus:outline-none disabled:opacity-50"
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
        onApply={() =>
          applyModule('Store & Forward', 'storeForward', {
            enabled: sfEnabled,
            heartbeat: sfHeartbeat,
            numRecords: sfNumRecords,
            historyReturnMax: sfHistoryMax,
            historyReturnWindow: sfHistoryWindow,
          })
        }
        applying={applyingSection === 'Store & Forward'}
        disabled={disabled}
      >
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
        onApply={() =>
          applyModule('Telemetry Module', 'telemetry', {
            deviceUpdateInterval: telDeviceInterval,
            environmentUpdateInterval: telEnvInterval,
            environmentMeasurementEnabled: telEnvEnabled,
            powerMeasurementEnabled: telPowerEnabled,
            airQualityEnabled: telAirQualityEnabled,
          })
        }
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
          description="How often to send battery/voltage/channel utilization. 0 = disabled."
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
