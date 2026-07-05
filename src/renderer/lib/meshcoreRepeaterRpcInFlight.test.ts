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
});
