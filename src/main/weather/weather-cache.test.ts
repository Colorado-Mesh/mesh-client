import { describe, expect, it } from 'vitest';

import { ProviderCircuit, RateLimiter, TtlCache } from './weather-cache';

describe('weather-cache', () => {
  it('expires TTL entries', () => {
    const cache = new TtlCache<string, number>({ maxEntries: 10, ttlMs: 1000 });
    cache.set('a', 1, 1000);
    expect(cache.get('a', 1500)).toBe(1);
    expect(cache.get('a', 2500)).toBeUndefined();
  });

  it('evicts by max entries and bytes', () => {
    const cache = new TtlCache<string, string>({ maxEntries: 2, ttlMs: 10_000, maxBytes: 5 });
    cache.set('a', 'aa', 0, 2);
    cache.set('b', 'bb', 0, 2);
    cache.set('c', 'ccc', 0, 3);
    expect(cache.get('a', 1)).toBeUndefined();
  });

  it('opens circuit after failures and half-opens', () => {
    const c = new ProviderCircuit('test');
    const t0 = 1_000_000;
    expect(c.canAttempt(t0)).toBe(true);
    c.recordFailure('e1', t0);
    c.recordFailure('e2', t0);
    c.recordFailure('e3', t0);
    expect(c.canAttempt(t0 + 1000)).toBe(false);
    expect(c.canAttempt(t0 + 3 * 60_000)).toBe(true);
    c.recordSuccess();
    expect(c.snapshot().failures).toBe(0);
  });

  it('rate limits at the boundary', () => {
    const lim = new RateLimiter(2, 60_000);
    expect(lim.tryAcquire(1000)).toBe(true);
    expect(lim.tryAcquire(1000)).toBe(true);
    expect(lim.tryAcquire(1000)).toBe(false);
    expect(lim.tryAcquire(61_000)).toBe(true);
  });
});
