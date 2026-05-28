import { describe, expect, it } from 'vitest';

import { randomCorrelationSuffix } from './randomCorrelationSuffix';

describe('randomCorrelationSuffix', () => {
  it('returns a string of the requested length', () => {
    expect(randomCorrelationSuffix(6)).toHaveLength(6);
    expect(randomCorrelationSuffix(10)).toHaveLength(10);
  });

  it('returns different values on successive calls', () => {
    const a = randomCorrelationSuffix(8);
    const b = randomCorrelationSuffix(8);
    expect(a).not.toBe(b);
  });
});
