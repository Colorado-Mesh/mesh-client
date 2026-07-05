import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runMeshcoreRepeaterBinaryRequest } from './meshcoreRepeaterBinaryRequestRpc';
import { MC_PUSH_BINARY_RESPONSE, MC_RESP_ERR, MC_RESP_SENT } from './meshcoreRepeaterRpcCommon';
import { createMockMeshcoreConn, makePubKey } from './meshcoreTestHelpers';
import { createRepeaterRemoteRpcQueue } from './repeaterRemoteRpcQueue';

describe('runMeshcoreRepeaterBinaryRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('releases the companion queue after SENT while waiting for BinaryResponse', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x55);
    const runSerialized = createRepeaterRemoteRpcQueue();
    const reqBytes = new Uint8Array([0x06, 0, 10, 0, 0, 0, 0, 0, 1, 6, 1, 2, 3, 4]);
    const responseData = new Uint8Array([0, 0, 0, 0]);

    const neighborsPromise = runMeshcoreRepeaterBinaryRequest(
      conn,
      pubKey,
      reqBytes,
      1000,
      runSerialized,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(conn.sentFrames.length).toBe(1);

    conn.emit(MC_RESP_SENT, { estTimeout: 100, expectedAckCrc: 0xabcd });
    await Promise.resolve();
    await Promise.resolve();

    let secondSendStarted = false;
    const secondSend = runSerialized(() => {
      secondSendStarted = true;
      return Promise.resolve();
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondSendStarted).toBe(true);

    conn.emit(MC_PUSH_BINARY_RESPONSE, { tag: 0xabcd, responseData });
    await expect(neighborsPromise).resolves.toEqual(responseData);
    await secondSend;
  });

  it('accepts BinaryResponse emitted synchronously with RESP_SENT', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x66);
    const runSerialized = createRepeaterRemoteRpcQueue();
    const reqBytes = new Uint8Array([0x06]);
    const responseData = new Uint8Array([1, 2, 3]);

    const promise = runMeshcoreRepeaterBinaryRequest(conn, pubKey, reqBytes, 1000, runSerialized);
    await Promise.resolve();
    expect(conn.sentFrames.length).toBe(1);

    conn.emit(MC_RESP_SENT, { estTimeout: 100, expectedAckCrc: 0xbeef });
    conn.emit(MC_PUSH_BINARY_RESPONSE, { tag: 0xbeef, responseData });

    await expect(promise).resolves.toEqual(responseData);
  });

  it('ignores BinaryResponse with mismatched tag', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x77);
    const runSerialized = createRepeaterRemoteRpcQueue();
    const reqBytes = new Uint8Array([0x06]);
    const responseData = new Uint8Array([9]);

    const promise = runMeshcoreRepeaterBinaryRequest(conn, pubKey, reqBytes, 500, runSerialized);
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 100, expectedAckCrc: 0x1111 });
    conn.emit(MC_PUSH_BINARY_RESPONSE, { tag: 0x2222, responseData });
    vi.advanceTimersByTime(600);
    await expect(promise).rejects.toThrow(/timeout/i);
  });

  it('rejects when expectedAckCrc is missing after SENT', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x88);
    const runSerialized = createRepeaterRemoteRpcQueue();

    const promise = runMeshcoreRepeaterBinaryRequest(
      conn,
      pubKey,
      new Uint8Array([0x06]),
      1000,
      runSerialized,
    );
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 100 });
    await expect(promise).rejects.toThrow(/missing expectedAckCrc/i);
  });

  it('rejects on Err after send', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(3);
    const runSerialized = createRepeaterRemoteRpcQueue();
    const reqBytes = new Uint8Array([0x06]);

    const promise = runMeshcoreRepeaterBinaryRequest(conn, pubKey, reqBytes, 1000, runSerialized);
    await Promise.resolve();
    conn.emit(MC_RESP_ERR);
    await expect(promise).rejects.toThrow(/rejected request/i);
  });
});
