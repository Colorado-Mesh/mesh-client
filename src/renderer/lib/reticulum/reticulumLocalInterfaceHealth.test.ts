import { describe, expect, it } from 'vitest';

import {
  classifyReticulumLocalInterface,
  collectReticulumLocalInterfaceAlerts,
  collectReticulumLocalInterfaceConnecting,
  reticulumLocalOfflineDisplayKind,
} from './reticulumLocalInterfaceHealth';

const heltec: Parameters<typeof classifyReticulumLocalInterface>[0] = {
  id: 'heltec-v3',
  name: 'Heltec V3',
  type: 'rnode',
  enabled: true,
  status: 'down',
  serial_port: '/dev/cu.usbserial-7',
};

describe('reticulumLocalInterfaceHealth', () => {
  it('ignores non-local interface types', () => {
    expect(
      classifyReticulumLocalInterface({ ...heltec, type: 'tcp', serial_port: null }, [
        '/dev/cu.usbserial-7',
      ]),
    ).toBeNull();
  });

  it('flags stale serial port when device path missing from OS list', () => {
    expect(classifyReticulumLocalInterface(heltec, ['/dev/cu.usbserial-0001'])).toBe('stale_port');
  });

  it('flags enabled_down when port exists but status is not online', () => {
    expect(
      classifyReticulumLocalInterface(
        { ...heltec, serial_port: '/dev/cu.usbserial-0001', status: 'down' },
        ['/dev/cu.usbserial-0001'],
      ),
    ).toBe('enabled_down');
  });

  it('returns online for enabled local interface with matching port and up status', () => {
    expect(
      classifyReticulumLocalInterface(
        { ...heltec, serial_port: '/dev/cu.usbserial-0001', status: 'up' },
        ['/dev/cu.usbserial-0001'],
      ),
    ).toBe('online');
  });

  it('does not flag ble:// RNode URIs as stale USB serial ports', () => {
    expect(
      classifyReticulumLocalInterface(
        { ...heltec, serial_port: 'ble://aa:bb:cc:dd:ee:ff', status: 'down' },
        [],
      ),
    ).toBe('enabled_down');
    expect(
      classifyReticulumLocalInterface(
        { ...heltec, serial_port: 'ble://RNode 0BB2', status: 'up' },
        [],
      ),
    ).toBe('online');
  });

  it('classifies BLE vs serial offline display kind', () => {
    expect(reticulumLocalOfflineDisplayKind({ serial_port: 'ble://aa:bb:cc:dd:ee:ff' })).toBe(
      'ble',
    );
    expect(reticulumLocalOfflineDisplayKind({ serial_port: '/dev/cu.usbserial-1' })).toBe('serial');
  });

  it('collectLocalInterfaceAlerts returns stale and offline entries', () => {
    const alerts = collectReticulumLocalInterfaceAlerts(
      [
        heltec,
        {
          id: 'kiss-1',
          name: 'TNC',
          type: 'kiss',
          enabled: true,
          status: 'down',
          serial_port: '/dev/cu.usbserial-6',
        },
        {
          id: 'tcp-1',
          name: 'Hub',
          type: 'tcp',
          enabled: true,
          status: 'down',
          serial_port: null,
        },
      ],
      ['/dev/cu.usbserial-6'],
    );
    expect(alerts).toHaveLength(2);
    expect(alerts[0]?.reason).toBe('stale_port');
    expect(alerts[0]?.iface.name).toBe('Heltec V3');
    expect(alerts[1]?.reason).toBe('enabled_down');
  });

  it('treats enabled BLE RNode as connecting during grace instead of an alert', () => {
    const ble = {
      ...heltec,
      id: 'nv0n2',
      name: 'NV0N2',
      serial_port: 'ble://aa:bb:cc:dd:ee:ff',
      status: 'down',
    };
    const grace = { bleConnectGraceExpiresAt: 10_000, now: 5_000 };
    expect(collectReticulumLocalInterfaceConnecting([ble], [], grace)).toHaveLength(1);
    expect(collectReticulumLocalInterfaceAlerts([ble], [], grace)).toHaveLength(0);
    expect(collectReticulumLocalInterfaceAlerts([ble], [], { ...grace, now: 11_000 })).toHaveLength(
      1,
    );
  });
});
