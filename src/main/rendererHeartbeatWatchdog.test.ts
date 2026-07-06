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
});
