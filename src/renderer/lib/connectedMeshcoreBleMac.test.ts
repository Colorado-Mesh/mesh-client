import { describe, expect, it } from 'vitest';

import {
  readMeshcoreWebBluetoothDeviceId,
  resolveConnectedMeshcoreBleIdentity,
} from './connectedMeshcoreBleMac';

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

  it('uses Web Bluetooth device id when peripheral id is missing (Linux)', () => {
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
