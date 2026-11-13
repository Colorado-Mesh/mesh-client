import { describe, expect, it } from 'vitest';

import {
  channelPskStrength,
  channelSecurityBadgeKinds,
  channelSharesPreciseLocation,
} from './channelSecurityBadges';

describe('channelSecurityBadges', () => {
  it('classifies PSK strength by length', () => {
    expect(channelPskStrength(new Uint8Array())).toBe('none');
    expect(channelPskStrength(new Uint8Array([0]))).toBe('none');
    expect(channelPskStrength(new Uint8Array([1]))).toBe('simple');
    expect(channelPskStrength(new Uint8Array(16))).toBe('aes128');
    expect(channelPskStrength(new Uint8Array(32))).toBe('aes256');
  });

  it('flags precise location and MQTT uplink', () => {
    expect(channelSharesPreciseLocation(0)).toBe(false);
    expect(channelSharesPreciseLocation(13)).toBe(false);
    expect(channelSharesPreciseLocation(32)).toBe(true);
    expect(
      channelSecurityBadgeKinds({
        psk: new Uint8Array([0]),
        uplinkEnabled: true,
        positionPrecision: 32,
      }),
    ).toEqual(['pskWeak', 'preciseLocation', 'mqttUplink']);
    expect(
      channelSecurityBadgeKinds({
        psk: new Uint8Array(32),
        uplinkEnabled: false,
        positionPrecision: 0,
      }),
    ).toEqual(['pskAes256']);
    expect(
      channelSecurityBadgeKinds({
        psk: new Uint8Array(32),
        uplinkEnabled: false,
        positionPrecision: 13,
      }),
    ).toEqual(['pskAes256']);
  });
});
