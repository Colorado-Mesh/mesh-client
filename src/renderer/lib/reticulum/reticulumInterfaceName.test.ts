import { describe, expect, it } from 'vitest';

import {
  deriveReticulumInterfaceName,
  isReticulumRnodeCallsignType,
  sanitizeReticulumInterfaceName,
} from './reticulumInterfaceName';

describe('reticulumInterfaceName', () => {
  it('sanitizes config-unsafe characters', () => {
    expect(sanitizeReticulumInterfaceName('  Heltec [V3]  ')).toBe('Heltec V3');
  });

  it('uses RNode device name when provided', () => {
    expect(
      deriveReticulumInterfaceName({
        ifaceType: 'rnode',
        rnodeDeviceName: 'RNode BLE',
      }),
    ).toBe('RNode BLE');
  });

  it('falls back to serial port label', () => {
    expect(
      deriveReticulumInterfaceName({
        ifaceType: 'rnode',
        serialPort: '/dev/cu.usbserial-1',
        serialPorts: [{ path: '/dev/cu.usbserial-1', label: 'Heltec V3' }],
      }),
    ).toBe('Heltec V3');
  });

  it('uses connection type label for non-RNode interfaces', () => {
    expect(deriveReticulumInterfaceName({ ifaceType: 'tcp' })).toBe('TCP');
    expect(deriveReticulumInterfaceName({ ifaceType: 'ble_peer' })).toBe('BLE Peer');
  });

  it('identifies RNode types that require callsign', () => {
    expect(isReticulumRnodeCallsignType('rnode')).toBe(true);
    expect(isReticulumRnodeCallsignType('rnode_multi')).toBe(true);
    expect(isReticulumRnodeCallsignType('kiss')).toBe(false);
  });
});
