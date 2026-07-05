import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MC_RESP_ERR, MC_RESP_SENT } from './meshcoreRepeaterRpcCommon';
import { runMeshcoreRepeaterQueuedSend } from './meshcoreRepeaterRpcQueuedSend';
import { createMockMeshcoreConn } from './meshcoreTestHelpers';
import { createRepeaterRemoteRpcQueue } from './repeaterRemoteRpcQueue';
import { MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS } from './timeConstants';

describe('runMeshcoreRepeaterQueuedSend', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with estTimeout and expectedAckCrc after RESP_SENT', async () => {
    const conn = createMockMeshcoreConn();
    const runSerialized = createRepeaterRemoteRpcQueue();
    const beforeSend = vi.fn(async () => {});

    const promise = runMeshcoreRepeaterQueuedSend(
      conn,
      runSerialized,
      () => conn.sendToRadioFrame(new Uint8Array([1])),
      beforeSend,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(beforeSend).toHaveBeenCalledTimes(1);
    expect(conn.sentFrames.length).toBe(1);

    conn.emit(MC_RESP_SENT, { estTimeout: 250, expectedAckCrc: 0x1234 });
    await expect(promise).resolves.toEqual({
      estTimeoutMs: 250,
      expectedAckCrc: 0x1234,
    });
  });

  it('invokes onSentAck synchronously before the returned promise resolves', async () => {
    const conn = createMockMeshcoreConn();
    const runSerialized = createRepeaterRemoteRpcQueue();
    const ackOrder: string[] = [];

    const promise = runMeshcoreRepeaterQueuedSend(
      conn,
      runSerialized,
      () => conn.sendToRadioFrame(new Uint8Array([1])),
      undefined,
      () => {
        ackOrder.push('onSentAck');
      },
    );
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 100, expectedAckCrc: 1 });
    ackOrder.push('afterEmit');
    await promise;
    expect(ackOrder).toEqual(['onSentAck', 'afterEmit']);
  });

  it('rejects on RESP_ERR', async () => {
    const conn = createMockMeshcoreConn();
    const runSerialized = createRepeaterRemoteRpcQueue();

    const promise = runMeshcoreRepeaterQueuedSend(conn, runSerialized, () =>
      conn.sendToRadioFrame(new Uint8Array([1])),
    );
    await Promise.resolve();
    conn.emit(MC_RESP_ERR);
    await expect(promise).rejects.toThrow(/rejected request/i);
  });

  it('rejects when sendFrame throws', async () => {
    const conn = createMockMeshcoreConn();
    const runSerialized = createRepeaterRemoteRpcQueue();

    const promise = runMeshcoreRepeaterQueuedSend(conn, runSerialized, () =>
      Promise.reject(new Error('usb write failed')),
    );
    await Promise.resolve();
    await expect(promise).rejects.toThrow(/usb write failed/i);
  });

  it('rejects on SENT wait timeout', async () => {
    const conn = createMockMeshcoreConn();
    const runSerialized = createRepeaterRemoteRpcQueue();

    const promise = runMeshcoreRepeaterQueuedSend(conn, runSerialized, () =>
      conn.sendToRadioFrame(new Uint8Array([1])),
    );
    await Promise.resolve();
    vi.advanceTimersByTime(MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS);
    await expect(promise).rejects.toThrow(/timeout waiting for sent acknowledgment/i);
  });
});
