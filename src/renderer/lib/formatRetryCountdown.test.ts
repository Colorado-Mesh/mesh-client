import { describe, expect, it } from 'vitest';

import { formatRetryCountdown } from './formatRetryCountdown';

describe('formatRetryCountdown', () => {
  it('returns 0:00 when target is past', () => {
    expect(formatRetryCountdown(0, 5000)).toBe('0:00');
  });

  it('displays 0 minutes and 5 seconds remaining', () => {
    expect(formatRetryCountdown(5000, 0)).toBe('0:05');
  });

  it('displays 1 minute and 30 seconds remaining', () => {
    expect(formatRetryCountdown(90_000, 0)).toBe('1:30');
  });

  it('displays 5 minutes and 59 seconds with zero padding', () => {
    expect(formatRetryCountdown(359_000, 0)).toBe('5:59');
  });

  it('displays 10 minutes remaining', () => {
    expect(formatRetryCountdown(600_000, 0)).toBe('10:00');
  });
});
