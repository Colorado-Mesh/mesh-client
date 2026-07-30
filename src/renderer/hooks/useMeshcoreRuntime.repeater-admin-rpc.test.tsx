import { describe, expect, it, vi } from 'vitest';

import {
  meshcoreCompanionRepeaterRfBusy,
  resetMeshcoreRepeaterRpcInFlightForTests,
  runMeshcoreRepeaterRpcOnce,
} from '../lib/meshcoreRepeaterRpcInFlight';
import * as traceMultiplex from '../lib/meshcoreTracePathMultiplex';
import { awaitMeshcoreRepeaterPingSettleForNode } from '../lib/meshcoreTraceRadioIdle';

describe('repeater admin RPC sequencing', () => {
  it('ping wrapper blocks ping settle for the same node before admin RPC', async () => {
    resetMeshcoreRepeaterRpcInFlightForTests();
    let releaseTrace!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseTrace = resolve;
    });
    const tracePromise = runMeshcoreRepeaterRpcOnce('trace', 42, async () => {
      await gate;
      return 'ok';
    });
    await Promise.resolve();
    expect(meshcoreCompanionRepeaterRfBusy()).toBe(true);

    const settlePromise = awaitMeshcoreRepeaterPingSettleForNode(42, 500);
    let settled = false;
    void settlePromise
      .then(() => {
        settled = true;
      })
      .catch(() => {
        // catch-no-log-ok: settle may reject on timeout; test awaits settlePromise below
      });
    await new Promise((r) => setTimeout(r, 80));
    expect(settled).toBe(false);

    releaseTrace();
    await tracePromise;
    await settlePromise;
    expect(settled).toBe(true);
    expect(meshcoreCompanionRepeaterRfBusy()).toBe(false);
  });

  it('meshcoreCompanionRepeaterRfBusy reflects trace response wait', () => {
    resetMeshcoreRepeaterRpcInFlightForTests();
    vi.spyOn(traceMultiplex, 'meshcoreTraceResponsesInFlightCount').mockReturnValue(2);
    expect(meshcoreCompanionRepeaterRfBusy()).toBe(true);
  });
});
