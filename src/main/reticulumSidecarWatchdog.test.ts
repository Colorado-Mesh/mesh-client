import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SIDECAR_WATCHDOG_HUNG_FAILURE_THRESHOLD,
  SIDECAR_WATCHDOG_POLL_INTERVAL_MS,
  startSidecarWatchdog,
} from './reticulumSidecarWatchdog';

describe('startSidecarWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not restart when the process is not alive', async () => {
    const restartFn = vi.fn();
    const fetchImpl = vi.fn() as typeof fetch;
    const stop = startSidecarWatchdog({
      getPort: () => 1234,
      isProcessAlive: () => false,
      restartFn,
      fetchImpl,
      pollIntervalMs: SIDECAR_WATCHDOG_POLL_INTERVAL_MS,
    });

    await vi.advanceTimersByTimeAsync(SIDECAR_WATCHDOG_POLL_INTERVAL_MS * 3);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(restartFn).not.toHaveBeenCalled();
    stop();
  });

  it('resets failures after a successful health poll', async () => {
    const onHealthChange = vi.fn();
    const restartFn = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' }),
      }) as unknown as typeof fetch;

    const stop = startSidecarWatchdog({
      getPort: () => 1234,
      isProcessAlive: () => true,
      restartFn,
      onHealthChange,
      fetchImpl,
      pollIntervalMs: 1000,
      failureThreshold: SIDECAR_WATCHDOG_HUNG_FAILURE_THRESHOLD,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(onHealthChange).toHaveBeenCalledWith(false);
    expect(restartFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(onHealthChange).toHaveBeenCalledWith(true);
    expect(restartFn).not.toHaveBeenCalled();
    stop();
  });

  it('restarts after consecutive hung failures', async () => {
    const restartFn = vi.fn().mockResolvedValue(undefined);
    const onHealthChange = vi.fn();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;

    const stop = startSidecarWatchdog({
      getPort: () => 1234,
      isProcessAlive: () => true,
      restartFn,
      onHealthChange,
      fetchImpl,
      pollIntervalMs: 1000,
      failureThreshold: 2,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(restartFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(restartFn).toHaveBeenCalledTimes(1);
    expect(onHealthChange).toHaveBeenCalledWith(false);
    stop();
  });
});
