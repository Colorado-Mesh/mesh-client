import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bumpDbHydrationRevision,
  getDbHydrationRevision,
  resetDbHydrationRevisionForTests,
  subscribeDbHydrationRevision,
} from './dbHydrationRevision';

describe('dbHydrationRevision', () => {
  afterEach(() => {
    resetDbHydrationRevisionForTests();
  });

  it('notifies subscribers on bump', () => {
    const listener = vi.fn();
    const unsub = subscribeDbHydrationRevision(listener);
    const before = getDbHydrationRevision();
    bumpDbHydrationRevision();
    expect(getDbHydrationRevision()).toBe(before + 1);
    expect(listener).toHaveBeenCalledOnce();
    unsub();
    bumpDbHydrationRevision();
    expect(listener).toHaveBeenCalledOnce();
  });
});
