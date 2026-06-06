import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { AppOnly, Channel } from '@meshtastic/protobufs';

import {
  MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES,
  normalizeMeshtasticPskTo16Bytes,
} from './meshtasticDefaultPublicPsk';

/** LoRa section of ChannelSet URLs (subset of meshtastic.Config.LoRaConfig). */
export interface MeshtasticLoraConfig {
  region?: number;
  modemPreset?: number;
  usePreset?: boolean;
  hopLimit?: number;
  bandwidth?: number;
  spreadFactor?: number;
  codingRate?: number;
  txPower?: number;
  sx126xRxBoostedGain?: boolean;
}

export const MESHTASTIC_CHANNEL_ROLE = {
  DISABLED: 0,
  PRIMARY: 1,
  SECONDARY: 2,
} as const;

export interface MeshtasticChannelSettingsInput {
  name: string;
  psk: Uint8Array;
  uplinkEnabled: boolean;
  downlinkEnabled: boolean;
  positionPrecision: number;
}

/** Channel row used when building export URLs (includes slot index and role). */
export interface MeshtasticChannelConfigInput extends MeshtasticChannelSettingsInput {
  index: number;
  role: number;
}

export interface GenerateConfigUrlOptions {
  /** Include SECONDARY channels (default true). PRIMARY is always included when enabled. */
  includeAll?: boolean;
  /** Append `?add=true` before `#` for add-only import links. */
  addOnly?: boolean;
  /** Export only these channel indexes (optional subset). */
  channelIndexes?: number[];
}

export interface ParsedChannelSet {
  settings: MeshtasticChannelSettingsInput[];
  loraConfig?: MeshtasticLoraConfig;
  mode: 'replace' | 'add';
}

/** Max base64url payload length before decode (guards pasted URLs in the renderer). */
export const MESHTASTIC_CONFIG_URL_MAX_PAYLOAD_CHARS = 16 * 1024;

export class MeshtasticUrlError extends Error {
  constructor(message = 'Invalid or corrupted Meshtastic configuration link') {
    super(message);
    this.name = 'MeshtasticUrlError';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function base64UrlDecode(encoded: string): Uint8Array {
  const padded = encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), '=');
  const standard = padded.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(standard);
}

function channelSettingsToProtobuf(input: MeshtasticChannelSettingsInput) {
  return create(Channel.ChannelSettingsSchema, {
    name: input.name,
    psk: input.psk,
    uplinkEnabled: input.uplinkEnabled,
    downlinkEnabled: input.downlinkEnabled,
    moduleSettings: create(Channel.ModuleSettingsSchema, {
      positionPrecision: input.positionPrecision,
    }),
  });
}

function channelSettingsFromProtobuf(settings: {
  name?: string;
  psk?: Uint8Array | string;
  uplinkEnabled?: boolean;
  downlinkEnabled?: boolean;
  moduleSettings?: { positionPrecision?: number };
}): MeshtasticChannelSettingsInput {
  const pskRaw = settings.psk;
  const pskBytes =
    pskRaw == null
      ? MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES
      : pskRaw instanceof Uint8Array
        ? pskRaw.length === 0
          ? MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES
          : pskRaw
        : typeof pskRaw === 'string'
          ? base64ToBytes(pskRaw)
          : MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES;
  const psk = normalizeMeshtasticPskTo16Bytes(pskBytes);
  return {
    name: settings.name ?? '',
    psk,
    uplinkEnabled: settings.uplinkEnabled ?? false,
    downlinkEnabled: settings.downlinkEnabled ?? false,
    positionPrecision: settings.moduleSettings?.positionPrecision ?? 0,
  };
}

function selectChannelsForExport(
  channels: MeshtasticChannelConfigInput[],
  options?: GenerateConfigUrlOptions,
): MeshtasticChannelSettingsInput[] {
  const includeAll = options?.includeAll !== false;
  const indexes = options?.channelIndexes;

  const selected = channels
    .filter((ch) => {
      if (indexes && !indexes.includes(ch.index)) return false;
      if (ch.role === MESHTASTIC_CHANNEL_ROLE.DISABLED) return false;
      if (ch.role === MESHTASTIC_CHANNEL_ROLE.PRIMARY) return true;
      if (ch.role === MESHTASTIC_CHANNEL_ROLE.SECONDARY) return includeAll;
      return false;
    })
    .sort((a, b) => a.index - b.index);

  return selected.map(({ name, psk, uplinkEnabled, downlinkEnabled, positionPrecision }) => ({
    name,
    psk,
    uplinkEnabled,
    downlinkEnabled,
    positionPrecision,
  }));
}

function buildChannelSet(
  settings: MeshtasticChannelSettingsInput[],
  loraConfig?: MeshtasticLoraConfig,
) {
  return create(AppOnly.ChannelSetSchema, {
    settings: settings.map(channelSettingsToProtobuf),
    ...(loraConfig ? { loraConfig } : {}),
  });
}

/** Matches Meshtastic Python client add-only links (`/?add=true#` before payload). */
function isAddOnlyConfigUrl(url: string): boolean {
  return /\?add=true#/i.test(url);
}

function extractPayloadFromUrl(url: string): { payload: string; mode: 'replace' | 'add' } {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new MeshtasticUrlError();
  }

  const mode: 'replace' | 'add' = isAddOnlyConfigUrl(trimmed) ? 'add' : 'replace';

  const hashIdx = trimmed.indexOf('#');
  if (hashIdx >= 0) {
    const payload = trimmed.slice(hashIdx + 1).trim();
    if (!payload) throw new MeshtasticUrlError();
    if (payload.length > MESHTASTIC_CONFIG_URL_MAX_PAYLOAD_CHARS) {
      throw new MeshtasticUrlError('Configuration link payload is too large');
    }
    return { payload, mode };
  }

  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    if (trimmed.length > MESHTASTIC_CONFIG_URL_MAX_PAYLOAD_CHARS) {
      throw new MeshtasticUrlError('Configuration link payload is too large');
    }
    return { payload: trimmed, mode };
  }

  throw new MeshtasticUrlError();
}

export function generateConfigUrl(
  channels: MeshtasticChannelConfigInput[],
  loraConfig: MeshtasticLoraConfig | undefined,
  options?: GenerateConfigUrlOptions,
): { httpsUrl: string; meshtasticUrl: string } {
  const settings = selectChannelsForExport(channels, options);
  if (settings.length === 0) {
    throw new MeshtasticUrlError('No channels selected for export');
  }

  const channelSet = buildChannelSet(settings, loraConfig);
  const encoded = base64UrlEncode(toBinary(AppOnly.ChannelSetSchema, channelSet));
  const query = options?.addOnly ? '?add=true' : '';
  const httpsUrl = `https://meshtastic.org/e/${query}#${encoded}`;
  const meshtasticUrl = `meshtastic://meshtastic/e/${query}#${encoded}`;
  return { httpsUrl, meshtasticUrl };
}

/** Wire shape from AppOnly.ChannelSet — localized cast (bufbuild Message omits schema fields in TS). */
interface WireChannelSet {
  settings?: Parameters<typeof channelSettingsFromProtobuf>[0][];
  loraConfig?: MeshtasticLoraConfig;
}

function decodeWireChannelSet(bytes: Uint8Array): WireChannelSet {
  return fromBinary(AppOnly.ChannelSetSchema, bytes) as WireChannelSet;
}

export function parseConfigUrl(url: string): ParsedChannelSet {
  try {
    const { payload, mode } = extractPayloadFromUrl(url);
    const bytes = base64UrlDecode(payload);
    const channelSet = decodeWireChannelSet(bytes);
    if (!channelSet.settings?.length) {
      throw new MeshtasticUrlError();
    }
    return {
      settings: channelSet.settings.map(channelSettingsFromProtobuf),
      loraConfig: channelSet.loraConfig,
      mode,
    };
  } catch (e) {
    if (e instanceof MeshtasticUrlError) throw e;
    throw new MeshtasticUrlError();
  }
}

/** Fingerprint for UI preview (first 4 bytes hex + length). */
export function pskFingerprint(psk: Uint8Array): string {
  if (psk.length === 0) return 'empty';
  const head = Array.from(psk.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${head}… (${psk.length} B)`;
}
