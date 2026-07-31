/**
 * Small rolling-window IPC rate limiter (export/crypto/proxy DoS guard).
 * Similar to fetchLinkPreview / reticulum-attachment-image token windows.
 */

export interface IpcRateLimiterOpts {
  max: number;
  windowMs: number;
  label: string;
}

export interface IpcRateLimiter {
  /** Throws `${label}: rate limit exceeded` when over the rolling-window max. */
  checkOrThrow(now?: number): void;
  /** Test helper — clears the rolling window. */
  resetForTests(): void;
}

export function createIpcRateLimiter(opts: IpcRateLimiterOpts): IpcRateLimiter {
  const { max, windowMs, label } = opts;
  const timestamps: number[] = [];

  return {
    checkOrThrow(now = Date.now()): void {
      const cutoff = now - windowMs;
      while (timestamps.length > 0) {
        const oldest = timestamps[0];
        if (oldest === undefined || oldest >= cutoff) break;
        timestamps.shift();
      }
      if (timestamps.length >= max) {
        throw new Error(`${label}: rate limit exceeded`);
      }
      timestamps.push(now);
    },
    resetForTests(): void {
      timestamps.length = 0;
    },
  };
}
