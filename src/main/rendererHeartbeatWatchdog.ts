export const RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS = 30_000;
/** Visible-window stall: no heartbeat for this long → warn (renderer pauses while hidden). */
export const RENDERER_HEARTBEAT_STALL_MS = 90_000;
export const RENDERER_HEARTBEAT_STALL_POLL_MS = 30_000;
const RENDERER_HEARTBEAT_TS_PAST_SLACK_MS = 60_000;
const RENDERER_HEARTBEAT_TS_FUTURE_SLACK_MS = 5_000;

function clampRendererHeartbeatTs(ts: number | undefined, now = Date.now()): number {
  if (ts == null || !Number.isFinite(ts)) return now;
  const minTs = now - RENDERER_HEARTBEAT_TS_PAST_SLACK_MS;
  const maxTs = now + RENDERER_HEARTBEAT_TS_FUTURE_SLACK_MS;
  return Math.min(Math.max(ts, minTs), maxTs);
}

export interface RendererHeartbeatLivenessSnapshot {
  lastRendererHeartbeatAgeMs: number | null;
  rendererUnresponsiveSeen: boolean;
}

export interface RendererHeartbeatWatchdog {
  recordHeartbeat: (ts?: number) => void;
  startResumeWatchdog: () => void;
  clearResumeWatchdog: () => void;
  /** Electron webContents `unresponsive` — sticky session flag + warn. */
  markRendererUnresponsive: () => void;
  /** Electron webContents `responsive` — log recovery; keeps session flag set. */
  markRendererResponsive: () => void;
  /**
   * Poll for missing heartbeats while the main window is visibly active.
   * Pass a getter that is true only when the window is shown and not minimized
   * (renderer already pauses heartbeats while `document.hidden`).
   */
  startStallWatchdog: (isWindowActivelyVisible: () => boolean) => void;
  stopStallWatchdog: () => void;
  getLivenessSnapshot: () => RendererHeartbeatLivenessSnapshot;
}

export function createRendererHeartbeatWatchdog(
  warn: (message: string) => void = console.warn,
): RendererHeartbeatWatchdog {
  let lastRendererHeartbeatAt = 0;
  let rendererResumeWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let stallPollTimer: ReturnType<typeof setInterval> | null = null;
  let rendererUnresponsiveSeen = false;
  let stallEpisodeActive = false;

  const clearResumeWatchdog = (): void => {
    if (rendererResumeWatchdogTimer) {
      clearTimeout(rendererResumeWatchdogTimer);
      rendererResumeWatchdogTimer = null;
    }
  };

  const recordHeartbeat = (ts?: number): void => {
    lastRendererHeartbeatAt = clampRendererHeartbeatTs(ts);
    clearResumeWatchdog();
    stallEpisodeActive = false;
  };

  const startResumeWatchdog = (): void => {
    clearResumeWatchdog();
    const resumeAt = Date.now();
    rendererResumeWatchdogTimer = setTimeout(() => {
      rendererResumeWatchdogTimer = null;
      if (lastRendererHeartbeatAt >= resumeAt) return;
      rendererUnresponsiveSeen = true;
      warn('[main] renderer unresponsive after system resume (no heartbeat within 30s)');
    }, RENDERER_HEARTBEAT_RESUME_WATCHDOG_MS);
    rendererResumeWatchdogTimer.unref?.();
  };

  const markRendererUnresponsive = (): void => {
    rendererUnresponsiveSeen = true;
    warn('[main] renderer webContents unresponsive');
  };

  const markRendererResponsive = (): void => {
    warn('[main] renderer webContents responsive again');
  };

  const stopStallWatchdog = (): void => {
    if (stallPollTimer) {
      clearInterval(stallPollTimer);
      stallPollTimer = null;
    }
  };

  const startStallWatchdog = (isWindowActivelyVisible: () => boolean): void => {
    stopStallWatchdog();
    stallPollTimer = setInterval(() => {
      if (!isWindowActivelyVisible()) return;
      if (lastRendererHeartbeatAt <= 0) return;
      const ageMs = Date.now() - lastRendererHeartbeatAt;
      if (ageMs < RENDERER_HEARTBEAT_STALL_MS) return;
      if (stallEpisodeActive) return;
      stallEpisodeActive = true;
      rendererUnresponsiveSeen = true;
      warn('[main] renderer heartbeat stalled (no heartbeat while window visible)');
    }, RENDERER_HEARTBEAT_STALL_POLL_MS);
    stallPollTimer.unref?.();
  };

  const getLivenessSnapshot = (): RendererHeartbeatLivenessSnapshot => {
    const ageMs =
      lastRendererHeartbeatAt <= 0 ? null : Math.max(0, Date.now() - lastRendererHeartbeatAt);
    return {
      lastRendererHeartbeatAgeMs: ageMs,
      rendererUnresponsiveSeen,
    };
  };

  return {
    recordHeartbeat,
    startResumeWatchdog,
    clearResumeWatchdog,
    markRendererUnresponsive,
    markRendererResponsive,
    startStallWatchdog,
    stopStallWatchdog,
    getLivenessSnapshot,
  };
}
