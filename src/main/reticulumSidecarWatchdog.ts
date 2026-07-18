import { MS_PER_SECOND } from '../shared/timeConstants';

export const SIDECAR_WATCHDOG_POLL_INTERVAL_MS = 30 * MS_PER_SECOND;
export const SIDECAR_WATCHDOG_FETCH_TIMEOUT_MS = 5 * MS_PER_SECOND;
/** Consecutive hung polls before a restart attempt. */
export const SIDECAR_WATCHDOG_HUNG_FAILURE_THRESHOLD = 2;

export interface SidecarWatchdogOptions {
  /** Current sidecar HTTP port; return undefined/0 when not running. */
  getPort: () => number | undefined;
  /**
   * True when the child process is still alive (no exit event).
   * Hung detection only runs while the process is alive — crash/exit
   * restarts remain owned by the renderer autostart path.
   */
  isProcessAlive: () => boolean;
  /** Restart a hung sidecar (process alive, HTTP unresponsive). */
  restartFn: () => Promise<void>;
  /** Called when status health flips (for ReticulumSidecarStatus.healthy). */
  onHealthChange?: (healthy: boolean) => void;
  pollIntervalMs?: number;
  fetchTimeoutMs?: number;
  failureThreshold?: number;
  /** Injectable fetch for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Poll localhost `/api/v1/status` while the sidecar process is alive.
 * On consecutive failures (hung HTTP), attempt one restart. Does not handle
 * process-exit crashes — those already emit `status.running === false`.
 */
export function startSidecarWatchdog(opts: SidecarWatchdogOptions): () => void {
  const {
    getPort,
    isProcessAlive,
    restartFn,
    onHealthChange,
    pollIntervalMs = SIDECAR_WATCHDOG_POLL_INTERVAL_MS,
    fetchTimeoutMs = SIDECAR_WATCHDOG_FETCH_TIMEOUT_MS,
    failureThreshold = SIDECAR_WATCHDOG_HUNG_FAILURE_THRESHOLD,
    fetchImpl = fetch,
  } = opts;

  let consecutiveFailures = 0;
  let restartInFlight = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const setHealthy = (healthy: boolean) => {
    onHealthChange?.(healthy);
  };

  const poll = async () => {
    if (stopped || restartInFlight) return;
    if (!isProcessAlive()) {
      consecutiveFailures = 0;
      return;
    }
    const port = getPort();
    if (port == null || port <= 0) {
      consecutiveFailures = 0;
      return;
    }

    try {
      const res = await fetchImpl(`http://127.0.0.1:${port}/api/v1/status`, {
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      if (!res.ok) {
        throw new Error(`status ${res.status}`);
      }
      const body = (await res.json()) as { status?: string };
      if (body.status !== 'ok') {
        throw new Error(`unexpected status field: ${body.status ?? 'missing'}`);
      }
      consecutiveFailures = 0;
      setHealthy(true);
    } catch (err) {
      consecutiveFailures += 1;
      console.warn(
        `[reticulumSidecarWatchdog] hung poll failure ${consecutiveFailures}/${failureThreshold}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (consecutiveFailures < failureThreshold) {
        setHealthy(false);
        return;
      }
      // Failure point: sidecar process alive but HTTP unresponsive.
      // Fallback: one restart attempt; renderer still owns exit-based reconnect.
      restartInFlight = true;
      setHealthy(false);
      try {
        console.warn('[reticulumSidecarWatchdog] restarting hung sidecar');
        await restartFn();
        consecutiveFailures = 0;
        setHealthy(true);
      } catch (restartErr) {
        console.error(
          '[reticulumSidecarWatchdog] hung restart failed: ' +
            (restartErr instanceof Error ? restartErr.message : String(restartErr)),
        );
        setHealthy(false);
      } finally {
        restartInFlight = false;
      }
    }
  };

  timer = setInterval(() => {
    void poll();
  }, pollIntervalMs);

  return () => {
    stopped = true;
    if (timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
