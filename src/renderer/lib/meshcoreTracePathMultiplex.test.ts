import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  meshcoreTracePendingRouteCount,
  meshcoreTraceResponsesInFlightCount,
  resetMeshcoreTraceResponsesInFlightForTests,
  startMeshcoreTracePathMultiplexed,
  traceDataPayloadToResult,
} from './meshcoreTracePathMultiplex';
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

describe('meshcoreTracePathMultiplex multibyte', () => {
  it('decodes 2-byte trace payload (10 hash bytes, 6 SNR bytes)', () => {
    const pathHashes = Array.from({ length: 10 }, (_, i) => i + 1);
    const pathSnrs = [40, 41, 42, 43, 44, 45];
    const result = traceDataPayloadToResult({
      pathLen: 10,
      flags: 1,
      pathHashes,
      pathSnrs,
      lastSnr: 11.25,
      tag: 0x1234,
    });
    expect(result.pathLen).toBe(5);
    expect(result.pathLenByte).toBe(10);
    expect(result.pathHashes).toHaveLength(10);
    expect(result.pathSnrs).toHaveLength(5);
    expect(result.lastSnr).toBe(11.25);
  });
});

describe('startMeshcoreTracePathMultiplexed cancel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMeshcoreTraceResponsesInFlightForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetMeshcoreTraceResponsesInFlightForTests();
  });

  it('releases pending route counters when cancelled before TraceData', async () => {
    const conn = createTraceConn();
    const runSerialized = createRepeaterRemoteRpcQueue();
    const handle = startMeshcoreTracePathMultiplexed(
      conn,
      new Uint8Array([0xab]),
      1000,
      runSerialized,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(meshcoreTracePendingRouteCount()).toBe(1);

    conn.emit(MC_RESP_SENT, { estTimeout: 500 });
    await Promise.resolve();
    expect(meshcoreTraceResponsesInFlightCount()).toBe(1);

    handle.cancel('outer timeout');
    await expect(handle.promise).rejects.toThrow(/outer timeout/i);
    expect(meshcoreTracePendingRouteCount()).toBe(0);
    expect(meshcoreTraceResponsesInFlightCount()).toBe(0);
  });
});
