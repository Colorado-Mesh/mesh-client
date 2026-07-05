import {
  MESHCORE_WAITING_MESSAGES_AFTER_TX_DEFER_MS,
  MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS,
  MESHCORE_WAITING_MESSAGES_SILENT_TIMEOUT_MS,
  MESHCORE_WAITING_MESSAGES_SYNC_TIMEOUT_MS,
} from './timeConstants';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastCompanionTxAt = 0;

/** Record outbound companion RF TX so auto-drains can defer until the radio settles. */
export function markMeshcoreCompanionTx(): void {
  lastCompanionTxAt = Date.now();
}

/** Test hook — reset module state between unit tests. */
export function resetMeshcoreWaitingMessagesDrainState(now = 0): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  lastCompanionTxAt = now;
}

export function resetMeshcoreWaitingMessagesDrainSchedule(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function waitingMessagesDrainTimeoutMs(showSyncBanner: boolean): number {
  return showSyncBanner
    ? MESHCORE_WAITING_MESSAGES_SYNC_TIMEOUT_MS
    : MESHCORE_WAITING_MESSAGES_SILENT_TIMEOUT_MS;
}

export function shouldActivateWaitingMessagesBanner(
  showSyncBanner: boolean,
  total: number,
): boolean {
  return showSyncBanner && total > 0;
}

export interface ScheduleMeshcoreWaitingMessagesDrainOptions {
  isMounted?: () => boolean;
}

/**
 * Debounce MsgWaiting (131) auto-drains and defer briefly after recent companion TX.
 * Failure point: drain throws — caller should log; no UI for silent paths.
 */
export function scheduleMeshcoreWaitingMessagesDrain(
  drain: () => Promise<void>,
  options?: ScheduleMeshcoreWaitingMessagesDrainOptions,
): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void (async () => {
      const elapsedSinceTx = Date.now() - lastCompanionTxAt;
      const deferRemaining = MESHCORE_WAITING_MESSAGES_AFTER_TX_DEFER_MS - elapsedSinceTx;
      if (deferRemaining > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, deferRemaining);
        });
      }
      if (options?.isMounted && !options.isMounted()) {
        return;
      }
      await drain();
    })();
  }, MESHCORE_WAITING_MESSAGES_DRAIN_DEBOUNCE_MS);
}
