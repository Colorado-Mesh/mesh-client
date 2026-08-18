// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  formatBleDeviceIdForDisplay,
  isTwelveHexBleMac,
  normalizeBleMac,
  resolveBlePickerIdentity,
} from './normalizeBleMac';

describe('normalizeBleMac', () => {
  it('normalizes colon-separated MAC addresses', () => {
    expect(normalizeBleMac('AA:BB:CC:DD:EE:FF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('normalizes compact 12-hex MAC addresses', () => {
    expect(normalizeBleMac('AABBCCDDEEFF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('normalizes hyphen-separated macOS CoreBluetoothCache MACs', () => {
    expect(normalizeBleMac('AA-BB-CC-DD-EE-FF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('returns empty string for blank input', () => {
    expect(normalizeBleMac('   ')).toBe('');
  });

  it('rejects malformed suffixes instead of stripping them into a MAC', () => {
    expect(normalizeBleMac('AA:BB:CC:DD:EE:FF-extra')).toBe('aa:bb:cc:dd:ee:ff-extra');
    expect(normalizeBleMac('AABBCCDDEEFF00')).toBe('aabbccddeeff00');
    expect(normalizeBleMac('aa:bb:cc:dd:ee:ff/dev')).toBe('aa:bb:cc:dd:ee:ff/dev');
  });

  it('rejects unsupported separators instead of stripping them into a MAC', () => {
    expect(normalizeBleMac('AA.BB.CC.DD.EE.FF')).toBe('aa.bb.cc.dd.ee.ff');
    expect(normalizeBleMac('AA BB CC DD EE FF')).toBe('aa bb cc dd ee ff');
    expect(normalizeBleMac('AA:BB-CC:DD:EE:FF')).toBe('aa:bb-cc:dd:ee:ff');
  });
});

describe('isTwelveHexBleMac', () => {
  it('accepts colon, hyphen, and compact 12-hex', () => {
    expect(isTwelveHexBleMac('aa:bb:cc:dd:ee:ff')).toBe(true);
    expect(isTwelveHexBleMac('AA-BB-CC-DD-EE-FF')).toBe(true);
    expect(isTwelveHexBleMac('AABBCCDDEEFF')).toBe(true);
  });

  it('rejects CoreBluetooth UUIDs and opaque Web Bluetooth ids', () => {
    expect(isTwelveHexBleMac('eccf2847-e1fd-3f5f-0811-064db1639a3d')).toBe(false);
    expect(isTwelveHexBleMac('eccf2847e1fd3f5f0811064db1639a3d')).toBe(false);
    expect(isTwelveHexBleMac('linux-web-bt-opaque-id')).toBe(false);
  });

  it('rejects suffixes and unsupported separators', () => {
    expect(isTwelveHexBleMac('aa:bb:cc:dd:ee:ff-extra')).toBe(false);
    expect(isTwelveHexBleMac('aa.bb.cc.dd.ee.ff')).toBe(false);
  });
});

describe('formatBleDeviceIdForDisplay', () => {
  it('formats compact and hyphen MACs as colon-separated lowercase', () => {
    expect(formatBleDeviceIdForDisplay('AABBCCDDEEFF')).toBe('aa:bb:cc:dd:ee:ff');
    expect(formatBleDeviceIdForDisplay('AA-BB-CC-DD-EE-FF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('leaves UUIDs unchanged', () => {
    expect(formatBleDeviceIdForDisplay('ECCF2847-E1FD-3F5F-0811-064DB1639A3D')).toBe(
      'ECCF2847-E1FD-3F5F-0811-064DB1639A3D',
    );
  });
});

describe('resolveBlePickerIdentity', () => {
  const darwinUuid = 'eccf2847e1fd3f5f0811064db1639a3d';

  it('prefers scan address over UUID deviceId', () => {
    expect(
      resolveBlePickerIdentity({
        deviceId: darwinUuid,
        address: 'aa-bb-cc-dd-ee-ff',
      }),
    ).toEqual({ display: 'aa:bb:cc:dd:ee:ff', isMac: true });
  });

  it('uses cached MAC when address is missing', () => {
    expect(
      resolveBlePickerIdentity({
        deviceId: darwinUuid,
        cachedMac: 'aa:bb:cc:dd:ee:ff',
      }),
    ).toEqual({ display: 'aa:bb:cc:dd:ee:ff', isMac: true });
  });

  it('falls back to deviceId when it is already a MAC', () => {
    expect(resolveBlePickerIdentity({ deviceId: 'AA:BB:CC:DD:EE:FF' })).toEqual({
      display: 'aa:bb:cc:dd:ee:ff',
      isMac: true,
    });
  });

  it('returns UUID as Bluetooth ID when no MAC is known', () => {
    expect(resolveBlePickerIdentity({ deviceId: darwinUuid })).toEqual({
      display: darwinUuid,
      isMac: false,
    });
  });
});
