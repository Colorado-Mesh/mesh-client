import { describe, expect, it } from 'vitest';

import { formatReticulumIdentityFingerprint } from './reticulumIdentityFingerprint';

describe('formatReticulumIdentityFingerprint', () => {
  it('groups hex into 4-char uppercase blocks', () => {
    expect(formatReticulumIdentityFingerprint('abcd1234ef')).toBe('ABCD 1234 EF');
  });

  it('strips non-hex and returns empty for blank', () => {
    expect(formatReticulumIdentityFingerprint('')).toBe('');
    expect(formatReticulumIdentityFingerprint('zz')).toBe('');
  });
});
