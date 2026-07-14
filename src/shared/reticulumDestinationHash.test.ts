import { describe, expect, it } from 'vitest';

import {
  canonicalizeReticulumDestinationHash,
  isCanonicalReticulumDestinationHash,
} from './reticulumDestinationHash';

describe('canonicalizeReticulumDestinationHash', () => {
  it('lowercases exact 32-hex hashes', () => {
    expect(canonicalizeReticulumDestinationHash('AABBCCDDEEFF00112233445566778899')).toBe(
      'aabbccddeeff00112233445566778899',
    );
  });

  it('rejects separator stripping and short hashes', () => {
    expect(
      canonicalizeReticulumDestinationHash('aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:99'),
    ).toBeNull();
    expect(canonicalizeReticulumDestinationHash('deadbeef')).toBeNull();
  });
});

describe('isCanonicalReticulumDestinationHash', () => {
  it('accepts only lowercase 32-hex', () => {
    expect(isCanonicalReticulumDestinationHash('aabbccddeeff00112233445566778899')).toBe(true);
    expect(isCanonicalReticulumDestinationHash('AABBCCDDEEFF00112233445566778899')).toBe(false);
  });
});
