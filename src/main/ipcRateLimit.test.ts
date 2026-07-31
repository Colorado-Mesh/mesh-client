// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { createIpcRateLimiter } from './ipcRateLimit';

describe('createIpcRateLimiter', () => {
  const limiter = createIpcRateLimiter({ max: 3, windowMs: 1_000, label: 'test:channel' });

  afterEach(() => {
    limiter.resetForTests();
  });

  it('allows up to max calls within the window', () => {
    const now = 1_000_000;
    expect(() => {
      limiter.checkOrThrow(now);
    }).not.toThrow();
    expect(() => {
      limiter.checkOrThrow(now + 1);
    }).not.toThrow();
    expect(() => {
      limiter.checkOrThrow(now + 2);
    }).not.toThrow();
  });

  it('throws when over the rolling-window max', () => {
    const now = 2_000_000;
    limiter.checkOrThrow(now);
    limiter.checkOrThrow(now + 1);
    limiter.checkOrThrow(now + 2);
    expect(() => {
      limiter.checkOrThrow(now + 3);
    }).toThrow('test:channel: rate limit exceeded');
  });

  it('allows new calls after the window slides', () => {
    const now = 3_000_000;
    limiter.checkOrThrow(now);
    limiter.checkOrThrow(now + 1);
    limiter.checkOrThrow(now + 2);
    // Strictly past the window so the oldest timestamp falls below cutoff.
    expect(() => {
      limiter.checkOrThrow(now + 1_001);
    }).not.toThrow();
  });
});
