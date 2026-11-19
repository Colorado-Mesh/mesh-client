import { describe, expect, it } from 'vitest';

import { queueStatusEqual } from './queueStatusEqual';

describe('queueStatusEqual', () => {
  it('treats identical aggregates as equal and skips null mismatches', () => {
    const a = { free: 10, maxlen: 16, res: 0, interfaceName: 'rnode', buffering: false };
    expect(queueStatusEqual(a, { ...a })).toBe(true);
    expect(queueStatusEqual(a, { ...a, free: 9 })).toBe(false);
    expect(queueStatusEqual(null, null)).toBe(true);
    expect(queueStatusEqual(a, null)).toBe(false);
  });
});
