import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRendererHeartbeatWatchdog,
  RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS,
} from './rendererHeartbeatWatchdog';

describe('createRendererHeartbeatWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns when no heartbeat arrives within 30s after resume', async () => {
    const warn = vi.fn();
    const watchdog = createRendererHeartbeatWatchdog(warn);

    watchdog.startResumeWatchdog();
    await vi.advanceTimersByTimeAsync(RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);

    expect(warn).toHaveBeenCalledWith(
      '[main] renderer unresponsive after system resume (no heartbeat within 30s)',
    );
  });

  it('does not warn when heartbeat arrives after resume', async () => {
    const warn = vi.fn();
    const watchdog = createRendererHeartbeatWatchdog(warn);

    watchdog.startResumeWatchdog();
    await vi.advanceTimersByTimeAsync(5_000);
    watchdog.recordHeartbeat();
    await vi.advanceTimersByTimeAsync(RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);

    expect(warn).not.toHaveBeenCalled();
  });

  it('clears pending watchdog on heartbeat without resume', async () => {
    const warn = vi.fn();
    const watchdog = createRendererHeartbeatWatchdog(warn);

    watchdog.startResumeWatchdog();
    watchdog.recordHeartbeat();
    await vi.advanceTimersByTimeAsync(RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);

    expect(warn).not.toHaveBeenCalled();
  });

  it('clamps heartbeat timestamps at past and future slack boundaries', async () => {
    const warn = vi.fn();
    const resumeAt = 1_000_000;
    vi.setSystemTime(resumeAt);

    const watchdog = createRendererHeartbeatWatchdog(warn);
    watchdog.startResumeWatchdog();

    vi.setSystemTime(resumeAt + 61_000);
    watchdog.recordHeartbeat(resumeAt - 1);
    await vi.advanceTimersByTimeAsync(RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);
    expect(warn).not.toHaveBeenCalled();

    vi.setSystemTime(resumeAt + 120_000);
    watchdog.startResumeWatchdog();
    watchdog.recordHeartbeat(resumeAt + 120_000 + 5_001);
    await vi.advanceTimersByTimeAsync(RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses current time when heartbeat timestamp is missing or non-finite', async () => {
    const warn = vi.fn();
    const resumeAt = 2_000_000;
    vi.setSystemTime(resumeAt);

    const watchdog = createRendererHeartbeatWatchdog(warn);
    watchdog.startResumeWatchdog();

    vi.setSystemTime(resumeAt + 1_000);
    watchdog.recordHeartbeat(undefined);
    await vi.advanceTimersByTimeAsync(RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);
    expect(warn).not.toHaveBeenCalled();

    vi.setSystemTime(resumeAt + 10_000);
    watchdog.startResumeWatchdog();
    watchdog.recordHeartbeat(Number.NaN);
    await vi.advanceTimersByTimeAsync(RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);
    expect(warn).not.toHaveBeenCalled();
  });
});
