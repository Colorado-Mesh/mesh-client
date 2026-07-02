// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  collectReticulumBleMacs,
  hasEnabledReticulumBleInterface,
  isReticulumBleInterfaceRow,
} from './reticulumBleAdapterConflict';
import {
  isBlePeripheralConflictErrorMessage,
  isBleScanBusyErrorMessage,
} from './reticulumBleAdapterLease';

describe('reticulumBleAdapterConflict', () => {
  it('detects enabled ble_peer and ble:// rnode interfaces', () => {
    expect(
      hasEnabledReticulumBleInterface([
        { type: 'tcp', enabled: true, serial_port: null },
        { type: 'ble_peer', enabled: false },
      ]),
    ).toBe(false);

    expect(isReticulumBleInterfaceRow({ type: 'ble_peer', enabled: true })).toBe(true);
    expect(
      isReticulumBleInterfaceRow({
        type: 'rnode',
        enabled: true,
        serial_port: 'ble://AA:BB:CC:DD:EE:FF',
      }),
    ).toBe(true);

    expect(
      hasEnabledReticulumBleInterface([{ type: 'ble_peer', enabled: true, seed_addresses: [] }]),
    ).toBe(true);

    expect(
      hasEnabledReticulumBleInterface([
        {
          type: 'rnode',
          enabled: true,
          serial_port: 'ble://AA:BB:CC:DD:EE:FF',
        },
      ]),
    ).toBe(true);
  });

  it('collects MACs from ble:// serial ports and seed addresses', () => {
    expect(
      collectReticulumBleMacs({
        type: 'rnode',
        enabled: true,
        serial_port: 'ble://AA:BB:CC:DD:EE:FF',
      }),
    ).toEqual(['AA:BB:CC:DD:EE:FF']);

    expect(
      collectReticulumBleMacs({
        type: 'ble_peer',
        enabled: true,
        seed_addresses: ['11:22:33:44:55:66'],
      }),
    ).toEqual(['11:22:33:44:55:66']);
  });

  it('detects coexistence busy and conflict messages', () => {
    expect(isBleScanBusyErrorMessage('Bluetooth scan in progress (reticulum)')).toBe(true);
    expect(
      isBlePeripheralConflictErrorMessage('Bluetooth device aa:bb is already in use by reticulum'),
    ).toBe(true);
    expect(isBleScanBusyErrorMessage('GATT Error')).toBe(false);
  });
});
