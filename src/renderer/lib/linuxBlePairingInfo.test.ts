// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { parseBluetoothctlPairedState } from './linuxBlePairingInfo';

describe('parseBluetoothctlPairedState', () => {
  it('reads bond state from info lines', () => {
    expect(parseBluetoothctlPairedState('Name: radio\nPaired: yes\n')).toBe('yes');
    expect(parseBluetoothctlPairedState('Name: radio\nPaired: no\n')).toBe('no');
  });

  it('does not treat Paired: yes inside a device name as bonded', () => {
    expect(parseBluetoothctlPairedState('Name: Evil Paired: yes\nPaired: no\n')).toBe('no');
    expect(parseBluetoothctlPairedState('Name: Paired: yes spoof\n')).toBe('unknown');
  });
});
