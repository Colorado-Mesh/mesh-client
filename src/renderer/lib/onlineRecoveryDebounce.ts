import { MS_PER_SECOND } from '@/shared/timeConstants';

/** Wait for a stable online link before retrying WAN work (absorbs Wi‑Fi flaps). */
export const ONLINE_RECOVERY_DEBOUNCE_MS = 60 * MS_PER_SECOND;

/**
 * Schedules `onStableOnline` once after `delayMs` of continuous online.
 * Any offline event (or dispose) cancels a pending timer.
 */
export function createOnlineRecoveryScheduler(
  onStableOnline: () => void,
  delayMs: number = ONLINE_RECOVERY_DEBOUNCE_MS,
): { onOnline: () => void; onOffline: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    onOnline() {
      clear();
      timer = setTimeout(() => {
        timer = null;
        onStableOnline();
      }, delayMs);
    },
    onOffline() {
      clear();
    },
    dispose() {
      clear();
    },
  };
}
