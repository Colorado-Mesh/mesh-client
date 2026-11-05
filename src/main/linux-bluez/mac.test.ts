// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isMacAddress, macToDeviceSuffix } from './mac';

describe('linux-bluez mac helpers', () => {
  it.each(['AA:BB:CC:DD:EE:FF', 'aa:bb:cc:dd:ee:ff', '01:23:45:67:89:ab'])('accepts %s', (mac) => {
    expect(isMacAddress(mac)).toBe(true);
  });

  it.each(['AA:BB:CC:DD:EE', 'AABBCCDDEEFF', 'AA-BB-CC-DD-EE-FF', ''])('rejects %s', (mac) => {
    expect(isMacAddress(mac)).toBe(false);
  });

  it('builds BlueZ device path suffix', () => {
    expect(macToDeviceSuffix('aa:bb:cc:dd:ee:ff')).toBe('dev_AA_BB_CC_DD_EE_FF');
  });
});
