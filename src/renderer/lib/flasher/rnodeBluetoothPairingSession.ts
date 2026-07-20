/**
 * Isolates Admin Start-pairing pending-timer / attempt generation so disable,
 * re-enable, and overlapping attempts cannot clear a newer attempt's pending state.
 */
export interface RNodeBluetoothPairingSessionOptions {
  timeoutMs: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface RNodeBluetoothPairingAttempt {
  readonly generation: number;
  isCurrent(): boolean;
  clearTimer(): void;
}

export class RNodeBluetoothPairingSession {
  private generation = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly timeoutMs: number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;

  constructor(options: RNodeBluetoothPairingSessionOptions) {
    this.timeoutMs = options.timeoutMs;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  /** Cancel any in-flight pending timer and invalidate the current attempt. */
  invalidate(): void {
    this.generation += 1;
    this.clearPendingTimer();
  }

  begin(onTimeout: () => void): RNodeBluetoothPairingAttempt {
    this.invalidate();
    const generation = this.generation;
    this.pendingTimer = this.setTimeoutFn(() => {
      this.pendingTimer = null;
      if (generation !== this.generation) return;
      onTimeout();
    }, this.timeoutMs);
    return {
      generation,
      isCurrent: () => generation === this.generation,
      clearTimer: () => {
        if (generation !== this.generation) return;
        this.clearPendingTimer();
      },
    };
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer == null) return;
    this.clearTimeoutFn(this.pendingTimer);
    this.pendingTimer = null;
  }
}
