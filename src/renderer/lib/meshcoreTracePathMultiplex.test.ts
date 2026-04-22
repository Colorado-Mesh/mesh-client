import { describe, expect, it, vi } from 'vitest';

import {
  type MeshcoreTracePathMuxConnection,
  runMeshcoreTracePathMultiplexed,
} from './meshcoreTracePathMultiplex';
import { createRepeaterRemoteRpcQueue } from './repeaterRemoteRpcQueue';
import { MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS } from './timeConstants';

const MC_RESP_ERR = 1;
const MC_RESP_SENT = 6;
const MC_PUSH_TRACE_DATA = 0x89;

function buildConn() {
  const persistent = new Map<string | number, Set<(...args: unknown[]) => void>>();
  const onceOnly = new Map<string | number, Set<(...args: unknown[]) => void>>();

  const on = (ev: string | number, cb: (...args: unknown[]) => void) => {
    let s = persistent.get(ev);
    if (!s) {
      s = new Set();
      persistent.set(ev, s);
    }
    s.add(cb);
  };
  const off = (ev: string | number, cb: (...args: unknown[]) => void) => {
    persistent.get(ev)?.delete(cb);
  };
  const once = (ev: string | number, cb: (...args: unknown[]) => void) => {
    let s = onceOnly.get(ev);
    if (!s) {
      s = new Set();
      onceOnly.set(ev, s);
    }
    s.add(cb);
  };
  const emit = (ev: string | number, ...args: unknown[]) => {
    const o = onceOnly.get(ev);
    if (o) {
      for (const cb of [...o]) {
        o.delete(cb);
        cb(...args);
      }
    }
    const p = persistent.get(ev);
    if (p) for (const cb of p) cb(...args);
  };

  const sentTags: number[] = [];
  const conn: MeshcoreTracePathMuxConnection = {
    on,
    off,
    once,
    sendCommandSendTracePath(tag: number) {
      sentTags.push(tag >>> 0);
      return Promise.resolve();
    },
  };

  return {
    conn,
    sentTags,
    emit,
    emitSent(estTimeout = 10_000) {
      emit(MC_RESP_SENT, { estTimeout });
    },
    emitErr() {
      emit(MC_RESP_ERR, {});
    },
    emitTraceData(tag: number) {
      emit(MC_PUSH_TRACE_DATA, {
        reserved: 0,
        pathLen: 1,
        flags: 0,
        tag,
        authCode: 0,
        pathHashes: new Uint8Array([1]),
        pathSnrs: new Uint8Array([8]),
        lastSnr: 2,
      });
    },
    emitTraceDataNumberArrays(tag: number) {
      emit(MC_PUSH_TRACE_DATA, {
        reserved: 0,
        pathLen: 2,
        flags: 0,
        tag,
        authCode: 0,
        pathHashes: [10, 20],
        pathSnrs: [4, 5, 20],
        lastSnr: 5,
      });
    },
  };
}

describe('runMeshcoreTracePathMultiplexed', () => {
  it('resolves when TraceData tag matches pending trace', async () => {
    const { conn, emitSent, emitTraceData, sentTags } = buildConn();
    const runSerialized = createRepeaterRemoteRpcQueue();

    const p = runMeshcoreTracePathMultiplexed(conn, new Uint8Array([1, 2, 3]), 0, runSerialized);
    await Promise.resolve();
    emitSent(5000);
    await Promise.resolve();
    expect(sentTags).toHaveLength(1);
    emitTraceData(sentTags[0]);

    await expect(p).resolves.toMatchObject({
      pathLen: 1,
      tag: sentTags[0],
      lastSnr: 2,
    });
  });

  it('resolves when pathHashes/pathSnrs are number[] (remote trace shape)', async () => {
    const { conn, emitSent, emitTraceDataNumberArrays, sentTags } = buildConn();
    const runSerialized = createRepeaterRemoteRpcQueue();

    const p = runMeshcoreTracePathMultiplexed(conn, new Uint8Array([1, 2, 3]), 0, runSerialized);
    await Promise.resolve();
    emitSent(5000);
    await Promise.resolve();
    emitTraceDataNumberArrays(sentTags[0]);

    await expect(p).resolves.toMatchObject({
      pathLen: 2,
      pathHashes: [10, 20],
      pathSnrs: [4, 5],
      lastSnr: 5,
      tag: sentTags[0],
    });
  });

  it('rejects when RESP_CODE_SENT never arrives (sent-wait timeout unblocks queue)', async () => {
    vi.useFakeTimers();
    try {
      const { conn } = buildConn();
      const runSerialized = createRepeaterRemoteRpcQueue();
      const p = runMeshcoreTracePathMultiplexed(conn, new Uint8Array([1]), 0, runSerialized);
      await Promise.resolve();
      const expectation = expect(p).rejects.toThrow(/timeout waiting for trace acknowledgment/);
      await vi.advanceTimersByTimeAsync(MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves two overlapping traces by tag (send serialized, TraceData concurrent)', async () => {
    const { conn, emitSent, emitTraceData, sentTags } = buildConn();
    const runSerialized = createRepeaterRemoteRpcQueue();

    const p1 = runMeshcoreTracePathMultiplexed(conn, new Uint8Array([1]), 0, runSerialized);
    const p2 = runMeshcoreTracePathMultiplexed(conn, new Uint8Array([2]), 0, runSerialized);
    await Promise.resolve();
    expect(sentTags).toHaveLength(1);
    emitSent(5000);
    await new Promise<void>((r) => {
      setTimeout(r, 0);
    });
    expect(sentTags).toHaveLength(2);
    const [t1, t2] = sentTags;
    expect(t1).not.toBe(t2);

    emitSent(5000);
    await Promise.resolve();

    emitTraceData(t2);
    emitTraceData(t1);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.tag).toBe(t1);
    expect(r2.tag).toBe(t2);
  });

  it('resolves when pathHashes/pathSnrs are array-like objects (Buffer-shaped)', async () => {
    const { conn, emit, emitSent, sentTags } = buildConn();
    const runSerialized = createRepeaterRemoteRpcQueue();

    const p = runMeshcoreTracePathMultiplexed(conn, new Uint8Array([1, 2, 3]), 0, runSerialized);
    await Promise.resolve();
    emitSent(5000);
    await Promise.resolve();

    // array-like: not Array, not Uint8Array, but has numeric indices + length (like SmartBuffer result)
    const arrayLike = (vals: number[]): ArrayLike<number> =>
      Object.assign(Object.create(null) as object, {
        ...Object.fromEntries(vals.entries()),
        length: vals.length,
      });

    emit(MC_PUSH_TRACE_DATA, {
      pathLen: 2,
      tag: sentTags[0],
      pathHashes: arrayLike([10, 20]),
      pathSnrs: arrayLike([4, 5, 20]),
      lastSnr: 5,
    });

    await expect(p).resolves.toMatchObject({
      pathLen: 2,
      pathHashes: [10, 20],
      pathSnrs: [4, 5],
      lastSnr: 5,
    });
  });
});
