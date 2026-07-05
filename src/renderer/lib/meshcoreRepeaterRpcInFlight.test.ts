import { describe, expect, it, vi } from 'vitest';

import {
  resetMeshcoreRepeaterRpcInFlightForTests,
  runMeshcoreRepeaterRpcOnce,
} from './meshcoreRepeaterRpcInFlight';

describe('runMeshcoreRepeaterRpcOnce', () => {
  it('returns the same promise for duplicate neighbors requests on one node', async () => {
    resetMeshcoreRepeaterRpcInFlightForTests();
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'ok';
    });
    const first = runMeshcoreRepeaterRpcOnce('neighbors', 42, fn);
    const second = runMeshcoreRepeaterRpcOnce('neighbors', 42, fn);
    expect(second).toBe(first);
    await expect(first).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('allows parallel requests for different nodes', async () => {
    resetMeshcoreRepeaterRpcInFlightForTests();
    const fnA = vi.fn(() => Promise.resolve('a'));
    const fnB = vi.fn(() => Promise.resolve('b'));
    await Promise.all([
      runMeshcoreRepeaterRpcOnce('telemetry', 1, fnA),
      runMeshcoreRepeaterRpcOnce('telemetry', 2, fnB),
    ]);
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('returns the same promise for duplicate trace requests on one node', async () => {
    resetMeshcoreRepeaterRpcInFlightForTests();
    const fn = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'trace-ok';
    });
    const first = runMeshcoreRepeaterRpcOnce('trace', 42, fn);
    const second = runMeshcoreRepeaterRpcOnce('trace', 42, fn);
    expect(second).toBe(first);
    await expect(first).resolves.toBe('trace-ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('queues concurrent trace requests for different nodes on the radio', async () => {
    resetMeshcoreRepeaterRpcInFlightForTests();
    const order: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    const fn1 = vi.fn(async () => {
      order.push(1);
      await firstGate;
      return 'trace-1';
    });
    const fn2 = vi.fn(() => {
      order.push(2);
      return Promise.resolve('trace-2');
    });
    const first = runMeshcoreRepeaterRpcOnce('trace', 1, fn1);
    const second = runMeshcoreRepeaterRpcOnce('trace', 2, fn2);
    expect(second).not.toBe(first);
    await Promise.resolve();
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).not.toHaveBeenCalled();
    releaseFirst();
    await expect(first).resolves.toBe('trace-1');
    await expect(second).resolves.toBe('trace-2');
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(order).toEqual([1, 2]);
  });
});
