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

  it('rejects invalid hostnames', () => {
    expect(isValidHttpHostname('host with spaces')).toBe(false);
    expect(isValidHttpHostname('-leading-hyphen.com')).toBe(false);
    expect(isValidHttpHostname('trailing-hyphen-.com')).toBe(false);
    expect(isValidHttpHostname('')).toBe(false);
    expect(isValidHttpHostname('has..double.dot')).toBe(false);
  });
});
