import { describe, expect, it } from 'vitest';

import { senderInitials } from './senderInitials';

describe('senderInitials', () => {
  it.each([
    ['Trail Dave', 'TD'],
    ['Longmont Base', 'LB'],
    ['Packrat', 'PA'],
    ['NV0N -Joey 🛜', 'NJ'],
    ['🛜 Mesa HQ', 'MH'],
    ['w5abc', 'W5'],
    ['Ørjan Østby', 'ØØ'],
    ['Иван Петров', 'ИП'],
    ['  spaced   name  ', 'SN'],
  ])('%s -> %s', (name, expected) => {
    expect(senderInitials(name, 1)).toBe(expected);
  });

  it('keeps an emoji-only name as its first emoji', () => {
    expect(senderInitials('🛜📡', 1)).toBe('🛜');
  });

  it('falls back to the node id without a name', () => {
    expect(senderInitials('', 0x1a2b3c4d)).toBe('4D');
    expect(senderInitials(undefined, 7)).toBe('07');
  });
});
