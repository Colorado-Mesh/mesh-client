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
