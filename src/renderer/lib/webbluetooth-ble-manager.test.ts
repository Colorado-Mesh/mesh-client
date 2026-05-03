import { describe, expect, it } from 'vitest';

import { BLE_TO_RADIO_PAYLOAD_CAP } from '@/shared/bleAttWriteLimit';

import { probeWebBluetoothToRadioChunkLimitBytes } from './webbluetooth-ble-manager';

describe('probeWebBluetoothToRadioChunkLimitBytes', () => {
  it('returns null when maximumWriteValueLength is absent', () => {
    const ch = { uuid: 'test' } as BluetoothRemoteGATTCharacteristic;
    expect(probeWebBluetoothToRadioChunkLimitBytes(ch)).toBe(null);
  });

  it('returns capped positive maximumWriteValueLength', () => {
    const ch = {
      uuid: 'test',
      maximumWriteValueLength: 50,
    } as BluetoothRemoteGATTCharacteristic;
    expect(probeWebBluetoothToRadioChunkLimitBytes(ch)).toBe(50);
  });

  it('caps at BLE_TO_RADIO_PAYLOAD_CAP', () => {
    const ch = {
      uuid: 'test',
      maximumWriteValueLength: 9000,
    } as BluetoothRemoteGATTCharacteristic;
    expect(probeWebBluetoothToRadioChunkLimitBytes(ch)).toBe(BLE_TO_RADIO_PAYLOAD_CAP);
  });

  it('ignores non-positive values', () => {
    expect(
      probeWebBluetoothToRadioChunkLimitBytes({
        uuid: 'x',
        maximumWriteValueLength: 0,
      } as BluetoothRemoteGATTCharacteristic),
    ).toBe(null);
  });
});
