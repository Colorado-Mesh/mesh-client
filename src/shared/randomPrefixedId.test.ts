import { describe, expect, it } from 'vitest';

import { randomPrefixedId } from './randomPrefixedId';

function expectPrefixedIdFormat(id: string, prefix: string): { timestamp: number; suffix: string } {
  expect(id.match(/-/g)?.length).toBe(2);
  const segments = id.split('-');
  expect(segments).toHaveLength(3);
  expect(segments[0]).toBe(prefix);
  expect(segments[1]).toMatch(/^\d+$/);
  expect(segments[2]).toMatch(/^[a-f0-9]{6}$/i);

  const timestamp = Number(segments[1]);
  expect(timestamp).toBeGreaterThan(0);

  return { timestamp, suffix: segments[2] };
}

describe('randomPrefixedId', () => {
  it('includes the prefix and a timestamp segment', () => {
    const before = Date.now();
    const id = randomPrefixedId('meshcore');
    const after = Date.now();

    const { timestamp } = expectPrefixedIdFormat(id, 'meshcore');
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('returns different values on successive calls', () => {
    const a = randomPrefixedId('id');
    const b = randomPrefixedId('id');

    expectPrefixedIdFormat(a, 'id');
    expectPrefixedIdFormat(b, 'id');
    expect(a).not.toBe(b);
  });
});
