// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { cacheTransportDisplayName } from './transportDisplayNameCache';

const KEY = 'mesh-client:testTransportNames';

describe('cacheTransportDisplayName', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('stores and overwrites a short name for a cache key', () => {
    cacheTransportDisplayName(KEY, 'ble-1', 'ABC');
    cacheTransportDisplayName(KEY, 'ble-1', 'XYZ');
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ 'ble-1': 'XYZ' });
  });

  it('bounds the cache to the most recent entries', () => {
    for (let i = 0; i < 70; i++) {
      cacheTransportDisplayName(KEY, `k${i}`, `n${i}`);
    }
    const cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
    expect(Object.keys(cache)).toHaveLength(64);
    expect(cache.k0).toBeUndefined();
    expect(cache.k69).toBe('n69');
  });
});
