import { describe, expect, it } from 'vitest';

import { parseFlashAddress } from '../binaryUtils';

describe('parseFlashAddress', () => {
  it.each([
    ['0x0', 0],
    ['0xe000', 0xe000],
    ['0x8000', 0x8000],
    ['0x10000', 0x10000],
    ['0x210000', 0x210000],
  ] as const)('parses hex address %s', (address, expected) => {
    expect(parseFlashAddress(address)).toBe(expected);
  });

  it('does not treat hex addresses as decimal zero (regression)', () => {
    expect(parseFlashAddress('0x10000')).not.toBe(0);
  });
});
