import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRepeaterPostRebootStatusScheduler } from './meshcoreRepeaterPostRebootStatus';
import { MESHCORE_REPEATER_POST_REBOOT_STATUS_DELAY_MS } from './timeConstants';

describe('createRepeaterPostRebootStatusScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('requests Status once after the post-reboot delay', async () => {
    const requestStatus = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRepeaterPostRebootStatusScheduler(requestStatus);

    scheduler.schedule(0x1234, () => true);
    await vi.advanceTimersByTimeAsync(MESHCORE_REPEATER_POST_REBOOT_STATUS_DELAY_MS - 1);
    expect(requestStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(requestStatus).toHaveBeenCalledTimes(1);
    expect(requestStatus).toHaveBeenCalledWith(0x1234);

    await vi.advanceTimersByTimeAsync(MESHCORE_REPEATER_POST_REBOOT_STATUS_DELAY_MS * 2);
    expect(requestStatus).toHaveBeenCalledTimes(1);
  });

  it('replaces a pending refresh when the same node is rebooted again', async () => {
    const requestStatus = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRepeaterPostRebootStatusScheduler(requestStatus, 1_000);

    scheduler.schedule(7, () => true);
    await vi.advanceTimersByTimeAsync(600);
    scheduler.schedule(7, () => true);
    await vi.advanceTimersByTimeAsync(600);
    expect(requestStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    expect(requestStatus).toHaveBeenCalledTimes(1);
  });

  it('skips the refresh when the session is no longer current at fire time', async () => {
    const requestStatus = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRepeaterPostRebootStatusScheduler(requestStatus, 1_000);
    let current = true;

    scheduler.schedule(7, () => current);
    current = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requestStatus).not.toHaveBeenCalled();
  });

  it('cancelAll drops every pending refresh', async () => {
    const requestStatus = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRepeaterPostRebootStatusScheduler(requestStatus, 1_000);

    scheduler.schedule(1, () => true);
    scheduler.schedule(2, () => true);
    scheduler.cancelAll();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(requestStatus).not.toHaveBeenCalled();
  });

  it('logs and swallows a failed Status refresh', async () => {
    const requestStatus = vi.fn().mockRejectedValue(new Error('timed out'));
    const scheduler = createRepeaterPostRebootStatusScheduler(requestStatus, 1_000);

    scheduler.schedule(1, () => true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requestStatus).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });
});
