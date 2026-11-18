import type { Dispatch, SetStateAction } from 'react';

export interface BatchedRingBufferAppenderOptions<T> {
  /**
   * Called with the next ring buffer inside the setState updater (before React commit).
   * MeshCore uses this to keep `rawPacketsRef` in sync for same-tick hop correlation.
   */
  syncBeforeCommit?: (next: T[]) => void;
  /**
   * Merge pending batch into `prev`. Default concatenates then trims to `maxEntries`.
   * MeshCore self-flood advert coalescing can replace this.
   */
  mergeBatch?: (prev: T[], batch: T[]) => T[];
}

/** Batches ring-buffer appends and flushes on the next animation frame. */
export class BatchedRingBufferAppender<T> {
  private pending: T[] = [];
  private rafId: number | null = null;
  private readonly syncBeforeCommit?: (next: T[]) => void;
  private readonly mergeBatch?: (prev: T[], batch: T[]) => T[];

  constructor(
    private readonly setState: Dispatch<SetStateAction<T[]>>,
    private readonly maxEntries: number,
    options?: BatchedRingBufferAppenderOptions<T>,
  ) {
    this.syncBeforeCommit = options?.syncBeforeCommit;
    this.mergeBatch = options?.mergeBatch;
  }

  append(entry: T): void {
    this.pending.push(entry);
    this.scheduleFlush();
  }

  flush(): void {
    this.cancelScheduledFlush();
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;
    this.setState((prev) => {
      const next = this.mergeBatch
        ? this.mergeBatch(prev, batch)
        : (() => {
            const concatenated = [...prev, ...batch];
            return concatenated.length > this.maxEntries
              ? concatenated.slice(concatenated.length - this.maxEntries)
              : concatenated;
          })();
      this.syncBeforeCommit?.(next);
      return next;
    });
  }

  clearPending(): void {
    this.pending = [];
    this.cancelScheduledFlush();
  }

  private scheduleFlush(): void {
    if (this.rafId != null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.flush();
    });
  }

  private cancelScheduledFlush(): void {
    if (this.rafId == null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }
}
