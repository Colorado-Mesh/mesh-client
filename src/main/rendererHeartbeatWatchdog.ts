export const RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS = 30_000;
const RENDERER_HEARTBEAT_TS_PAST_SLACK_MS = 60_000;
const RENDERER_HEARTBEAT_TS_FUTURE_SLACK_MS = 5_000;

function clampRendererHeartbeatTs(ts: number | undefined, now = Date.now()): number {
  if (ts == null || !Number.isFinite(ts)) return now;
  const minTs = now - RENDERER_HEARTBEAT_TS_PAST_SLACK_MS;
  const maxTs = now + RENDERER_HEARTBEAT_TS_FUTURE_SLACK_MS;
  return Math.min(Math.max(ts, minTs), maxTs);
}

export interface RendererHeartbeatWatchdog {
  recordHeartbeat: (ts?: number) => void;
  startResumeWatchdog: () => void;
  clearResumeWatchdog: () => void;
}

export function createRendererHeartbeatWatchdog(
  warn: (message: string) => void = console.warn,
): RendererHeartbeatWatchdog {
  let lastRendererHeartbeatAt = 0;
  let rendererResumeWatchdogTimer: ReturnType<typeof setTimeout> | null = null;

  const clearResumeWatchdog = (): void => {
    if (rendererResumeWatchdogTimer) {
      clearTimeout(rendererResumeWatchdogTimer);
      rendererResumeWatchdogTimer = null;
    }
  };

  const recordHeartbeat = (ts?: number): void => {
    lastRendererHeartbeatAt = clampRendererHeartbeatTs(ts);
    clearResumeWatchdog();
  };

  const startResumeWatchdog = (): void => {
    clearResumeWatchdog();
    const resumeAt = Date.now();
    rendererResumeWatchdogTimer = setTimeout(() => {
      rendererResumeWatchdogTimer = null;
      if (lastRendererHeartbeatAt >= resumeAt) return;
      warn('[main] renderer unresponsive after system resume (no heartbeat within 30s)');
    }, RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);
    rendererResumeWatchdogTimer.unref?.();
  };

  return { recordHeartbeat, startResumeWatchdog, clearResumeWatchdog };
}
