/**
 * Declarative specs for Meshtastic config fields that the Radio / Security / Module panels expose
 * without a hand-written state hook per field. Each section reads its slice into string/number/bool
 * form values and spreads {@link buildExtraFieldOverrides} into the existing apply payload, which
 * `mergeMeshtasticConfigApplyValue` then layers over the device slice.
 */
import { Config, ModuleConfig } from '@meshtastic/protobufs';

import { meshtasticConfigSlice } from './meshtasticConfigApply';
import { humanizeEnumName, type ProtobufEnumDescriptor } from './protobufEnumOptions';

export type ExtraFieldKind =
  'bool' | 'number' | 'text' | 'enum' | 'flags' | 'ipv4' | 'bigint' | 'nodeList';

export interface ExtraFieldOption {
  value: number;
  /** i18n key; when absent the proto enum name is humanized. */
  labelKey?: string;
  enumName: string;
}

export interface ExtraConfigFieldSpec {
  /** Slice field name; `parent.child` writes into a nested message (e.g. `ipv4Config.ip`). */
  key: string;
  kind: ExtraFieldKind;
  labelKey: string;
  descKey?: string;
  min?: number;
  max?: number;
  step?: number;
  unitKey?: string;
  maxLength?: number;
  /** For `enum` (select) and `flags` (bitfield checkboxes). */
  options?: readonly ExtraFieldOption[];
}

export type ExtraFieldValue = boolean | number | string;
export type ExtraFieldValues = Readonly<Record<string, ExtraFieldValue>>;

export type ExtraFieldOverridesResult =
  { ok: true; overrides: Record<string, unknown> } | { ok: false; invalidKey: string };

function enumOptions(
  descriptor: ProtobufEnumDescriptor,
  labelKeys: Readonly<Record<string, string>> = {},
  opts: { skipZero?: boolean } = {},
): ExtraFieldOption[] {
  return descriptor.values
    .filter((v) => !(opts.skipZero && v.number === 0))
    .map((v) => ({ value: v.number, enumName: v.name, labelKey: labelKeys[v.name] }));
}

/** Firmware stores IPv4 as a little-endian fixed32: first octet in the low byte. */
export function ipv4FromUint32(n: number): string {
  const v = n >>> 0;
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff].join('.');
}

export function ipv4ToUint32(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  const parts = trimmed.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (let i = 0; i < 4; i++) {
    const part = parts[i];
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    out += octet * 2 ** (8 * i);
  }
  return out >>> 0;
}

export function formatNodeNumList(nums: readonly number[]): string {
  return nums.map((n) => `!${(n >>> 0).toString(16).padStart(8, '0')}`).join(', ');
}

/** Accepts `!hex`, `0xhex`, or decimal node numbers separated by commas or whitespace. */
export function parseNodeNumList(text: string): number[] | null {
  const out: number[] = [];
  for (const token of text.split(/[\s,]+/)) {
    if (!token) continue;
    let n: number;
    if (/^!?[0-9a-f]{8}$/i.test(token) && (token.startsWith('!') || /[a-f]/i.test(token))) {
      n = parseInt(token.replace(/^!/, ''), 16);
    } else if (/^0x[0-9a-f]{1,8}$/i.test(token)) {
      n = parseInt(token.slice(2), 16);
    } else if (/^\d+$/.test(token)) {
      n = Number(token);
    } else {
      return null;
    }
    if (!Number.isSafeInteger(n) || n <= 0 || n > 0xffffffff) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

function readPath(slice: Record<string, unknown>, key: string): unknown {
  const dot = key.indexOf('.');
  if (dot < 0) return slice[key];
  const parent = slice[key.slice(0, dot)];
  if (!parent || typeof parent !== 'object') return undefined;
  return (parent as Record<string, unknown>)[key.slice(dot + 1)];
}

function defaultValue(spec: ExtraConfigFieldSpec): ExtraFieldValue {
  switch (spec.kind) {
    case 'bool':
      return false;
    case 'text':
    case 'ipv4':
    case 'bigint':
    case 'nodeList':
      return '';
    default:
      return 0;
  }
}

function readOne(spec: ExtraConfigFieldSpec, raw: unknown): ExtraFieldValue {
  switch (spec.kind) {
    case 'bool':
      return typeof raw === 'boolean' ? raw : false;
    case 'text':
      return typeof raw === 'string' ? raw : '';
    case 'ipv4':
      return typeof raw === 'number' && raw !== 0 ? ipv4FromUint32(raw) : '';
    case 'bigint':
      if (typeof raw === 'bigint') return raw === 0n ? '' : raw.toString();
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw === 0 ? '' : String(raw);
      return '';
    case 'nodeList':
      return Array.isArray(raw)
        ? formatNodeNumList(raw.filter((n): n is number => typeof n === 'number'))
        : '';
    default:
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
  }
}

export function readExtraFieldValues(
  rawSlice: unknown,
  specs: readonly ExtraConfigFieldSpec[],
): Record<string, ExtraFieldValue> {
  const slice = meshtasticConfigSlice(rawSlice);
  const out: Record<string, ExtraFieldValue> = {};
  for (const spec of specs) out[spec.key] = readOne(spec, readPath(slice, spec.key));
  return out;
}

export function defaultExtraFieldValues(
  specs: readonly ExtraConfigFieldSpec[],
): Record<string, ExtraFieldValue> {
  const out: Record<string, ExtraFieldValue> = {};
  for (const spec of specs) out[spec.key] = defaultValue(spec);
  return out;
}

function writeOne(spec: ExtraConfigFieldSpec, value: ExtraFieldValue | undefined): unknown {
  const v = value ?? defaultValue(spec);
  switch (spec.kind) {
    case 'bool':
      return v === true;
    case 'text':
      return typeof v === 'string' ? v.trim() : '';
    case 'ipv4':
      return ipv4ToUint32(String(v));
    case 'bigint': {
      const s = String(v).trim();
      if (s === '') return 0n;
      if (!/^\d+$/.test(s)) return null;
      return BigInt(s);
    }
    case 'nodeList':
      return parseNodeNumList(String(v));
    default: {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      if (spec.min !== undefined && n < spec.min) return null;
      if (spec.max !== undefined && n > spec.max) return null;
      return n;
    }
  }
}

/** Numeric value of `Config_NetworkConfig_AddressMode.STATIC` (form values are plain numbers). */
export const MESHTASTIC_ADDRESS_MODE_STATIC: number =
  Config.Config_NetworkConfig_AddressMode.STATIC;

/** Builds apply overrides; nested keys merge into a copy of the device's sub-message. */
export function buildExtraFieldOverrides(
  rawSlice: unknown,
  specs: readonly ExtraConfigFieldSpec[],
  values: ExtraFieldValues,
): ExtraFieldOverridesResult {
  const slice = meshtasticConfigSlice(rawSlice);
  const overrides: Record<string, unknown> = {};
  const addressMode = values.addressMode;
  const skipIpv4Config =
    typeof addressMode === 'number' && addressMode !== MESHTASTIC_ADDRESS_MODE_STATIC;
  for (const spec of specs) {
    // Hidden static-IPv4 fields must not block DHCP applies or write stale values.
    if (skipIpv4Config && spec.key.startsWith('ipv4Config.')) continue;
    const written = writeOne(spec, values[spec.key]);
    if (written === null) return { ok: false, invalidKey: spec.key };
    const dot = spec.key.indexOf('.');
    if (dot < 0) {
      overrides[spec.key] = written;
      continue;
    }
    const parentKey = spec.key.slice(0, dot);
    const existing = overrides[parentKey] ?? slice[parentKey];
    const parent =
      existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {};
    parent[spec.key.slice(dot + 1)] = written;
    overrides[parentKey] = parent;
  }
  return { ok: true, overrides };
}

export function extraFieldOptionLabel(
  option: ExtraFieldOption,
  t: (key: string) => string,
): string {
  return option.labelKey ? t(option.labelKey) : humanizeEnumName(option.enumName);
}

export function toggleFlag(mask: number, flag: number, on: boolean): number {
  return on ? (mask | flag) >>> 0 : (mask & ~flag) >>> 0;
}

// ─── Section specs ──────────────────────────────────────────────────

export const DEVICE_EXTRA_FIELDS = {
  buzzerMode: {
    key: 'buzzerMode',
    kind: 'enum',
    labelKey: 'meshtasticExtraConfig.buzzerMode',
    descKey: 'meshtasticExtraConfig.buzzerModeDesc',
    options: enumOptions(Config.Config_DeviceConfig_BuzzerModeSchema, {
      ALL_ENABLED: 'meshtasticExtraConfig.buzzerModes.allEnabled',
      DISABLED: 'meshtasticExtraConfig.buzzerModes.disabled',
      NOTIFICATIONS_ONLY: 'meshtasticExtraConfig.buzzerModes.notificationsOnly',
      SYSTEM_ONLY: 'meshtasticExtraConfig.buzzerModes.systemOnly',
      DIRECT_MSG_ONLY: 'meshtasticExtraConfig.buzzerModes.directMsgOnly',
    }),
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const DISPLAY_EXTRA_FIELDS = {
  compassNorthTop: {
    key: 'compassNorthTop',
    kind: 'bool',
    labelKey: 'meshtasticExtraConfig.compassNorthTop',
    descKey: 'meshtasticExtraConfig.compassNorthTopDesc',
  },
  compassOrientation: {
    key: 'compassOrientation',
    kind: 'enum',
    labelKey: 'meshtasticExtraConfig.compassOrientation',
    options: enumOptions(Config.Config_DisplayConfig_CompassOrientationSchema),
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const POSITION_EXTRA_FIELDS = {
  positionFlags: {
    key: 'positionFlags',
    kind: 'flags',
    labelKey: 'meshtasticExtraConfig.positionFlags',
    descKey: 'meshtasticExtraConfig.positionFlagsDesc',
    options: enumOptions(Config.Config_PositionConfig_PositionFlagsSchema, {}, { skipZero: true }),
  },
  rxGpio: {
    key: 'rxGpio',
    kind: 'number',
    labelKey: 'meshtasticExtraConfig.gpsRxGpio',
    min: 0,
  },
  txGpio: {
    key: 'txGpio',
    kind: 'number',
    labelKey: 'meshtasticExtraConfig.gpsTxGpio',
    min: 0,
  },
  gpsEnGpio: {
    key: 'gpsEnGpio',
    kind: 'number',
    labelKey: 'meshtasticExtraConfig.gpsEnGpio',
    min: 0,
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const POWER_EXTRA_FIELDS = {
  adcMultiplierOverride: {
    key: 'adcMultiplierOverride',
    kind: 'number',
    labelKey: 'meshtasticExtraConfig.adcMultiplierOverride',
    descKey: 'meshtasticExtraConfig.adcMultiplierOverrideDesc',
    min: 0,
    max: 10,
    step: 0.0001,
  },
  deviceBatteryInaAddress: {
    key: 'deviceBatteryInaAddress',
    kind: 'number',
    labelKey: 'meshtasticExtraConfig.deviceBatteryInaAddress',
    descKey: 'meshtasticExtraConfig.deviceBatteryInaAddressDesc',
    min: 0,
    max: 127,
  },
  powermonEnables: {
    key: 'powermonEnables',
    kind: 'bigint',
    labelKey: 'meshtasticExtraConfig.powermonEnables',
    descKey: 'meshtasticExtraConfig.powermonEnablesDesc',
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const NETWORK_EXTRA_FIELDS = {
  addressMode: {
    key: 'addressMode',
    kind: 'enum',
    labelKey: 'meshtasticExtraConfig.addressMode',
    options: enumOptions(Config.Config_NetworkConfig_AddressModeSchema, {
      DHCP: 'meshtasticExtraConfig.addressModes.dhcp',
      STATIC: 'meshtasticExtraConfig.addressModes.static',
    }),
  },
  ip: { key: 'ipv4Config.ip', kind: 'ipv4', labelKey: 'meshtasticExtraConfig.ipv4Address' },
  gateway: {
    key: 'ipv4Config.gateway',
    kind: 'ipv4',
    labelKey: 'meshtasticExtraConfig.ipv4Gateway',
  },
  subnet: { key: 'ipv4Config.subnet', kind: 'ipv4', labelKey: 'meshtasticExtraConfig.ipv4Subnet' },
  dns: { key: 'ipv4Config.dns', kind: 'ipv4', labelKey: 'meshtasticExtraConfig.ipv4Dns' },
  rsyslogServer: {
    key: 'rsyslogServer',
    kind: 'text',
    labelKey: 'meshtasticExtraConfig.rsyslogServer',
    descKey: 'meshtasticExtraConfig.rsyslogServerDesc',
    maxLength: 33,
  },
  enabledProtocols: {
    key: 'enabledProtocols',
    kind: 'flags',
    labelKey: 'meshtasticExtraConfig.enabledProtocols',
    options: enumOptions(
      Config.Config_NetworkConfig_ProtocolFlagsSchema,
      { UDP_BROADCAST: 'meshtasticExtraConfig.udpBroadcast' },
      { skipZero: true },
    ),
  },
  ipv6Enabled: {
    key: 'ipv6Enabled',
    kind: 'bool',
    labelKey: 'meshtasticExtraConfig.ipv6Enabled',
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const LORA_EXTRA_FIELDS = {
  ignoreIncoming: {
    key: 'ignoreIncoming',
    kind: 'nodeList',
    labelKey: 'meshtasticExtraConfig.ignoreIncoming',
    descKey: 'meshtasticExtraConfig.ignoreIncomingDesc',
  },
  femLnaMode: {
    key: 'femLnaMode',
    kind: 'enum',
    labelKey: 'meshtasticExtraConfig.femLnaMode',
    descKey: 'meshtasticExtraConfig.femLnaModeDesc',
    options: enumOptions(Config.Config_LoRaConfig_FEM_LNA_ModeSchema, {
      DISABLED: 'meshtasticExtraConfig.femLnaModes.disabled',
      ENABLED: 'meshtasticExtraConfig.femLnaModes.enabled',
      NOT_PRESENT: 'meshtasticExtraConfig.femLnaModes.notPresent',
    }),
  },
  serialHalOnly: {
    key: 'serialHalOnly',
    kind: 'bool',
    labelKey: 'meshtasticExtraConfig.serialHalOnly',
    descKey: 'meshtasticExtraConfig.serialHalOnlyDesc',
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const SECURITY_EXTRA_FIELDS = {
  packetSignaturePolicy: {
    key: 'packetSignaturePolicy',
    kind: 'enum',
    labelKey: 'meshtasticExtraConfig.packetSignaturePolicy',
    descKey: 'meshtasticExtraConfig.packetSignaturePolicyDesc',
    options: enumOptions(Config.Config_SecurityConfig_PacketSignaturePolicySchema, {
      PACKET_SIGNATURE_POLICY_COMPATIBLE:
        'meshtasticExtraConfig.packetSignaturePolicies.compatible',
      PACKET_SIGNATURE_POLICY_BALANCED: 'meshtasticExtraConfig.packetSignaturePolicies.balanced',
      PACKET_SIGNATURE_POLICY_STRICT: 'meshtasticExtraConfig.packetSignaturePolicies.strict',
    }),
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const AUDIO_MODULE_FIELDS = {
  codec2Enabled: {
    key: 'codec2Enabled',
    kind: 'bool',
    labelKey: 'meshtasticExtraConfig.codec2Enabled',
  },
  bitrate: {
    key: 'bitrate',
    kind: 'enum',
    labelKey: 'meshtasticExtraConfig.audioBitrate',
    options: enumOptions(ModuleConfig.ModuleConfig_AudioConfig_Audio_BaudSchema),
  },
  pttPin: { key: 'pttPin', kind: 'number', labelKey: 'meshtasticExtraConfig.pttPin', min: 0 },
  i2sWs: { key: 'i2sWs', kind: 'number', labelKey: 'meshtasticExtraConfig.i2sWs', min: 0 },
  i2sSd: { key: 'i2sSd', kind: 'number', labelKey: 'meshtasticExtraConfig.i2sSd', min: 0 },
  i2sDin: { key: 'i2sDin', kind: 'number', labelKey: 'meshtasticExtraConfig.i2sDin', min: 0 },
  i2sSck: { key: 'i2sSck', kind: 'number', labelKey: 'meshtasticExtraConfig.i2sSck', min: 0 },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const DETECTION_SENSOR_EXTRA_FIELDS = {
  detectionTriggerType: {
    key: 'detectionTriggerType',
    kind: 'enum',
    labelKey: 'meshtasticExtraConfig.detectionTriggerType',
    options: enumOptions(ModuleConfig.ModuleConfig_DetectionSensorConfig_TriggerTypeSchema),
  },
  usePullup: {
    key: 'usePullup',
    kind: 'bool',
    labelKey: 'meshtasticExtraConfig.usePullup',
  },
  monitorPin: {
    key: 'monitorPin',
    kind: 'number',
    labelKey: 'meshtasticExtraConfig.monitorPin',
    min: 0,
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const PAXCOUNTER_EXTRA_FIELDS = {
  wifiThreshold: {
    key: 'wifiThreshold',
    kind: 'number',
    labelKey: 'meshtasticExtraConfig.wifiThreshold',
    descKey: 'meshtasticExtraConfig.rssiThresholdDesc',
    min: -120,
    max: 0,
  },
  bleThreshold: {
    key: 'bleThreshold',
    kind: 'number',
    labelKey: 'meshtasticExtraConfig.bleThreshold',
    descKey: 'meshtasticExtraConfig.rssiThresholdDesc',
    min: -120,
    max: 0,
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const TELEMETRY_EXTRA_FIELDS = {
  healthMeasurementEnabled: {
    key: 'healthMeasurementEnabled',
    kind: 'bool',
    labelKey: 'meshtasticExtraConfig.healthMeasurementEnabled',
    descKey: 'meshtasticExtraConfig.healthMeasurementEnabledDesc',
  },
  healthUpdateInterval: {
    key: 'healthUpdateInterval',
    kind: 'number',
    labelKey: 'meshtasticExtraConfig.healthUpdateInterval',
    min: 0,
    unitKey: 'radioPanel.secondsUnit',
  },
  healthScreenEnabled: {
    key: 'healthScreenEnabled',
    kind: 'bool',
    labelKey: 'meshtasticExtraConfig.healthScreenEnabled',
  },
  airQualityScreenEnabled: {
    key: 'airQualityScreenEnabled',
    kind: 'bool',
    labelKey: 'meshtasticExtraConfig.airQualityScreenEnabled',
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export const RANGE_TEST_EXTRA_FIELDS = {
  clearOnReboot: {
    key: 'clearOnReboot',
    kind: 'bool',
    labelKey: 'meshtasticExtraConfig.clearOnReboot',
  },
} as const satisfies Record<string, ExtraConfigFieldSpec>;

export function extraFieldList(
  fields: Readonly<Record<string, ExtraConfigFieldSpec>>,
): ExtraConfigFieldSpec[] {
  return Object.values(fields);
}

export interface RemoteHardwarePinView {
  gpioPin: number;
  name: string;
  type: number;
}

export const REMOTE_HARDWARE_PIN_TYPE_OPTIONS: readonly ExtraFieldOption[] = enumOptions(
  ModuleConfig.RemoteHardwarePinTypeSchema,
);

export function remoteHardwarePinTypeLabel(type: number, t: (key: string) => string): string {
  const option = REMOTE_HARDWARE_PIN_TYPE_OPTIONS.find((o) => o.value === type);
  return option ? extraFieldOptionLabel(option, t) : String(type);
}

export function remoteHardwarePinsFromConfig(rawSlice: unknown): RemoteHardwarePinView[] {
  const pins = meshtasticConfigSlice(rawSlice).availablePins;
  if (!Array.isArray(pins)) return [];
  const out: RemoteHardwarePinView[] = [];
  for (const pin of pins as unknown[]) {
    if (!pin || typeof pin !== 'object') continue;
    const p = pin as Record<string, unknown>;
    out.push({
      gpioPin: typeof p.gpioPin === 'number' ? p.gpioPin : 0,
      name: typeof p.name === 'string' ? p.name : '',
      type: typeof p.type === 'number' ? p.type : 0,
    });
  }
  return out;
}
