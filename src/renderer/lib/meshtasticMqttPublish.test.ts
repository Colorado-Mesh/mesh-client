import { beforeEach, describe, expect, it } from 'vitest';

import { MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES } from '@/shared/meshtasticDefaultPublicPsk';

import {
  buildMeshtasticMqttOnlyChannelState,
  isNonTrivialMeshtasticChannelPsk,
  loadMeshtasticMqttManualChannelPsks,
  meshtasticMqttChannelKeyEntries,
  meshtasticMqttChannelKeyEntriesFromManual,
  meshtasticMqttPublishFields,
  resolveMeshtasticMqttChannelName,
  resolveMeshtasticMqttPublishFieldsForChannel,
} from './meshtasticMqttPublish';

const KEY_AES256 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const KEY_B = 'AAAAAAAAAAAAAAAAAAAAAA==';

describe('resolveMeshtasticMqttChannelName', () => {
  it('uses configured channel name when set', () => {
    expect(
      resolveMeshtasticMqttChannelName({
        index: 1,
        name: 'HamNet',
        role: 2,
        psk: new Uint8Array(16),
      }),
    ).toBe('HamNet');
  });

  it('falls back to LongFast for unnamed primary', () => {
    expect(
      resolveMeshtasticMqttChannelName({ index: 0, name: '', role: 1, psk: new Uint8Array([1]) }),
    ).toBe('LongFast');
  });

  it('returns empty string for unnamed secondary (skip MQTT publish)', () => {
    expect(
      resolveMeshtasticMqttChannelName({ index: 1, name: '', role: 2, psk: new Uint8Array([1]) }),
    ).toBe('');
  });
});

describe('isNonTrivialMeshtasticChannelPsk', () => {
  it('rejects empty and default single-byte keys', () => {
    expect(isNonTrivialMeshtasticChannelPsk(new Uint8Array(0))).toBe(false);
    expect(isNonTrivialMeshtasticChannelPsk(new Uint8Array([0]))).toBe(false);
    expect(isNonTrivialMeshtasticChannelPsk(new Uint8Array([1]))).toBe(false);
  });

  it('accepts AES key material', () => {
    expect(isNonTrivialMeshtasticChannelPsk(new Uint8Array(16).fill(1))).toBe(true);
  });
});

describe('meshtasticMqttPublishFields', () => {
  it('includes base64 PSK and disables JSON mirror for private keys', () => {
    const psk = new Uint8Array(32).fill(0xab);
    const fields = meshtasticMqttPublishFields({ index: 1, name: 'Private', role: 2, psk });
    expect(fields.channelName).toBe('Private');
    expect(Uint8Array.from(atob(fields.pskBase64), (c) => c.charCodeAt(0)).length).toBe(32);
    expect(fields.publishJsonMirror).toBe(false);
  });
});

describe('resolveMeshtasticMqttPublishFieldsForChannel', () => {
  it('uses manual LongFast@0 entry when radio configs are empty (MQTT-only)', () => {
    const fields = resolveMeshtasticMqttPublishFieldsForChannel(
      0,
      [],
      [`LongFast@0=${KEY_AES256}`],
    );
    expect(fields.channelName).toBe('LongFast');
    expect(fields.pskBase64).toBe(KEY_AES256);
    expect(fields.publishJsonMirror).toBe(false);
  });

  it('prefers radio config when non-trivial PSK is present', () => {
    const radioPsk = new Uint8Array(32).fill(0xcd);
    const fields = resolveMeshtasticMqttPublishFieldsForChannel(
      1,
      [{ index: 1, name: 'HamNet', role: 2, psk: radioPsk }],
      [`HamNet@1=${KEY_AES256}`],
    );
    expect(fields.channelName).toBe('HamNet');
    expect(fields.pskBase64).toBe(btoa(String.fromCharCode(...radioPsk)));
  });

  it('prefers manual over stale radio config when preferManualOverRadio', () => {
    const stalePsk = new Uint8Array(32).fill(0xcd);
    const fields = resolveMeshtasticMqttPublishFieldsForChannel(
      0,
      [{ index: 0, name: 'LongFast', role: 1, psk: stalePsk }],
      [`LongFast@0=${KEY_AES256}`],
      { preferManualOverRadio: true },
    );
    expect(fields.pskBase64).toBe(KEY_AES256);
    expect(fields.pskBase64).not.toBe(btoa(String.fromCharCode(...stalePsk)));
  });

  it('falls back to manual entry when radio has default PSK only', () => {
    const fields = resolveMeshtasticMqttPublishFieldsForChannel(
      0,
      [{ index: 0, name: '', role: 1, psk: new Uint8Array([1]) }],
      [`LongFast@0=${KEY_AES256}`],
    );
    expect(fields.channelName).toBe('LongFast');
    expect(fields.pskBase64).toBe(KEY_AES256);
  });

  it('matches manual entry by name for primary LongFast', () => {
    const fields = resolveMeshtasticMqttPublishFieldsForChannel(0, [], [`LongFast=${KEY_AES256}`]);
    expect(fields.channelName).toBe('LongFast');
    expect(fields.pskBase64).toBe(KEY_AES256);
  });

  it('uses @index manual entry for secondary channel', () => {
    const fields = resolveMeshtasticMqttPublishFieldsForChannel(3, [], [`Garber@3=${KEY_B}`]);
    expect(fields.channelName).toBe('Garber');
    expect(fields.pskBase64).toBe(KEY_B);
  });

  it('returns empty channel name for unnamed secondary channel without manual entry', () => {
    const fields = resolveMeshtasticMqttPublishFieldsForChannel(2, [], []);
    expect(fields.channelName).toBe('');
  });

  it('uses bare manual PSK for LongFast when no named channel 0 entry', () => {
    const fields = resolveMeshtasticMqttPublishFieldsForChannel(0, [], [KEY_AES256]);
    expect(fields.channelName).toBe('LongFast');
    expect(fields.pskBase64).toBe(KEY_AES256);
  });

  it('falls back to default public PSK instead of single-byte key when unresolved', () => {
    const fields = resolveMeshtasticMqttPublishFieldsForChannel(2, [], []);
    expect(fields.channelName).toBe('');
    const emptyCfg = resolveMeshtasticMqttPublishFieldsForChannel(0, [], []);
    expect(emptyCfg.pskBase64).toBe(
      btoa(String.fromCharCode(...MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES)),
    );
  });
});

describe('buildMeshtasticMqttOnlyChannelState', () => {
  it('builds two channel tabs from @index manual lines', () => {
    const state = buildMeshtasticMqttOnlyChannelState([
      `LongFast@0=${KEY_AES256}`,
      `TGIFMESH@1=${KEY_B}`,
    ]);
    expect(state.channels).toHaveLength(2);
    expect(state.channels.map((c) => c.index)).toEqual([0, 1]);
    expect(state.channelConfigs[0]?.psk.length).toBe(32);
    expect(state.channelConfigs[1]?.name).toBe('TGIFMESH');
  });
});

describe('meshtasticMqttChannelKeyEntriesFromManual', () => {
  it('returns entries when radio channelConfigs are empty', () => {
    const entries = meshtasticMqttChannelKeyEntriesFromManual([`LongFast@0=${KEY_AES256}`]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('LongFast');
    expect(entries[0]?.index).toBe(0);
  });
});

describe('loadMeshtasticMqttManualChannelPsks', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads channelPsks from mesh-client:mqttSettings', () => {
    localStorage.setItem(
      'mesh-client:mqttSettings',
      JSON.stringify({ channelPsks: [`HamNet=${KEY_B}`] }),
    );
    expect(loadMeshtasticMqttManualChannelPsks()).toEqual([`HamNet=${KEY_B}`]);
  });

  it('recovers channelPsks from mesh-client:mqttSettings:meshcore after legacy migration', () => {
    localStorage.setItem(
      'mesh-client:mqttSettings:meshcore',
      JSON.stringify({
        topicPrefix: 'meshcore/DEN',
        channelPsks: [`LongFast@0=${KEY_B}`],
      }),
    );
    expect(loadMeshtasticMqttManualChannelPsks()).toEqual([`LongFast@0=${KEY_B}`]);
  });

  it('returns empty array when unset', () => {
    expect(loadMeshtasticMqttManualChannelPsks()).toEqual([]);
  });
});

describe('meshtasticMqttChannelKeyEntries', () => {
  it('skips disabled channels and includes named channels', () => {
    const entries = meshtasticMqttChannelKeyEntries([
      { index: 0, name: 'Primary', role: 1, psk: new Uint8Array(16).fill(1) },
      { index: 1, name: 'Off', role: 0, psk: new Uint8Array(16).fill(2) },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Primary');
    expect(entries[0]?.index).toBe(0);
  });

  it('includes channel index for each entry', () => {
    const entries = meshtasticMqttChannelKeyEntries([
      { index: 2, name: 'HamNet', role: 2, psk: new Uint8Array(32).fill(3) },
    ]);
    expect(entries).toEqual([expect.objectContaining({ name: 'HamNet', index: 2 })]);
  });

  it('skips default public single-byte PSK (AQ==)', () => {
    const entries = meshtasticMqttChannelKeyEntries([
      { index: 0, name: 'LongFast', role: 1, psk: new Uint8Array([1]) },
      { index: 1, name: 'Private', role: 2, psk: new Uint8Array(16).fill(9) },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Private');
  });
});
