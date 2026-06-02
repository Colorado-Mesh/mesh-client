// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { delayUnlessSuspended, setSystemSuspended, waitForSystemResumed } from './systemPowerState';

describe('systemPowerState', () => {
  beforeEach(() => {
    setSystemSuspended(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    setSystemSuspended(false);
    vi.useRealTimers();
  });

  it('delayUnlessSuspended returns suspended when system suspends mid-wait', async () => {
    const promise = delayUnlessSuspended(5_000, () => false, 500);
    await vi.advanceTimersByTimeAsync(1_000);
    setSystemSuspended(true);
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBe('suspended');
  });

  it('delayUnlessSuspended completes when not suspended', async () => {
    const promise = delayUnlessSuspended(1_000, () => false, 250);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toBe('done');
  });

  it('waitForSystemResumed resolves immediately when awake', async () => {
    await expect(waitForSystemResumed()).resolves.toBeUndefined();
  });

  it('waitForSystemResumed resolves after resume', async () => {
    setSystemSuspended(true);
    const promise = waitForSystemResumed();
    setSystemSuspended(false);
    await expect(promise).resolves.toBeUndefined();
  });
});
