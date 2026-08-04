// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearMeshcoreBleMacSuppression,
  getConnectedMeshcoreBleMac,
  MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY,
  prearmMeshcoreBleMacSuppressionFromStorage,
  readMeshcoreWebBluetoothDeviceId,
  resetConnectedMeshcoreBleMacForTests,
  resolveConnectedMeshcoreBleIdentity,
  resolveConnectedMeshcoreBleMacForSuppression,
  setConnectedMeshcoreBleMac,
} from './connectedMeshcoreBleMac';
import { shouldSuppressMeshtasticNodeHear } from './meshcoreBleMacMeshtasticNodeId';

describe('resolveConnectedMeshcoreBleIdentity', () => {
  it('prefers explicit blePeripheralId over Web Bluetooth and last-id fallbacks', () => {
    expect(
      resolveConnectedMeshcoreBleIdentity({
        blePeripheralId: 'aa:bb:cc:dd:ee:ff',
        webBluetoothDeviceId: 'web-bt-uuid',
        fallbackLastBlePeripheralId: 'stored-id',
      }),
    ).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('uses Web Bluetooth device id when peripheral id is missing (Linux reconnect identity)', () => {
    expect(
      resolveConnectedMeshcoreBleIdentity({
        blePeripheralId: undefined,
        webBluetoothDeviceId: '  web-bt-uuid  ',
        fallbackLastBlePeripheralId: 'stored-id',
      }),
    ).toBe('web-bt-uuid');
  });

  it('falls back to last remembered BLE id', () => {
    expect(
      resolveConnectedMeshcoreBleIdentity({
        blePeripheralId: '',
        webBluetoothDeviceId: null,
        fallbackLastBlePeripheralId: 'stored-mac',
      }),
    ).toBe('stored-mac');
  });

  it('returns null when no candidates are usable', () => {
    expect(
      resolveConnectedMeshcoreBleIdentity({
        blePeripheralId: '  ',
        webBluetoothDeviceId: undefined,
        fallbackLastBlePeripheralId: null,
      }),
    ).toBeNull();
  });
});

describe('resolveConnectedMeshcoreBleMacForSuppression', () => {
  it('skips opaque Web Bluetooth UUIDs and prefers a parseable MAC fallback', () => {
    expect(
      resolveConnectedMeshcoreBleMacForSuppression({
        blePeripheralId: undefined,
        webBluetoothDeviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        fallbackLastBlePeripheralId: 'cc:2e:e3:da:2e:2f',
      }),
    ).toBe('cc:2e:e3:da:2e:2f');
  });

  it('returns null when only opaque Linux Web Bluetooth ids are available', () => {
    expect(
      resolveConnectedMeshcoreBleMacForSuppression({
        blePeripheralId: undefined,
        webBluetoothDeviceId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        fallbackLastBlePeripheralId: 'stored-opaque-uuid',
      }),
    ).toBeNull();
  });
});

describe('setConnectedMeshcoreBleMac', () => {
  afterEach(() => {
    resetConnectedMeshcoreBleMacForTests();
  });

  it('stores parseable Noble MACs and persists them for cold-start pre-arm', () => {
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    expect(getConnectedMeshcoreBleMac()).toBe('cc:2e:e3:da:2e:2f');
    expect(localStorage.getItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY)).toBe(
      'cc:2e:e3:da:2e:2f',
    );
    expect(shouldSuppressMeshtasticNodeHear(0xe3da2e2f, getConnectedMeshcoreBleMac())).toBe(true);
  });

  it('clears in-memory value for opaque Web Bluetooth UUIDs without wiping sticky persistence', () => {
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    setConnectedMeshcoreBleMac('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(getConnectedMeshcoreBleMac()).toBeNull();
    expect(localStorage.getItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY)).toBe(
      'cc:2e:e3:da:2e:2f',
    );
    expect(shouldSuppressMeshtasticNodeHear(0xe3da2e2f, getConnectedMeshcoreBleMac())).toBe(false);
  });

  it('set(null) clears memory only; prearm restores sticky MAC before live BLE connect', () => {
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    setConnectedMeshcoreBleMac(null);
    expect(getConnectedMeshcoreBleMac()).toBeNull();
    expect(localStorage.getItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY)).toBe(
      'cc:2e:e3:da:2e:2f',
    );
    expect(prearmMeshcoreBleMacSuppressionFromStorage(null)).toBe('cc:2e:e3:da:2e:2f');
    expect(getConnectedMeshcoreBleMac()).toBe('cc:2e:e3:da:2e:2f');
    expect(shouldSuppressMeshtasticNodeHear(0xe3da2e2f, getConnectedMeshcoreBleMac())).toBe(true);
  });

  it('prearm uses last-BLE fallback when persistence is empty', () => {
    expect(prearmMeshcoreBleMacSuppressionFromStorage('cc:2e:e3:da:2e:2f')).toBe(
      'cc:2e:e3:da:2e:2f',
    );
    expect(getConnectedMeshcoreBleMac()).toBe('cc:2e:e3:da:2e:2f');
  });

  it('clearMeshcoreBleMacSuppression drops memory and persistence', () => {
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    clearMeshcoreBleMacSuppression();
    expect(getConnectedMeshcoreBleMac()).toBeNull();
    expect(localStorage.getItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY)).toBeNull();
    expect(prearmMeshcoreBleMacSuppressionFromStorage(null)).toBeNull();
  });
});

describe('readMeshcoreWebBluetoothDeviceId', () => {
  it('reads getWebBluetoothDeviceId from duck-typed connections', () => {
    expect(
      readMeshcoreWebBluetoothDeviceId({
        getWebBluetoothDeviceId: () => 'linux-device-id',
      }),
    ).toBe('linux-device-id');
  });

  it('returns null for non-Web-Bluetooth handles', () => {
    expect(readMeshcoreWebBluetoothDeviceId({})).toBeNull();
    expect(readMeshcoreWebBluetoothDeviceId(null)).toBeNull();
  });
});
