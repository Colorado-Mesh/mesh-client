// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { normalizeBleMac } from './normalizeBleMac';

describe('normalizeBleMac', () => {
  it('normalizes colon-separated MAC addresses', () => {
    expect(normalizeBleMac('AA:BB:CC:DD:EE:FF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('normalizes compact 12-hex MAC addresses', () => {
    expect(normalizeBleMac('AABBCCDDEEFF')).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('returns empty string for blank input', () => {
    expect(normalizeBleMac('   ')).toBe('');
  });
});
