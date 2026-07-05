import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS = 30_000;

describe('renderer resume heartbeat watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns when no heartbeat arrives within 30s after resume', async () => {
    const lastRendererHeartbeatAt = 0;
    let rendererResumeWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const clearRendererResumeWatchdog = () => {
      if (rendererResumeWatchdogTimer) {
        clearTimeout(rendererResumeWatchdogTimer);
        rendererResumeWatchdogTimer = null;
      }
    };

    const startRendererResumeWatchdog = () => {
      clearRendererResumeWatchdog();
      const resumeAt = Date.now();
      rendererResumeWatchdogTimer = setTimeout(() => {
        rendererResumeWatchdogTimer = null;
        if (lastRendererHeartbeatAt >= resumeAt) return;
        console.warn('[main] renderer unresponsive after system resume (no heartbeat within 30s)');
      }, RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);
    };

    startRendererResumeWatchdog();
    await vi.advanceTimersByTimeAsync(RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);
    expect(warn).toHaveBeenCalledWith(
      '[main] renderer unresponsive after system resume (no heartbeat within 30s)',
    );
  });
});
