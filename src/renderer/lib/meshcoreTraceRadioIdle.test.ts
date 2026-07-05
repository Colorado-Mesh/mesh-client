import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  meshcoreRepeaterTraceActiveForNode,
  resetMeshcoreRepeaterRpcInFlightForTests,
  runMeshcoreRepeaterRpcOnce,
} from './meshcoreRepeaterRpcInFlight';
import {
  meshcoreTracePendingRouteCount,
  meshcoreTraceResponsesInFlightCount,
  resetMeshcoreTraceResponsesInFlightForTests,
  startMeshcoreTracePathMultiplexed,
} from './meshcoreTracePathMultiplex';
import {
  awaitMeshcoreRepeaterAdminRfIdle,
  awaitMeshcoreRepeaterPingSettleForNode,
  awaitMeshcoreTraceRadioIdle,
} from './meshcoreTraceRadioIdle';
import { MC_RESP_SENT } from './meshcoreWireCodes';
import { createRepeaterRemoteRpcQueue } from './repeaterRemoteRpcQueue';

function createTraceConn() {
  const handlers = new Map<string | number, Set<(...args: unknown[]) => void>>();
  return {
    on(event: string | number, cb: (...args: unknown[]) => void) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(cb);
    },
    off(event: string | number, cb: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(cb);
    },
    once(event: string | number, cb: (...args: unknown[]) => void) {
      const wrapper = (...args: unknown[]) => {
        handlers.get(event)?.delete(wrapper);
        cb(...args);
      };
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(wrapper);
    },
    emit(event: string | number, payload?: unknown) {
      handlers.get(event)?.forEach((cb) => {
        cb(payload);
      });
    },
    sendToRadioFrame: vi.fn(async () => {}),
    sendCommandSendTracePath: vi.fn(async () => {}),
  };
}

describe('awaitMeshcoreTraceRadioIdle', () => {
  it('resolves immediately when no trace is awaiting TraceData', async () => {
    resetMeshcoreTraceResponsesInFlightForTests();
    await expect(awaitMeshcoreTraceRadioIdle(100)).resolves.toBeUndefined();
  });
});

describe('awaitMeshcoreRepeaterAdminRfIdle (0-hop known-good: traceResponses only)', () => {
  beforeEach(() => {
    resetMeshcoreTraceResponsesInFlightForTests();
  });
  afterEach(() => {
    resetMeshcoreTraceResponsesInFlightForTests();
  });

  it('does not block on pre-SENT trace registration (pendingRoutes without TraceData)', async () => {
    const conn = createTraceConn();
    const runSerialized = createRepeaterRemoteRpcQueue();
    const handle = startMeshcoreTracePathMultiplexed(
      conn,
      new Uint8Array([0xab]),
      1000,
      runSerialized,
    );
    await Promise.resolve();
    expect(meshcoreTracePendingRouteCount()).toBe(1);
    expect(meshcoreTraceResponsesInFlightCount()).toBe(0);

    await expect(awaitMeshcoreRepeaterAdminRfIdle(50)).resolves.toBeUndefined();
    handle.cancel('test cleanup');
    await handle.promise.catch(() => {});
  });

  it('waits while TraceData is in flight after SENT', async () => {
    const conn = createTraceConn();
    const runSerialized = createRepeaterRemoteRpcQueue();
    const handle = startMeshcoreTracePathMultiplexed(
      conn,
      new Uint8Array([0xcd]),
      1000,
      runSerialized,
    );
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 500 });
    await Promise.resolve();
    expect(meshcoreTraceResponsesInFlightCount()).toBe(1);

    let settled = false;
    const idlePromise = awaitMeshcoreRepeaterAdminRfIdle(1000).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    handle.cancel('test cleanup');
    await handle.promise.catch(() => {});
    await idlePromise;
    expect(settled).toBe(true);
    expect(meshcoreTraceResponsesInFlightCount()).toBe(0);
  });
});

describe('awaitMeshcoreRepeaterPingSettleForNode (0-hop known-good)', () => {
  beforeEach(() => {
    resetMeshcoreRepeaterRpcInFlightForTests();
  });
  afterEach(() => {
    resetMeshcoreRepeaterRpcInFlightForTests();
  });

  it('resolves immediately when no ping RPC is active for the node', async () => {
    await expect(awaitMeshcoreRepeaterPingSettleForNode(42, 100)).resolves.toBeUndefined();
    expect(meshcoreRepeaterTraceActiveForNode(42)).toBe(false);
  });

  it('blocks until the same-node trace RPC wrapper finishes', async () => {
    let releaseTrace!: () => void;
    const traceGate = new Promise<void>((r) => {
      releaseTrace = r;
    });
    const tracePromise = runMeshcoreRepeaterRpcOnce('trace', 7, async () => {
      await traceGate;
      return 'done';
    });
    await Promise.resolve();
    expect(meshcoreRepeaterTraceActiveForNode(7)).toBe(true);

    let settled = false;
    const settlePromise = awaitMeshcoreRepeaterPingSettleForNode(7, 1000).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    releaseTrace();
    await tracePromise;
    await settlePromise;
    expect(settled).toBe(true);
    expect(meshcoreRepeaterTraceActiveForNode(7)).toBe(false);
  });
});
