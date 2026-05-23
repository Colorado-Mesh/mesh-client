// @vitest-environment node
import { create } from '@bufbuild/protobuf';
import { Config } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import {
  base64UrlDecode,
  base64UrlEncode,
  generateConfigUrl,
  MESHTASTIC_CHANNEL_ROLE,
  MESHTASTIC_CONFIG_URL_MAX_PAYLOAD_CHARS,
  type MeshtasticChannelConfigInput,
  type MeshtasticLoraConfig,
  MeshtasticUrlError,
  parseConfigUrl,
  pskFingerprint,
} from './meshtasticUrlEncoder';

const samplePsk = new Uint8Array(16);
samplePsk[0] = 0xab;
samplePsk[1] = 0xcd;

const sampleLora = create(Config.Config_LoRaConfigSchema, {
  region: 1,
  modemPreset: 0,
  usePreset: true,
  hopLimit: 3,
}) as MeshtasticLoraConfig;

const sampleChannels: MeshtasticChannelConfigInput[] = [
  {
    index: 0,
    role: MESHTASTIC_CHANNEL_ROLE.PRIMARY,
    name: 'TestChan',
    psk: samplePsk,
    uplinkEnabled: true,
    downlinkEnabled: false,
    positionPrecision: 10,
  },
  {
    index: 1,
    role: MESHTASTIC_CHANNEL_ROLE.SECONDARY,
    name: 'Secondary',
    psk: new Uint8Array([0x01]),
    uplinkEnabled: false,
    downlinkEnabled: true,
    positionPrecision: 0,
  },
  {
    index: 2,
    role: MESHTASTIC_CHANNEL_ROLE.DISABLED,
    name: '',
    psk: new Uint8Array([0x01]),
    uplinkEnabled: false,
    downlinkEnabled: false,
    positionPrecision: 0,
  },
];

describe('meshtasticUrlEncoder', () => {
  it('round-trips channel set with custom PSK and LoRa config', () => {
    const { httpsUrl } = generateConfigUrl(sampleChannels, sampleLora);
    const parsed = parseConfigUrl(httpsUrl);
    expect(parsed.mode).toBe('replace');
    expect(parsed.settings).toHaveLength(2);
    expect(parsed.settings[0]?.name).toBe('TestChan');
    expect(parsed.settings[0]?.psk).toEqual(samplePsk);
    expect(parsed.settings[0]?.uplinkEnabled).toBe(true);
    expect(parsed.settings[0]?.positionPrecision).toBe(10);
    expect(parsed.settings[1]?.name).toBe('Secondary');
    expect(parsed.loraConfig?.region).toBe(1);
    expect(parsed.loraConfig?.modemPreset).toBe(0);
  });

  it('generates canonical https and meshtastic URLs with matching payload', () => {
    const { httpsUrl, meshtasticUrl } = generateConfigUrl(sampleChannels, sampleLora, {
      includeAll: false,
    });
    expect(httpsUrl).toMatch(/^https:\/\/meshtastic\.org\/e\/#[A-Za-z0-9_-]+$/);
    expect(meshtasticUrl).toMatch(/^meshtastic:\/\/meshtastic\/e\/#[A-Za-z0-9_-]+$/);
    const httpsHash = httpsUrl.split('#')[1];
    const meshtasticHash = meshtasticUrl.split('#')[1];
    expect(httpsHash).toBe(meshtasticHash);
  });

  it('parses meshtastic scheme and raw hash payloads', () => {
    const { httpsUrl, meshtasticUrl } = generateConfigUrl(sampleChannels, sampleLora);
    const fromMeshtastic = parseConfigUrl(meshtasticUrl);
    const hashOnly = httpsUrl.split('#')[1] ?? '';
    const fromHash = parseConfigUrl(hashOnly);
    expect(fromMeshtastic.settings[0]?.name).toBe('TestChan');
    expect(fromHash.settings[0]?.name).toBe('TestChan');
  });

  it('detects add-only mode from ?add=true# marker', () => {
    const { httpsUrl } = generateConfigUrl(sampleChannels, sampleLora, { addOnly: true });
    expect(httpsUrl).toContain('?add=true#');
    expect(parseConfigUrl(httpsUrl).mode).toBe('add');
  });

  it('does not treat ?add=true query without hash marker as add mode', () => {
    const { httpsUrl } = generateConfigUrl(sampleChannels, sampleLora);
    const hash = httpsUrl.split('#')[1] ?? '';
    const spoofed = `https://meshtastic.org/e/?add=true&noise=1#${hash}`;
    expect(parseConfigUrl(spoofed).mode).toBe('replace');
  });

  it('throws for oversized payload', () => {
    const huge = 'A'.repeat(MESHTASTIC_CONFIG_URL_MAX_PAYLOAD_CHARS + 1);
    expect(() => parseConfigUrl(`https://meshtastic.org/e/#${huge}`)).toThrow(MeshtasticUrlError);
  });

  it('throws when no channels selected for export', () => {
    const disabled = sampleChannels[2];
    expect(() =>
      generateConfigUrl([{ ...disabled, role: MESHTASTIC_CHANNEL_ROLE.DISABLED }], undefined),
    ).toThrow(MeshtasticUrlError);
  });

  it('exports channelIndexes subset', () => {
    const { httpsUrl } = generateConfigUrl(sampleChannels, undefined, {
      channelIndexes: [1],
      includeAll: true,
    });
    const parsed = parseConfigUrl(httpsUrl);
    expect(parsed.settings).toHaveLength(1);
    expect(parsed.settings[0]?.name).toBe('Secondary');
  });

  it('pskFingerprint shows head bytes and length', () => {
    expect(pskFingerprint(samplePsk)).toBe('abcd0000… (16 B)');
    expect(pskFingerprint(new Uint8Array())).toBe('empty');
  });

  it('throws MeshtasticUrlError for invalid input', () => {
    expect(() => parseConfigUrl('')).toThrow(MeshtasticUrlError);
    expect(() => parseConfigUrl('not-a-valid-url!!!')).toThrow(MeshtasticUrlError);
    expect(() => parseConfigUrl('https://meshtastic.org/e/#!!!')).toThrow(MeshtasticUrlError);
  });

  it('base64url encode/decode is reversible', () => {
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it('excludes secondary channels when includeAll is false', () => {
    const { httpsUrl } = generateConfigUrl(sampleChannels, undefined, { includeAll: false });
    const parsed = parseConfigUrl(httpsUrl);
    expect(parsed.settings).toHaveLength(1);
    expect(parsed.settings[0]?.name).toBe('TestChan');
  });

  it('matches protobuf bytes from reference ChannelSet encoding', () => {
    const { httpsUrl } = generateConfigUrl(
      [
        {
          index: 0,
          role: MESHTASTIC_CHANNEL_ROLE.PRIMARY,
          name: 'Ref',
          psk: new Uint8Array([0x01]),
          uplinkEnabled: false,
          downlinkEnabled: false,
          positionPrecision: 0,
        },
      ],
      sampleLora,
      { includeAll: false },
    );
    const parsed = parseConfigUrl(httpsUrl);
    expect(parsed.settings[0]?.name).toBe('Ref');
  });
});
