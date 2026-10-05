import { describe, expect, it } from 'vitest';

import { senderInitials } from './senderInitials';

describe('senderInitials', () => {
  it.each([
    ['Trail Dave', 'TD'],
    ['Longmont Base', 'LB'],
    ['Packrat', 'PA'],
    ['NV0N -Joey 🛜', 'NJ'],
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

  it.each([
    ['🐻MEGABEAR β', '🐻'],
    ['🛜 Mesa HQ', '🛜'],
    ['  📡 Relay', '📡'],
    ['❤️ Heart Node', '❤️'],
    ['👍🏽 Thumbs', '👍🏽'],
    ['👨‍👩‍👧 Family', '👨‍👩‍👧'],
    ['🇺🇸 Base', '🇺🇸'],
  ])('uses the leading emoji of %s', (name, expected) => {
    expect(senderInitials(name, 1)).toBe(expected);
  });

  it('does not treat a leading digit or keycap as an emoji', () => {
    expect(senderInitials('1st Responder', 1)).toBe('1R');
    expect(senderInitials('#️⃣ Hash Node', 1)).toBe('HN');
  });

  it('falls back to the node id without a name', () => {
    expect(senderInitials('', 0x1a2b3c4d)).toBe('4D');
    expect(senderInitials(undefined, 7)).toBe('07');
  });
});
