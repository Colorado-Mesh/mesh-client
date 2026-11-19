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
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
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
    // Bound pending at append time — RAF does not run while the window is hidden.
    if (this.pending.length > this.maxEntries) {
      this.pending.splice(0, this.pending.length - this.maxEntries);
    }
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
    if (this.rafId != null || this.timeoutId != null) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (hidden || typeof requestAnimationFrame !== 'function') {
      // Drain without waiting for a frame that may never come while backgrounded.
      this.timeoutId = setTimeout(() => {
        this.timeoutId = null;
        this.flush();
      }, 0);
      return;
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.flush();
    });
  }

  private cancelScheduledFlush(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId != null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
