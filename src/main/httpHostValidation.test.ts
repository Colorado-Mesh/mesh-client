// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { isValidHttpHostname } from './httpHostValidation';

describe('isValidHttpHostname', () => {
  it('accepts common valid hostnames', () => {
    expect(isValidHttpHostname('example.com')).toBe(true);
    expect(isValidHttpHostname('my-router.local')).toBe(true);
    expect(isValidHttpHostname('192.168.1.1')).toBe(true);
    expect(isValidHttpHostname('a')).toBe(true);
    expect(isValidHttpHostname('sub.domain.example.org')).toBe(true);
  });

  it('accepts IPv6 bare and bracketed', () => {
    expect(isValidHttpHostname('::1')).toBe(true);
    expect(isValidHttpHostname('[::1]')).toBe(true);
    expect(isValidHttpHostname('fd00::1')).toBe(true);
    expect(isValidHttpHostname('[2001:db8::1]')).toBe(true);
    expect(isValidHttpHostname('fe80::1')).toBe(true);
  });

  it('rejects invalid hostnames', () => {
    expect(isValidHttpHostname('host with spaces')).toBe(false);
    expect(isValidHttpHostname('-leading-hyphen.com')).toBe(false);
    expect(isValidHttpHostname('trailing-hyphen-.com')).toBe(false);
    expect(isValidHttpHostname('')).toBe(false);
    expect(isValidHttpHostname('has..double.dot')).toBe(false);
    expect(isValidHttpHostname('999.999.999.999')).toBe(false);
    expect(isValidHttpHostname('gggg::1')).toBe(false);
  });
});
