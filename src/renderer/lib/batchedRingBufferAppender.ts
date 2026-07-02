import type { Dispatch, SetStateAction } from 'react';

/** Batches ring-buffer appends and flushes on the next animation frame. */
export class BatchedRingBufferAppender<T> {
  private pending: T[] = [];
  private rafId: number | null = null;

  constructor(
    private readonly setState: Dispatch<SetStateAction<T[]>>,
    private readonly maxEntries: number,
  ) {}

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
      const next = [...prev, ...batch];
      return next.length > this.maxEntries ? next.slice(next.length - this.maxEntries) : next;
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
