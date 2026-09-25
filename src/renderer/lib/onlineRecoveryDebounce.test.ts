import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOnlineRecoveryScheduler,
  ONLINE_RECOVERY_DEBOUNCE_MS,
} from './onlineRecoveryDebounce';

describe('createOnlineRecoveryScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires once after the debounce window', () => {
    const onStable = vi.fn();
    const scheduler = createOnlineRecoveryScheduler(onStable, ONLINE_RECOVERY_DEBOUNCE_MS);
    scheduler.onOnline();
    vi.advanceTimersByTime(ONLINE_RECOVERY_DEBOUNCE_MS - 1);
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStable).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('resets the timer when online flaps before the window elapses', () => {
    const onStable = vi.fn();
    const scheduler = createOnlineRecoveryScheduler(onStable, ONLINE_RECOVERY_DEBOUNCE_MS);
    scheduler.onOnline();
    vi.advanceTimersByTime(ONLINE_RECOVERY_DEBOUNCE_MS / 2);
    scheduler.onOffline();
    scheduler.onOnline();
    vi.advanceTimersByTime(ONLINE_RECOVERY_DEBOUNCE_MS - 1);
    expect(onStable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStable).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it('does not double-fire when online is signaled twice within the window', () => {
    const onStable = vi.fn();
    const scheduler = createOnlineRecoveryScheduler(onStable, ONLINE_RECOVERY_DEBOUNCE_MS);
    scheduler.onOnline();
    vi.advanceTimersByTime(10_000);
    scheduler.onOnline();
    vi.advanceTimersByTime(ONLINE_RECOVERY_DEBOUNCE_MS);
    expect(onStable).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });
});
