import { describe, expect, it, vi } from 'vitest';

import { withTimeout } from './withTimeout';

describe('withTimeout', () => {
  it('resolves when the promise resolves before timeout', async () => {
    const promise = Promise.resolve('ok');
    const result = await withTimeout(promise, 500, 'Test operation');
    expect(result).toBe('ok');
  });

  it('rejects with timeout message when the promise exceeds timeout duration', async () => {
    vi.useFakeTimers();
    try {
      const slowPromise = new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('late');
        }, 1000);
      });
      const raced = withTimeout(slowPromise, 100, 'RPC ping');
      vi.advanceTimersByTime(150);

      await expect(raced).rejects.toThrow('RPC ping timed out after 100ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates fast rejections from the underlying promise', async () => {
    const failedPromise = Promise.reject(new Error('Connection refused'));
    await expect(withTimeout(failedPromise, 500, 'Connect')).rejects.toThrow('Connection refused');
  });

  it('clears timeout timer upon fast settlement', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve(42), 1000, 'Quick');
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});
