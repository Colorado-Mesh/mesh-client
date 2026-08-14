import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { meshcorePathHashSizeFromTraceFlags } from '../../shared/meshcorePathHash';
import { meshcoreTraceHopDisplayRows } from './meshcorePathChainDisplay';
import {
  meshcoreTracePendingRouteCount,
  meshcoreTraceResponsesInFlightCount,
  resetMeshcoreTraceResponsesInFlightForTests,
  startMeshcoreTracePathMultiplexed,
  traceDataPayloadToResult,
} from './meshcoreTracePathMultiplex';
import { MC_RESP_ERR, MC_RESP_SENT } from './meshcoreWireCodes';
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
    sendCommandSendTracePath: vi.fn((...args: unknown[]) => {
      void args;
      return Promise.resolve();
    }),
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

  it('aligns hop display rows with decoded segments and hash size from flags', () => {
    // 1-byte hashes: 3 segments [relay, relay2, dest], 3 SNR hop bytes + lastSnr
    // node_ids chosen so meshcoreNodeHash(id) === path hash byte
    const relayId = 0xaa;
    const relay2Id = 0xbb;
    const destId = 0xcc;
    const result = traceDataPayloadToResult({
      pathLen: 3,
      flags: 0,
      pathHashes: [0xaa, 0xbb, 0xcc],
      pathSnrs: [40, 41, 42],
      lastSnr: 8.5,
      tag: 1,
    });
    expect(result.pathLen).toBe(3);
    expect(result.pathSnrs).toHaveLength(3);
    const hashSizeBytes = meshcorePathHashSizeFromTraceFlags(result.flags);
    expect(hashSizeBytes).toBe(1);

    const rows = meshcoreTraceHopDisplayRows({
      pathHashes: result.pathHashes,
      pathSnrs: result.pathSnrs,
      hashSizeBytes,
      destNodeId: destId,
      getNodeLabel: (id) =>
        id === relayId ? 'R1' : id === relay2Id ? 'R2' : id === destId ? 'Dest' : '?',
      candidates: [
        { node_id: relayId, last_heard: 1 },
        { node_id: relay2Id, last_heard: 1 },
        { node_id: destId, last_heard: 1 },
      ],
    });
    // Dest segment suppressed; two intermediate hops remain
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.label)).toEqual(['R1', 'R2']);
    expect(rows.map((r) => r.snr)).toEqual(result.pathSnrs.slice(0, 2));
  });
});

const MC_PUSH_TRACE_DATA = 0x89;

describe('startMeshcoreTracePathMultiplexed success', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMeshcoreTraceResponsesInFlightForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetMeshcoreTraceResponsesInFlightForTests();
  });

  it('resolves when TraceData arrives after RESP_SENT', async () => {
    const conn = createTraceConn();
    let capturedTag = 0;
    vi.mocked(conn.sendCommandSendTracePath).mockImplementation((...args: unknown[]) => {
      capturedTag = args[0] as number;
      return Promise.resolve();
    });
    const runSerialized = createRepeaterRemoteRpcQueue();
    const handle = startMeshcoreTracePathMultiplexed(
      conn,
      new Uint8Array([0xab]),
      1000,
      runSerialized,
    );
    await Promise.resolve();
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 200 });
    await Promise.resolve();
    expect(meshcoreTraceResponsesInFlightCount()).toBe(1);

    conn.emit(MC_PUSH_TRACE_DATA, {
      tag: capturedTag,
      pathLen: 2,
      flags: 0,
      pathHashes: [1, 2],
      pathSnrs: [40, 41],
      lastSnr: 5,
    });
    const result = await handle.promise;
    expect(result.pathLen).toBe(2);
    expect(result.pathLenByte).toBe(2);
    expect(meshcoreTraceResponsesInFlightCount()).toBe(0);
  });

  it('rejects on RESP_ERR during send', async () => {
    const conn = createTraceConn();
    const runSerialized = createRepeaterRemoteRpcQueue();
    const handle = startMeshcoreTracePathMultiplexed(
      conn,
      new Uint8Array([0xcd]),
      1000,
      runSerialized,
    );
    await Promise.resolve();
    conn.emit(MC_RESP_ERR);
    await expect(handle.promise).rejects.toThrow(/rejected trace/i);
  });
  it('does not SendTracePath while a prior TraceData is still in flight', async () => {
    const conn = createTraceConn();
    const runSerialized = createRepeaterRemoteRpcQueue();
    let firstTag = 0;
    let secondSendCount = 0;
    vi.mocked(conn.sendCommandSendTracePath).mockImplementation((...args: unknown[]) => {
      if (firstTag === 0) firstTag = args[0] as number;
      else secondSendCount += 1;
      return Promise.resolve();
    });

    const first = startMeshcoreTracePathMultiplexed(
      conn,
      new Uint8Array([0x11]),
      1000,
      runSerialized,
    );
    await Promise.resolve();
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 500 });
    await Promise.resolve();
    expect(meshcoreTraceResponsesInFlightCount()).toBe(1);

    const second = startMeshcoreTracePathMultiplexed(
      conn,
      new Uint8Array([0x22]),
      1000,
      runSerialized,
    );
    await Promise.resolve();
    await Promise.resolve();
    // Still awaiting first TraceData — second must not have sent yet.
    expect(secondSendCount).toBe(0);

    conn.emit(MC_PUSH_TRACE_DATA, {
      tag: firstTag,
      pathLen: 1,
      flags: 0,
      pathHashes: [0x11],
      pathSnrs: [40],
      lastSnr: 5,
    });
    await first.promise;
    await vi.advanceTimersByTimeAsync(60);
    await Promise.resolve();
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 200 });
    await Promise.resolve();
    expect(secondSendCount).toBe(1);
    second.cancel('test cleanup');
    await expect(second.promise).rejects.toThrow(/test cleanup/);
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
