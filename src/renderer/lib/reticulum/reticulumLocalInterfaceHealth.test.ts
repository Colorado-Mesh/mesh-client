import { describe, expect, it } from 'vitest';

import {
  classifyReticulumLocalInterface,
  collectReticulumLocalInterfaceAlerts,
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
});
