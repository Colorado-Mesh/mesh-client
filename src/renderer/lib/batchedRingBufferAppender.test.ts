import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BatchedRingBufferAppender } from './batchedRingBufferAppender';

describe('BatchedRingBufferAppender', () => {
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    rafCallbacks = [];
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
    globalThis.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function flushRaf(): void {
    const callbacks = [...rafCallbacks];
    rafCallbacks = [];
    for (const cb of callbacks) {
      cb(0);
    }
  }

  it('flushes queued entries on the next animation frame', () => {
    const setState = vi.fn();
    const appender = new BatchedRingBufferAppender<number>(setState, 5);

    appender.append(1);
    appender.append(2);
    expect(setState).not.toHaveBeenCalled();

    flushRaf();
    expect(setState).toHaveBeenCalledTimes(1);
    const updater = setState.mock.calls[0][0] as (prev: number[]) => number[];
    expect(updater([])).toEqual([1, 2]);
  });

  it('trims to max entries after flush', () => {
    const setState = vi.fn();
    const appender = new BatchedRingBufferAppender<number>(setState, 3);

    appender.append(1);
    appender.append(2);
    appender.flush();
    const updater = setState.mock.calls[0][0] as (prev: number[]) => number[];
    expect(updater([3, 4])).toEqual([4, 1, 2]);
  });

  it('clearPending drops queued entries before flush', () => {
    const setState = vi.fn();
    const appender = new BatchedRingBufferAppender<number>(setState, 5);

    appender.append(1);
    appender.clearPending();
    flushRaf();

    expect(setState).not.toHaveBeenCalled();
  });

  it('bounds pending at append time even before flush', () => {
    const setState = vi.fn();
    const appender = new BatchedRingBufferAppender<number>(setState, 3);

    appender.append(1);
    appender.append(2);
    appender.append(3);
    appender.append(4);
    appender.append(5);
    appender.flush();
    const updater = setState.mock.calls[0][0] as (prev: number[]) => number[];
    expect(updater([])).toEqual([3, 4, 5]);
  });

  it('drains via setTimeout when the document is hidden', () => {
    vi.useFakeTimers();
    const setState = vi.fn();
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { visibilityState: 'hidden' },
    });
    try {
      const appender = new BatchedRingBufferAppender<number>(setState, 5);
      appender.append(9);
      expect(setState).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(setState).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previousDocument,
      });
      vi.useRealTimers();
    }
  });
});
