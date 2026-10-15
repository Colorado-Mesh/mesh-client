import {
  type MeshcoreCompanionCliConnection,
  type MeshcoreCompanionCliResult,
  runMeshcoreCompanionCli,
  stripCliValueMarker,
} from './meshcoreCompanionCli';

export type MeshcoreCompanionSettingGroup = 'device' | 'radio' | 'wifi';

/**
 * `readonly`: shown, never written. `secret`: masked input; read only on explicit reveal.
 * `toggle` values are normalized to `'on'` / `'off'`.
 */
export type MeshcoreCompanionSettingKind = 'number' | 'toggle' | 'text' | 'secret' | 'readonly';

/** i18n keys under `meshcoreCompanionCli.validation.*`. */
export type MeshcoreCompanionSettingError =
  'required' | 'notNumber' | 'notInteger' | 'outOfRange' | 'tooLong' | 'invalidChars' | 'pinFormat';

export interface MeshcoreCompanionSettingDescriptor {
  key: string;
  group: MeshcoreCompanionSettingGroup;
  kind: MeshcoreCompanionSettingKind;
  /** Omitted for write-only settings (BLE PIN) and reveal-only secrets. */
  getCommand?: string;
  setCommand?: (value: string) => string;
  /** Reply → normalized value; defaults to {@link stripCliValueMarker}. */
  parse?: (reply: string) => string;
  validate?: (value: string) => MeshcoreCompanionSettingError | null;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  rebootRequired: boolean;
}

/** Command that reads a `secret` setting on demand (never part of bulk reads). */
export const MESHCORE_COMPANION_SECRET_GET_COMMANDS: Readonly<Record<string, string>> = {
  'wifi.pwd': 'get wifi.pwd',
};

function numberValidator(
  min: number,
  max: number,
  integer: boolean,
): (value: string) => MeshcoreCompanionSettingError | null {
  return (value) => {
    const trimmed = value.trim();
    if (trimmed === '') return 'required';
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return 'notNumber';
    if (integer && !Number.isInteger(n)) return 'notInteger';
    if (n < min || n > max) return 'outOfRange';
    return null;
  };
}

function textValidator(
  maxLength: number,
  allowEmpty: boolean,
): (value: string) => MeshcoreCompanionSettingError | null {
  return (value) => {
    if (!allowEmpty && value.trim() === '') return 'required';
    if (/[\r\n\0]/.test(value)) return 'invalidChars';
    if (new TextEncoder().encode(value).length > maxLength) return 'tooLong';
    return null;
  };
}

const parseOnOff = (reply: string): string =>
  stripCliValueMarker(reply).toLowerCase() === 'on' ? 'on' : 'off';

const parseBoolDigit = (reply: string): string =>
  stripCliValueMarker(reply) === '0' ? 'off' : 'on';

const parseLeadingNumber = (reply: string): string => {
  const m = /-?[\d.]+/.exec(stripCliValueMarker(reply));
  return m ? m[0] : '';
};

const parseSsid = (reply: string): string => {
  const v = stripCliValueMarker(reply);
  return v === '(not set)' ? '' : v;
};

const parseIp = (reply: string): string => {
  const v = stripCliValueMarker(reply);
  return v === '(not connected)' ? '' : v;
};

const onOffSetter =
  (name: string) =>
  (value: string): string =>
    `set ${name} ${value === 'on' ? 'on' : 'off'}`;

const plainSetter =
  (name: string) =>
  (value: string): string =>
    `set ${name} ${value.trim()}`;

export const MESHCORE_COMPANION_SETTINGS: readonly MeshcoreCompanionSettingDescriptor[] = [
  { key: 'ver', group: 'device', kind: 'readonly', getCommand: 'ver', rebootRequired: false },
  { key: 'board', group: 'device', kind: 'readonly', getCommand: 'board', rebootRequired: false },
  {
    key: 'tz.offset',
    group: 'device',
    kind: 'number',
    getCommand: 'get tz.offset',
    setCommand: plainSetter('tz.offset'),
    parse: parseLeadingNumber,
    validate: numberValidator(-12, 14, true),
    min: -12,
    max: 14,
    step: 1,
    rebootRequired: false,
  },
  {
    key: 'pin',
    group: 'device',
    kind: 'secret',
    setCommand: (value) => `set pin ${value.trim()}`,
    validate: (value) => (/^(0|\d{6})$/.test(value.trim()) ? null : 'pinFormat'),
    maxLength: 6,
    rebootRequired: true,
  },
  {
    key: 'af',
    group: 'radio',
    kind: 'number',
    getCommand: 'get af',
    setCommand: plainSetter('af'),
    parse: parseLeadingNumber,
    validate: numberValidator(0, 9, false),
    min: 0,
    max: 9,
    step: 0.1,
    rebootRequired: false,
  },
  {
    key: 'dutycycle',
    group: 'radio',
    kind: 'readonly',
    getCommand: 'get dutycycle',
    rebootRequired: false,
  },
  {
    key: 'int.thresh',
    group: 'radio',
    kind: 'number',
    getCommand: 'get int.thresh',
    setCommand: plainSetter('int.thresh'),
    parse: parseLeadingNumber,
    validate: numberValidator(0, 255, true),
    min: 0,
    max: 255,
    step: 1,
    rebootRequired: false,
  },
  {
    key: 'cad',
    group: 'radio',
    kind: 'toggle',
    getCommand: 'get cad',
    setCommand: onOffSetter('cad'),
    parse: parseOnOff,
    rebootRequired: false,
  },
  {
    key: 'radio.rxgain',
    group: 'radio',
    kind: 'toggle',
    getCommand: 'get radio.rxgain',
    setCommand: onOffSetter('radio.rxgain'),
    parse: parseOnOff,
    rebootRequired: false,
  },
  {
    key: 'rxdelay',
    group: 'radio',
    kind: 'number',
    getCommand: 'get rxdelay',
    setCommand: plainSetter('rxdelay'),
    parse: parseLeadingNumber,
    validate: numberValidator(0, 20, false),
    min: 0,
    max: 20,
    step: 0.1,
    rebootRequired: false,
  },
  {
    key: 'agc.reset.interval',
    group: 'radio',
    kind: 'number',
    getCommand: 'get agc.reset.interval',
    setCommand: plainSetter('agc.reset.interval'),
    parse: parseLeadingNumber,
    validate: numberValidator(0, 1020, true),
    min: 0,
    max: 1020,
    step: 4,
    rebootRequired: false,
  },
  {
    key: 'txdelay',
    group: 'radio',
    kind: 'number',
    getCommand: 'get txdelay',
    setCommand: plainSetter('txdelay'),
    parse: parseLeadingNumber,
    validate: numberValidator(0, 2, false),
    min: 0,
    max: 2,
    step: 0.1,
    rebootRequired: false,
  },
  {
    key: 'direct.txdelay',
    group: 'radio',
    kind: 'number',
    getCommand: 'get direct.txdelay',
    setCommand: plainSetter('direct.txdelay'),
    parse: parseLeadingNumber,
    validate: numberValidator(0, 2, false),
    min: 0,
    max: 2,
    step: 0.1,
    rebootRequired: false,
  },
  {
    key: 'wifi.enabled',
    group: 'wifi',
    kind: 'toggle',
    getCommand: 'get wifi.enabled',
    setCommand: (value) => `set wifi.enabled ${value === 'on' ? 1 : 0}`,
    parse: parseBoolDigit,
    rebootRequired: true,
  },
  {
    key: 'wifi.ssid',
    group: 'wifi',
    kind: 'text',
    getCommand: 'get wifi.ssid',
    setCommand: (value) => `set wifi.ssid ${value}`,
    parse: parseSsid,
    validate: textValidator(32, false),
    maxLength: 32,
    rebootRequired: true,
  },
  {
    key: 'wifi.pwd',
    group: 'wifi',
    kind: 'secret',
    setCommand: (value) => `set wifi.pwd ${value}`,
    validate: textValidator(63, true),
    maxLength: 63,
    rebootRequired: true,
  },
  {
    key: 'wifi.status',
    group: 'wifi',
    kind: 'readonly',
    getCommand: 'get wifi.status',
    rebootRequired: false,
  },
  {
    key: 'wifi.ip',
    group: 'wifi',
    kind: 'readonly',
    getCommand: 'get wifi.ip',
    parse: parseIp,
    rebootRequired: false,
  },
];

export const MESHCORE_COMPANION_WIFI_CLEAR_COMMAND = 'set wifi.clear';

export function getMeshcoreCompanionSetting(
  key: string,
): MeshcoreCompanionSettingDescriptor | undefined {
  return MESHCORE_COMPANION_SETTINGS.find((s) => s.key === key);
}

export interface MeshcoreCompanionSettingsSnapshot {
  values: Record<string, string>;
  /** Keys the radio answered `Unknown command` for (e.g. no WiFi in this build). */
  unsupported: string[];
  /** False when the WiFi probe (`get wifi.enabled`) is unknown to the firmware. */
  wifiSupported: boolean;
}

export type MeshcoreCompanionCliRunner = (command: string) => Promise<MeshcoreCompanionCliResult>;

export function companionCliRunnerFor(
  conn: MeshcoreCompanionCliConnection,
): MeshcoreCompanionCliRunner {
  return (command) => runMeshcoreCompanionCli(conn, command);
}

/** Read every readable non-secret setting; WiFi keys are skipped when the probe is unsupported. */
export async function readAllMeshcoreCompanionSettings(
  run: MeshcoreCompanionCliRunner,
): Promise<MeshcoreCompanionSettingsSnapshot> {
  const values: Record<string, string> = {};
  const unsupported: string[] = [];
  let wifiSupported = true;
  for (const s of MESHCORE_COMPANION_SETTINGS) {
    if (!s.getCommand) continue;
    if (s.group === 'wifi' && !wifiSupported) {
      unsupported.push(s.key);
      continue;
    }
    const result = await run(s.getCommand);
    if (result.kind === 'unsupported') {
      unsupported.push(s.key);
      if (s.key === 'wifi.enabled') wifiSupported = false;
      continue;
    }
    values[s.key] = (s.parse ?? stripCliValueMarker)(result.reply);
  }
  return { values, unsupported, wifiSupported };
}

export interface MeshcoreCompanionApplyResult {
  ok: boolean;
  reply: string;
  rebootRequired: boolean;
}

const ERROR_REPLY = /^error\b/i;

/** Validate and write one setting; `ok` is false on validation, unsupported or firmware error. */
export async function applyMeshcoreCompanionSetting(
  run: MeshcoreCompanionCliRunner,
  key: string,
  value: string,
): Promise<MeshcoreCompanionApplyResult> {
  const s = getMeshcoreCompanionSetting(key);
  if (!s?.setCommand) throw new Error(`companion setting is not writable: ${key}`);
  const err = s.validate?.(value) ?? null;
  if (err) throw new Error(`invalid value for ${key}: ${err}`);
  const result = await run(s.setCommand(value));
  const reply = stripCliValueMarker(result.reply);
  const ok = result.kind === 'ok' && !ERROR_REPLY.test(reply);
  return {
    ok,
    reply,
    rebootRequired: ok && (s.rebootRequired || meshcoreCliReplyNeedsReboot(reply)),
  };
}

/** True when a firmware reply says the change only applies after a reboot. */
export function meshcoreCliReplyNeedsReboot(reply: string): boolean {
  return /reboot to apply|then reboot/i.test(reply);
}
