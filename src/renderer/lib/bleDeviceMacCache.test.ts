import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BLE_DEVICE_MACS_KEY, cacheBleDeviceMac, getBleDeviceMac } from './bleDeviceMacCache';

const DARWIN_UUID = 'eccf2847e1fd3f5f0811064db1639a3d';

describe('bleDeviceMacCache', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stores a hyphen MAC against a CoreBluetooth UUID', () => {
    cacheBleDeviceMac(DARWIN_UUID, 'AA-BB-CC-DD-EE-FF');
    expect(getBleDeviceMac(DARWIN_UUID)).toBe('aa:bb:cc:dd:ee:ff');
    expect(JSON.parse(localStorage.getItem(BLE_DEVICE_MACS_KEY) ?? '{}')).toEqual({
      [DARWIN_UUID]: 'aa:bb:cc:dd:ee:ff',
    });
  });

  it('does not cache when deviceId is already a MAC', () => {
    cacheBleDeviceMac('aa:bb:cc:dd:ee:ff', 'aa:bb:cc:dd:ee:ff');
    expect(localStorage.getItem(BLE_DEVICE_MACS_KEY)).toBeNull();
  });

  it('ignores non-MAC addresses', () => {
    cacheBleDeviceMac(DARWIN_UUID, DARWIN_UUID);
    expect(getBleDeviceMac(DARWIN_UUID)).toBeNull();
  });
});
