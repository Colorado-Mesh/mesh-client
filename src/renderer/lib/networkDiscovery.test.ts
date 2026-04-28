import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startNetworkDiscovery } from './networkDiscovery';

describe('startNetworkDiscovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('immediately traces all nodes returned by getNodeIds', async () => {
    const traced: number[] = [];
    const stop = startNetworkDiscovery(
      (id) => {
        traced.push(id);
        return Promise.resolve();
      },
      () => [1, 2, 3],
      60_000,
      0,
    );

    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect([...traced].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('does not trace after stop() is called', async () => {
    const traced: number[] = [];
    const stop = startNetworkDiscovery(
      async (id) => {
        await Promise.resolve();
        traced.push(id);
      },
      () => [10, 20],
      60_000,
      0,
    );

    stop();
    await vi.advanceTimersByTimeAsync(0);

    expect(traced).toEqual([]);
  });

  it('schedules a second sweep after the interval', async () => {
    const traced: number[] = [];
    const stop = startNetworkDiscovery(
      (id) => {
        traced.push(id);
        return Promise.resolve();
      },
      () => [5],
      10_000,
      0,
    );

    // First sweep (immediate)
    await vi.advanceTimersByTimeAsync(0);
    expect(traced).toEqual([5]);

    // Second sweep after interval
    await vi.advanceTimersByTimeAsync(10_000);
    expect(traced).toEqual([5, 5]);

    stop();
  });

  it('does not run a second sweep after stop()', async () => {
    const traced: number[] = [];
    const stop = startNetworkDiscovery(
      (id) => {
        traced.push(id);
        return Promise.resolve();
      },
      () => [7],
      5_000,
      0,
    );

    await vi.advanceTimersByTimeAsync(0);
    stop();

    // Advance past where the second sweep would fire; no more timers are pending
    await vi.advanceTimersByTimeAsync(10_000);

    expect(traced).toEqual([7]);
  });

  it('logs a warning and continues on traceroute error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const traced: number[] = [];

    const stop = startNetworkDiscovery(
      (id) => {
        if (id === 2) return Promise.reject(new Error('timeout'));
        traced.push(id);
        return Promise.resolve();
      },
      () => [1, 2, 3],
      60_000,
      0,
    );

    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect([...traced].sort((a, b) => a - b)).toEqual([1, 3]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[networkDiscovery] traceroute failed for node',
      2,
      'timeout',
    );

    warnSpy.mockRestore();
  });

  it('staggers node trace starts by interNodeStaggerMs', async () => {
    const startTimes: Record<number, number> = {};
    const stop = startNetworkDiscovery(
      (id) => {
        startTimes[id] = Date.now();
        return Promise.resolve();
      },
      () => [1, 2, 3],
      60_000,
      500,
    );

    // Advance past initial yield then through all stagger timers
    await vi.advanceTimersByTimeAsync(0); // yield for index 0
    await vi.advanceTimersByTimeAsync(500); // stagger for index 1
    await vi.advanceTimersByTimeAsync(500); // stagger delta for index 2
    stop();

    expect(startTimes[1]).toBeDefined();
    expect(startTimes[2]).toBeDefined();
    expect(startTimes[3]).toBeDefined();
    // Each node starts after the previous stagger window
    expect(startTimes[2]).toBeGreaterThanOrEqual(startTimes[1] + 500);
    expect(startTimes[3]).toBeGreaterThanOrEqual(startTimes[1] + 1_000);
  });

  it('stops staggered traces mid-sweep when stop() is called', async () => {
    const traced: number[] = [];
    const stop = startNetworkDiscovery(
      (id) => {
        traced.push(id);
        return Promise.resolve();
      },
      () => [1, 2, 3],
      60_000,
      500,
    );

    // Let node 1 (index 0) trace, then stop before node 2's stagger fires
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(traced).toEqual([1]);
  });
});
