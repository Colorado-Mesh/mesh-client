import { describe, expect, it } from 'vitest';

import { computeChannelIdentityKey } from '@/shared/channelIdentityKey';
import { MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES } from '@/shared/meshtasticDefaultPublicPsk';

import { notificationMqttChannelKeys } from './notificationMqttChannelKeys';

const defaultKey = computeChannelIdentityKey(
  'meshtastic',
  'LongFast',
  MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES,
);
const defaultBase64 = btoa(String.fromCharCode(...MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES));

describe('canonical MQTT notification channel identity', () => {
  it.each([[], ['AQ=='], ['LongFast=AQ=='], ['LongFast@0=AQ=='], [`LongFast@0=${defaultBase64}`]])(
    'retains the normal public default and equivalent explicit settings: %j',
    (...lines: string[]) => {
      expect(notificationMqttChannelKeys(lines)).toEqual({ 0: defaultKey });
    },
  );

  it('uses explicit slots and full configured keys without persisting their raw values', () => {
    const psk = new Uint8Array(16).fill(3);
    const base64 = btoa(String.fromCharCode(...psk));
    const result = notificationMqttChannelKeys([`QATest@2=${base64}`]);
    expect(result).toEqual({ 2: computeChannelIdentityKey('meshtastic', 'QATest', psk) });
    expect(JSON.stringify(result)).not.toContain(base64);
    expect(notificationMqttChannelKeys(['LongFast@2=AQ=='])).toEqual({ 2: defaultKey });
  });

  it.each([['Unknown=AQ=='], ['Bad@0=%%%'], ['LongFast@0=AA=='], ['Cw'], ['Cw==']])(
    'does not invent a slot or a valid identity for unsupported settings: %j',
    (...lines: string[]) => {
      expect(notificationMqttChannelKeys(lines)).toEqual({});
    },
  );
});
