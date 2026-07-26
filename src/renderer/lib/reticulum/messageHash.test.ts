import { describe, expect, it } from 'vitest';

import { computeReticulumMessageHash } from './messageHash';

describe('computeReticulumMessageHash', () => {
  it('returns a 32-char lowercase hex FNV-1a 128-bit digest', () => {
    const hash = computeReticulumMessageHash(
      'abcdef0123456789abcdef0123456789',
      1_700_000_000_000,
      'hi',
    );
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic for the same sender/timestamp/text', () => {
    const a = computeReticulumMessageHash('aabb', 100, 'hello');
    const b = computeReticulumMessageHash('aabb', 100, 'hello');
    expect(a).toBe(b);
  });

  it('changes when any input field changes', () => {
    const base = computeReticulumMessageHash('aabb', 100, 'hello');
    expect(computeReticulumMessageHash('aabc', 100, 'hello')).not.toBe(base);
    expect(computeReticulumMessageHash('aabb', 101, 'hello')).not.toBe(base);
    expect(computeReticulumMessageHash('aabb', 100, 'hellp')).not.toBe(base);
  });

  it('matches a known fixture for empty sender/text at timestamp 0', () => {
    // Input string is `:0:` — locks FNV-1a 128-bit parity with sidecar `stable_hash`.
    expect(computeReticulumMessageHash('', 0, '')).toBe('eecc2c13553db460a51e06184e7160e7');
  });
});
