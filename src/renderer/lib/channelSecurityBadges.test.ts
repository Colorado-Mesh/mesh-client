import { describe, expect, it } from 'vitest';

import {
  channelPskIsEncrypted,
  channelSecurityLevel,
  channelSecurityLevelI18nKey,
  channelSharesPreciseLocation,
} from './channelSecurityBadges';

describe('channelSecurityBadges', () => {
  it('treats 16- and 32-byte PSKs as encrypted', () => {
    expect(channelPskIsEncrypted(new Uint8Array())).toBe(false);
    expect(channelPskIsEncrypted(new Uint8Array([0]))).toBe(false);
    expect(channelPskIsEncrypted(new Uint8Array([1]))).toBe(false);
    expect(channelPskIsEncrypted(new Uint8Array(16))).toBe(true);
    expect(channelPskIsEncrypted(new Uint8Array(32))).toBe(true);
  });

  it('only treats full-precision position as precise location', () => {
    expect(channelSharesPreciseLocation(0)).toBe(false);
    expect(channelSharesPreciseLocation(13)).toBe(false);
    expect(channelSharesPreciseLocation(32)).toBe(true);
  });

  it('classifies the official four composite lock levels', () => {
    expect(
      channelSecurityLevel({
        psk: new Uint8Array(32),
        uplinkEnabled: true,
        positionPrecision: 32,
      }),
    ).toBe('encrypted');
    expect(
      channelSecurityLevel({
        psk: new Uint8Array([0]),
        uplinkEnabled: true,
        positionPrecision: 0,
      }),
    ).toBe('open');
    expect(
      channelSecurityLevel({
        psk: new Uint8Array([1]),
        uplinkEnabled: false,
        positionPrecision: 13,
      }),
    ).toBe('open');
    expect(
      channelSecurityLevel({
        psk: new Uint8Array([0]),
        uplinkEnabled: false,
        positionPrecision: 32,
      }),
    ).toBe('open-location');
    expect(
      channelSecurityLevel({
        psk: new Uint8Array([0]),
        uplinkEnabled: true,
        positionPrecision: 32,
      }),
    ).toBe('open-location-uplink');
  });

  it('maps levels to channelSecurityBadges i18n keys', () => {
    expect(channelSecurityLevelI18nKey('encrypted')).toBe('encrypted');
    expect(channelSecurityLevelI18nKey('open')).toBe('open');
    expect(channelSecurityLevelI18nKey('open-location')).toBe('openLocation');
    expect(channelSecurityLevelI18nKey('open-location-uplink')).toBe('openLocationUplink');
  });
});
