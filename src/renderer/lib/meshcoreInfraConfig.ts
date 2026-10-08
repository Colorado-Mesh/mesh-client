import { serializeMeshcoreUserMessage } from './meshcore/meshcoreMessageI18n';

export type InfraConfigSection = 'identity' | 'radio' | 'routing' | 'room';
export type InfraConfigValues = Partial<Record<InfraConfigKey, string>>;
export type InfraConfigKey =
  | 'name'
  | 'owner.info'
  | 'lat'
  | 'lon'
  | 'frequency'
  | 'bandwidth'
  | 'sf'
  | 'cr'
  | 'tx'
  | 'repeat'
  | 'path.hash.mode'
  | 'advert.interval'
  | 'flood.advert.interval'
  | 'flood.max'
  | 'allow.read.only'
  | 'guest.password';

export interface InfraConfigField {
  key: InfraConfigKey;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'password';
  min?: number;
  max?: number;
  integer?: boolean;
  maxBytes?: number;
  options?: string[];
}

export const INFRA_CONFIG_FIELDS: Record<InfraConfigSection, InfraConfigField[]> = {
  identity: [
    { key: 'name', label: 'infraConfig.name', type: 'text', maxBytes: 31 },
    { key: 'owner.info', label: 'infraConfig.ownerInfo', type: 'text', maxBytes: 119 },
    { key: 'lat', label: 'infraConfig.latitude', type: 'number', min: -90, max: 90 },
    { key: 'lon', label: 'infraConfig.longitude', type: 'number', min: -180, max: 180 },
  ],
  radio: [
    { key: 'frequency', label: 'infraConfig.frequency', type: 'number', min: 150, max: 2500 },
    {
      key: 'bandwidth',
      label: 'infraConfig.bandwidth',
      type: 'select',
      options: ['7.8', '10.4', '15.6', '20.8', '31.25', '41.7', '62.5', '125', '250', '500'],
    },
    { key: 'sf', label: 'infraConfig.sf', type: 'number', min: 5, max: 12, integer: true },
    { key: 'cr', label: 'infraConfig.cr', type: 'number', min: 5, max: 8, integer: true },
    { key: 'tx', label: 'infraConfig.tx', type: 'number', min: -9, max: 30, integer: true },
  ],
  routing: [
    { key: 'repeat', label: 'infraConfig.repeat', type: 'boolean' },
    {
      key: 'path.hash.mode',
      label: 'infraConfig.pathHash',
      type: 'select',
      options: ['0', '1', '2'],
    },
    {
      key: 'advert.interval',
      label: 'infraConfig.advertInterval',
      type: 'number',
      min: 0,
      max: 240,
      integer: true,
    },
    {
      key: 'flood.advert.interval',
      label: 'infraConfig.floodAdvertInterval',
      type: 'number',
      min: 0,
      max: 168,
      integer: true,
    },
    {
      key: 'flood.max',
      label: 'infraConfig.floodMax',
      type: 'number',
      min: 0,
      max: 64,
      integer: true,
    },
  ],
  room: [
    { key: 'allow.read.only', label: 'infraConfig.allowReadOnly', type: 'boolean' },
    { key: 'guest.password', label: 'infraConfig.guestPassword', type: 'password', maxBytes: 15 },
  ],
};

export interface InfraConfigSnapshot {
  values: InfraConfigValues;
  unavailable: InfraConfigKey[];
}

export type InfraConfigSend = (
  command: string,
  isCurrent?: InfraConfigIsCurrent,
) => Promise<string>;
export type InfraConfigIsCurrent = () => boolean;

function configError(key: string): Error {
  return new Error(serializeMeshcoreUserMessage({ key }));
}

function assertCurrent(isCurrent: InfraConfigIsCurrent): void {
  if (!isCurrent()) throw configError('infraConfig.sessionChanged');
}

function isUnsupported(response: string): boolean {
  return /^(?:\?\?:|unknown (?:command|config)|error[: ,]+unsupported)/i.test(response.trim());
}

export function assertInfraConfigCommandOk(response: string): void {
  if (!/^\(?OK\b/i.test(response.trim())) throw configError('infraConfig.commandRejected');
}

const RADIO_KEYS: InfraConfigKey[] = ['frequency', 'bandwidth', 'sf', 'cr'];

interface ConfigRead {
  command: string;
  keys: InfraConfigKey[];
}

function sectionReads(section: InfraConfigSection): ConfigRead[] {
  if (section === 'radio')
    return [
      { command: 'get radio', keys: RADIO_KEYS },
      { command: 'get tx', keys: ['tx'] },
    ];
  return INFRA_CONFIG_FIELDS[section].map(({ key }) => ({ command: `get ${key}`, keys: [key] }));
}

function parseRead(read: ConfigRead, response: string): InfraConfigValues {
  if (!response.trimStart().startsWith('>')) throw configError('infraConfig.invalidReply');
  const body = response.trimStart();
  const value = body.startsWith('> ') ? body.slice(2) : body.slice(1);
  const parts = read.keys.length > 1 ? value.split(',').map((part) => part.trim()) : [value];
  if (parts.length !== read.keys.length) throw configError('infraConfig.invalidReply');
  const values: InfraConfigValues = {};
  read.keys.forEach((key, index) => {
    values[key] = parts[index];
  });
  for (const field of Object.values(INFRA_CONFIG_FIELDS).flat()) {
    const current = values[field.key];
    if (current === undefined || field.type === 'text' || field.type === 'password') continue;
    if (field.type === 'boolean' && !['on', 'off'].includes(current))
      throw configError('infraConfig.invalidReply');
    if (field.type === 'select') {
      const option = field.options?.find((item) => Number(item) === Number(current));
      if (!current || option === undefined) throw configError('infraConfig.invalidReply');
      values[field.key] = option;
    }
    if (field.type === 'number' && (!current || !Number.isFinite(Number(current))))
      throw configError('infraConfig.invalidReply');
  }
  return values;
}

export async function readInfraConfig(
  section: InfraConfigSection,
  send: InfraConfigSend,
  isCurrent: InfraConfigIsCurrent,
): Promise<InfraConfigSnapshot> {
  const values: InfraConfigValues = {};
  const unavailable: InfraConfigKey[] = [];
  for (const read of sectionReads(section)) {
    assertCurrent(isCurrent);
    const response = await send(read.command, isCurrent);
    assertCurrent(isCurrent);
    if (isUnsupported(response)) unavailable.push(...read.keys);
    else Object.assign(values, parseRead(read, response));
  }
  return { values, unavailable };
}

export function validateInfraConfigValue(field: InfraConfigField, value: string): void {
  if (/[\r\n\0]/.test(value)) throw configError('infraConfig.invalidValue');
  if (field.maxBytes != null && new TextEncoder().encode(value).length > field.maxBytes)
    throw configError('infraConfig.invalidValue');
  if (field.key === 'name' && (!value.trim() || /[[\]\\:,?*]/.test(value)))
    throw configError('infraConfig.invalidValue');
  if (field.type === 'boolean' && !['on', 'off'].includes(value))
    throw configError('infraConfig.invalidValue');
  if (field.type === 'select' && !field.options?.includes(value))
    throw configError('infraConfig.invalidValue');
  if (field.type === 'number') {
    const number = Number(value);
    if (
      !value.trim() ||
      !Number.isFinite(number) ||
      (field.integer && !Number.isInteger(number)) ||
      (field.min != null && number < field.min) ||
      (field.max != null && number > field.max)
    )
      throw configError('infraConfig.invalidValue');
    if (field.key === 'flood.advert.interval' && number > 0 && number < 3)
      throw configError('infraConfig.invalidValue');
    if (field.key === 'advert.interval' && (number % 2 !== 0 || (number > 0 && number < 60)))
      throw configError('infraConfig.invalidValue');
  }
}

/** Firmware float32 readbacks can be equivalent without having the same decimal text. */
export function infraConfigValueMatches(
  field: InfraConfigField,
  expected: string | undefined,
  actual: string | undefined,
): boolean {
  if (expected === undefined || actual === undefined) return expected === actual;
  if (field.type !== 'number') return expected === actual;
  return (
    Math.min(
      Math.abs(Number(expected) - Number(actual)),
      Math.abs(Math.fround(Number(expected)) - Number(actual)),
    ) < 0.00001
  );
}

export interface InfraConfigApplyResult {
  values: InfraConfigValues;
  appliedKeys: InfraConfigKey[];
  rebootRequired: boolean;
  error?: Error;
}

/** A failed multi-command apply preserves confirmed values; the caller keeps unsaved edits. */
export async function applyInfraConfig(
  section: InfraConfigSection,
  original: InfraConfigValues,
  edited: InfraConfigValues,
  send: InfraConfigSend,
  isCurrent: InfraConfigIsCurrent,
): Promise<InfraConfigApplyResult> {
  const result: InfraConfigApplyResult = {
    values: { ...original },
    appliedKeys: [],
    rebootRequired: false,
  };
  const fields = INFRA_CONFIG_FIELDS[section];
  const changed = fields.filter(
    ({ key }) => edited[key] !== undefined && edited[key] !== original[key],
  );
  const writes: { command: string; read: ConfigRead }[] = [];
  try {
    for (const field of changed) {
      if (original[field.key] === undefined) throw configError('infraConfig.loadFirst');
      validateInfraConfigValue(field, edited[field.key] ?? '');
    }
    if (section === 'radio' && changed.some(({ key }) => RADIO_KEYS.includes(key))) {
      for (const key of RADIO_KEYS) {
        const field = fields.find((item) => item.key === key);
        if (!field || original[key] === undefined) throw configError('infraConfig.loadFirst');
        validateInfraConfigValue(field, edited[key] ?? original[key]);
      }
      writes.push({
        command: `set radio ${RADIO_KEYS.map((key) => Number(edited[key] ?? original[key])).join(',')}`,
        read: { command: 'get radio', keys: RADIO_KEYS },
      });
    }
    for (const { key, type } of changed) {
      if (section === 'radio' && RADIO_KEYS.includes(key)) continue;
      writes.push({
        command: `set ${key} ${type === 'number' ? Number(edited[key]) : (edited[key] ?? '')}`,
        read: { command: `get ${key}`, keys: [key] },
      });
    }
    for (const { command, read } of writes) {
      assertCurrent(isCurrent);
      const reply = await send(command, isCurrent);
      assertCurrent(isCurrent);
      assertInfraConfigCommandOk(reply);
      result.rebootRequired ||= /reboot to apply/i.test(reply);
      // Firmware can round numeric values or truncate text. Only report saved after readback.
      const confirmed = parseRead(read, await send(read.command, isCurrent));
      assertCurrent(isCurrent);
      Object.assign(result.values, confirmed);
      result.appliedKeys.push(...read.keys);
      for (const key of read.keys) {
        const expected = edited[key] ?? original[key];
        const actual = confirmed[key];
        const field = fields.find((item) => item.key === key);
        const matches = field != null && infraConfigValueMatches(field, expected, actual);
        if (!matches) throw configError('infraConfig.readbackMismatch');
      }
    }
  } catch (error) {
    // catch-no-log-ok returned to the panel as an inline apply failure without secret-bearing replies
    result.error = error instanceof Error ? error : configError('infraConfig.commandRejected');
  }
  return result;
}
