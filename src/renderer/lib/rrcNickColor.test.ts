import { describe, expect, it } from 'vitest';

import { RRC_NICK_COLOR_CLASSES, rrcNickColorClass } from './rrcNickColor';

describe('rrcNickColorClass', () => {
  it('is stable and case-insensitive', () => {
    expect(rrcNickColorClass('Zeva')).toBe(rrcNickColorClass('zeva'));
    expect(rrcNickColorClass('Zeva')).toBe(rrcNickColorClass(' ZEVA '));
  });

  it('returns a class from the exported palette (no amber)', () => {
    const cls = rrcNickColorClass('nv0n');
    expect(RRC_NICK_COLOR_CLASSES).toContain(cls);
    expect(cls).not.toMatch(/amber|yellow/);
  });

  it('can differ across nicks', () => {
    const colors = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'].map(rrcNickColorClass);
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  it('falls back consistently for empty / hash labels', () => {
    expect(rrcNickColorClass('')).toBe(RRC_NICK_COLOR_CLASSES[0]);
    expect(rrcNickColorClass('aabbccdd')).toBe(rrcNickColorClass('AABBCCDD'));
  });
});
