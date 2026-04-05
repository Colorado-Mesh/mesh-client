import { describe, expect, it, vi } from 'vitest';

import { withTimeout } from '../../shared/withTimeout';

describe('withTimeout', () => {
  it('resolves before timeout and leaves no pending timers', async () => {
    vi.useFakeTimers();
    try {
      const p = withTimeout(Promise.resolve(42), 5000, 'op');
      await vi.runAllTimersAsync();
      await expect(p).resolves.toBe(42);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with timeout message when promise does not settle in time', async () => {
    vi.useFakeTimers();
    try {
      const p = withTimeout(new Promise(() => {}), 1000, 'slow');
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- fire-and-forget timer advance
      vi.advanceTimersByTimeAsync(1000);
      await expect(p).rejects.toThrow(/slow timed out after 1000ms/);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears timeout when promise rejects before deadline', async () => {
    vi.useFakeTimers();
    try {
      const p = withTimeout(Promise.reject(new Error('boom')), 5000, 'fail-fast');
      const result = p.catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
      await vi.runAllTimersAsync();
      await expect(result).resolves.toBe('boom');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
