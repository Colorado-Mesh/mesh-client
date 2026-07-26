import { errLikeToLogString } from './errLikeToLogString';

const MAX_PENDING_PERSIST_WRITES = 200;
const MAX_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_000;

interface PendingPersistWrite {
  label: string;
  attempt: number;
  write: () => Promise<unknown>;
}

const pendingWrites: PendingPersistWrite[] = [];
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;

function scheduleRetry(): void {
  if (retryTimer || pendingWrites.length === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void flushRetries();
  }, RETRY_DELAY_MS);
}

async function flushRetries(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    // Snapshot one batch so an individual write is attempted at most once per
    // delay. This prevents a persistent failure from spinning in one flush.
    const batch = pendingWrites.splice(0);
    for (const pending of batch) {
      try {
        await pending.write();
      } catch (error) {
        if (pending.attempt >= MAX_RETRY_ATTEMPTS) {
          console.warn(
            `[dbPersistRetry] degraded persistence: ${pending.label} failed after retries: ` +
              errLikeToLogString(error),
          );
        } else {
          // catch-no-log-ok intermediate failures are retried; only the final attempt warns
          pending.attempt++;
          pendingWrites.push(pending);
        }
      }
    }
  } finally {
    flushing = false;
    scheduleRetry();
  }
}

/**
 * Persist an already-applied UI update. Failed writes enter a bounded,
 * batched retry queue; after the final retry the in-memory state remains
 * authoritative and a degraded-persistence warning is emitted.
 */
export function persistDbWrite(label: string, write: () => Promise<unknown>): void {
  void write().catch((error: unknown) => {
    if (pendingWrites.length >= MAX_PENDING_PERSIST_WRITES) {
      console.warn(
        `[dbPersistRetry] degraded persistence: queue full; dropping ${label}: ` +
          errLikeToLogString(error),
      );
      return;
    }
    // catch-no-log-ok first failure is queued for bounded retry; final attempt warns in flush
    pendingWrites.push({ label, attempt: 0, write });
    scheduleRetry();
  });
}
