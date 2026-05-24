import { describe, expect, it } from 'vitest';

import {
  meshtasticMqttChannelKeyEntries,
  meshtasticMqttPublishFields,
  resolveMeshtasticMqttChannelName,
} from './meshtasticMqttPublish';

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

describe('meshtasticMqttPublishFields', () => {
  it('includes base64 PSK and disables JSON mirror for private keys', () => {
    const psk = new Uint8Array(32).fill(0xab);
    const fields = meshtasticMqttPublishFields({ index: 1, name: 'Private', role: 2, psk });
    expect(fields.channelName).toBe('Private');
    expect(Uint8Array.from(atob(fields.pskBase64), (c) => c.charCodeAt(0)).length).toBe(32);
    expect(fields.publishJsonMirror).toBe(false);
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
});
