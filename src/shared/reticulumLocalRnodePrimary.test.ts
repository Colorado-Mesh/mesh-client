// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  countEnabledLocallyConnectedSerialInterfaces,
  isReticulumLocallyConnectedSerialInterface,
  pickDefaultPrimaryLocalSerialInterfaceId,
  resolveEffectivePrimaryLocalSerialInterfaceId,
} from './reticulumLocalRnodePrimary';

describe('isReticulumLocallyConnectedSerialInterface', () => {
  it('accepts USB serial, BLE, and local tcp RNodes', () => {
    expect(
      isReticulumLocallyConnectedSerialInterface({
        id: 'usb',
        type: 'rnode',
        enabled: true,
        serial_port: '/dev/ttyUSB0',
      }),
    ).toBe(true);
    expect(
      isReticulumLocallyConnectedSerialInterface({
        id: 'ble',
        type: 'rnode',
        enabled: true,
        serial_port: 'ble://aa:bb:cc:dd:ee:ff',
      }),
    ).toBe(true);
    expect(
      isReticulumLocallyConnectedSerialInterface({
        id: 'wifi',
        type: 'rnode',
        enabled: true,
        serial_port: 'tcp://192.168.1.10',
      }),
    ).toBe(true);
    expect(
      isReticulumLocallyConnectedSerialInterface({
        id: 'ula',
        type: 'kiss',
        enabled: true,
        serial_port: 'tcp://[fd00::1]',
      }),
    ).toBe(true);
  });

  it('rejects non-serial types and public tcp hosts', () => {
    expect(
      isReticulumLocallyConnectedSerialInterface({
        id: 'tcp',
        type: 'tcp',
        enabled: true,
        serial_port: null,
        host: '192.168.1.1',
      } as never),
    ).toBe(false);
    expect(
      isReticulumLocallyConnectedSerialInterface({
        id: 'remote',
        type: 'rnode',
        enabled: true,
        serial_port: 'tcp://8.8.8.8',
      }),
    ).toBe(false);
    expect(
      isReticulumLocallyConnectedSerialInterface({
        id: 'empty',
        type: 'rnode',
        enabled: true,
        serial_port: '',
      }),
    ).toBe(false);
  });
});

describe('primary resolution', () => {
  const rows = [
    {
      id: 'first',
      type: 'rnode',
      enabled: true,
      serial_port: '/dev/ttyUSB0',
    },
    {
      id: 'second',
      type: 'rnode',
      enabled: true,
      serial_port: 'ble://device',
    },
    {
      id: 'remote',
      type: 'rnode',
      enabled: true,
      serial_port: 'tcp://203.0.113.1',
    },
  ];

  it('defaults to first enabled local serial in list order', () => {
    expect(pickDefaultPrimaryLocalSerialInterfaceId(rows)).toBe('first');
  });

  it('uses stored id when still valid', () => {
    expect(resolveEffectivePrimaryLocalSerialInterfaceId(rows, 'second')).toBe('second');
  });

  it('falls back when stored id is invalid or disabled', () => {
    expect(resolveEffectivePrimaryLocalSerialInterfaceId(rows, 'missing')).toBe('first');
    expect(
      resolveEffectivePrimaryLocalSerialInterfaceId(
        rows.map((row) => (row.id === 'first' ? { ...row, enabled: false } : row)),
        'first',
      ),
    ).toBe('second');
  });

  it('counts only enabled local serial interfaces', () => {
    expect(countEnabledLocallyConnectedSerialInterfaces(rows)).toBe(2);
  });
});
