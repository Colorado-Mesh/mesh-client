import { MS_PER_MINUTE, MS_PER_SECOND } from '@/shared/timeConstants';

import { sanitizeLogMessage } from '../log-service';

export interface TtlCacheOptions {
  maxEntries: number;
  ttlMs: number;
  maxBytes?: number;
}

interface CacheEntry<V> {
  value: V;
  expiresAtMs: number;
  bytes: number;
}

export class TtlCache<K, V> {
  private readonly map = new Map<K, CacheEntry<V>>();
  private totalBytes = 0;

  constructor(private readonly opts: TtlCacheOptions) {}

  get(key: K, nowMs = Date.now()): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= nowMs) {
      this.map.delete(key);
      this.totalBytes -= entry.bytes;
      return undefined;
    }
    // refresh LRU order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, nowMs = Date.now(), bytes = 0): void {
    const existing = this.map.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.map.delete(key);
    }
    const entry: CacheEntry<V> = {
      value,
      expiresAtMs: nowMs + this.opts.ttlMs,
      bytes: Math.max(0, bytes),
    };
    this.map.set(key, entry);
    this.totalBytes += entry.bytes;
    this.evict(nowMs);
  }

  clear(): void {
    this.map.clear();
    this.totalBytes = 0;
  }

  private evict(nowMs: number): void {
    for (const [key, entry] of this.map) {
      if (entry.expiresAtMs <= nowMs) {
        this.map.delete(key);
        this.totalBytes -= entry.bytes;
      }
    }
    while (this.map.size > this.opts.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.map.get(oldest);
      this.map.delete(oldest);
      if (entry) this.totalBytes -= entry.bytes;
    }
    const maxBytes = this.opts.maxBytes;
    if (maxBytes == null) return;
    while (this.totalBytes > maxBytes && this.map.size > 0) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.map.get(oldest);
      this.map.delete(oldest);
      if (entry) this.totalBytes -= entry.bytes;
    }
  }
}

export interface ProviderHealth {
  failures: number;
  openUntilMs: number;
  lastError: string | null;
}

const CIRCUIT_FAILURES = 3;
const CIRCUIT_OPEN_MS = 2 * MS_PER_MINUTE;

export class ProviderCircuit {
  private failures = 0;
  private openUntilMs = 0;
  private lastError: string | null = null;
  private halfOpen = false;

  constructor(private readonly name: string) {}

  canAttempt(nowMs = Date.now()): boolean {
    if (this.openUntilMs <= nowMs) {
      if (this.openUntilMs > 0) this.halfOpen = true;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openUntilMs = 0;
    this.halfOpen = false;
    this.lastError = null;
  }

  recordFailure(message: string, nowMs = Date.now()): void {
    this.lastError = message;
    if (this.halfOpen) {
      this.failures = CIRCUIT_FAILURES;
      this.halfOpen = false;
    } else {
      this.failures += 1;
    }
    if (this.failures >= CIRCUIT_FAILURES) {
      const wasOpen = this.openUntilMs > nowMs;
      this.openUntilMs = nowMs + CIRCUIT_OPEN_MS;
      if (!wasOpen) {
        console.warn(
          `[weather] circuit open for ${this.name}: ` + sanitizeLogMessage(message.slice(0, 200)),
        );
      }
    }
  }

  snapshot(): ProviderHealth {
    return {
      failures: this.failures,
      openUntilMs: this.openUntilMs,
      lastError: this.lastError,
    };
  }
}

/** Per-provider token bucket (fixed window). */
export class RateLimiter {
  private windowStartMs = 0;
  private count = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  tryAcquire(nowMs = Date.now()): boolean {
    if (nowMs - this.windowStartMs >= this.windowMs) {
      this.windowStartMs = nowMs;
      this.count = 0;
    }
    if (this.count >= this.limit) return false;
    this.count += 1;
    return true;
  }

  retryAfterMs(nowMs = Date.now()): number {
    const elapsed = nowMs - this.windowStartMs;
    return Math.max(MS_PER_SECOND, this.windowMs - elapsed);
  }
}

export async function withInflightDedup<K, T>(
  map: Map<K, Promise<T>>,
  key: K,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = fn().finally(() => {
    map.delete(key);
  });
  map.set(key, promise);
  return promise;
}
