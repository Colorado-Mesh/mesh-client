import { errLikeToLogString } from './errLikeToLogString';
import { MESHCORE_REPEATER_POST_REBOOT_STATUS_DELAY_MS } from './timeConstants';

export interface RepeaterPostRebootStatusScheduler {
  /** Replace any pending refresh for `nodeId`; `isCurrent` is re-checked when the timer fires. */
  schedule(nodeId: number, isCurrent: () => boolean): void;
  cancelAll(): void;
}

/** One-shot Status re-query per repeater after a CLI reboot, once the board has had time to boot. */
export function createRepeaterPostRebootStatusScheduler(
  requestStatus: (nodeId: number) => Promise<unknown>,
  delayMs: number = MESHCORE_REPEATER_POST_REBOOT_STATUS_DELAY_MS,
): RepeaterPostRebootStatusScheduler {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  return {
    schedule(nodeId, isCurrent) {
      const existing = timers.get(nodeId);
      if (existing != null) clearTimeout(existing);
      timers.set(
        nodeId,
        setTimeout(() => {
          timers.delete(nodeId);
          if (!isCurrent()) return;
          requestStatus(nodeId).catch((e: unknown) => {
            console.warn(
              '[meshcoreRepeaterPostRebootStatus] post-reboot status error ' +
                errLikeToLogString(e),
            );
          });
        }, delayMs),
      );
    },
    cancelAll() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
