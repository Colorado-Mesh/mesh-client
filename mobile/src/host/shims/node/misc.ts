/** Small Node built-in shims for the mobile host worker. */
import { EventEmitter } from 'events';

// perf_hooks
export const performance = globalThis.performance;
export class PerformanceObserver {
  observe(): void {}
  disconnect(): void {}
}
export function monitorEventLoopDelay(): {
  enable(): void;
  disable(): void;
  percentile(): number;
  mean: number;
  max: number;
  reset(): void;
} {
  return { enable() {}, disable() {}, percentile: () => 0, mean: 0, max: 0, reset() {} };
}

// async_hooks
export class AsyncLocalStorage<T> {
  private store: T | undefined;
  getStore(): T | undefined {
    return this.store;
  }
  run<R>(store: T, fn: (...a: unknown[]) => R, ...args: unknown[]): R {
    const prev = this.store;
    this.store = store;
    try {
      return fn(...args);
    } finally {
      this.store = prev;
    }
  }
  enterWith(store: T): void {
    this.store = store;
  }
  disable(): void {
    this.store = undefined;
  }
}
export class AsyncResource {
  constructor(public type: string) {}
  runInAsyncScope<R>(fn: (...a: unknown[]) => R, thisArg?: unknown, ...args: unknown[]): R {
    return fn.apply(thisArg, args);
  }
  emitDestroy(): this {
    return this;
  }
  static bind<F>(fn: F): F {
    return fn;
  }
}
export function createHook(): { enable(): void; disable(): void } {
  return { enable() {}, disable() {} };
}

// v8
export function getHeapStatistics(): Record<string, number> {
  const m = (
    performance as unknown as {
      memory?: { totalJSHeapSize: number; usedJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  return {
    total_heap_size: m?.totalJSHeapSize ?? 0,
    used_heap_size: m?.usedJSHeapSize ?? 0,
    heap_size_limit: m?.jsHeapSizeLimit ?? 0,
    total_available_size: 0,
    malloced_memory: 0,
    external_memory: 0,
  };
}
export function getHeapSpaceStatistics(): unknown[] {
  return [];
}
export function writeHeapSnapshot(): string {
  throw new Error('Heap snapshots are not available on mobile');
}
export function setFlagsFromString(): void {}

// diagnostics_channel
export function channel(): {
  publish(): void;
  subscribe(): void;
  unsubscribe(): void;
  hasSubscribers: boolean;
} {
  return { publish() {}, subscribe() {}, unsubscribe() {}, hasSubscribers: false };
}
export function subscribe(): void {}
export function unsubscribe(): void {}

// tty
export function isatty(): boolean {
  return false;
}

// inspector
export const Session = EventEmitter;
export function open(): void {}
export function url(): undefined {
  return undefined;
}
