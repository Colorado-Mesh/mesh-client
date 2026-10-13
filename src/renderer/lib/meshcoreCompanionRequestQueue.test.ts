import { afterEach, describe, expect, it, vi } from 'vitest';

import { runMeshcoreCompanionRequest } from './meshcoreCompanionRequestQueue';
import { runMeshcoreRepeaterBinaryRequest } from './meshcoreRepeaterBinaryRequestRpc';
import { runMeshcoreRepeaterLogin } from './meshcoreRepeaterLoginRpc';
import {
  MC_PUSH_BINARY_RESPONSE,
  MC_PUSH_LOGIN_SUCCESS,
  MC_PUSH_STATUS_RESPONSE,
  MC_PUSH_TELEMETRY_RESPONSE,
  MC_RESP_ERR,
  MC_RESP_SENT,
} from './meshcoreRepeaterRpcCommon';
import { runMeshcoreRepeaterStatusRequest } from './meshcoreRepeaterStatusRpc';
import { runMeshcoreRepeaterTelemetryRequest } from './meshcoreRepeaterTelemetryRpc';
import { MESHCORE_ROOM_LOGIN_ABORT_MESSAGE, runMeshcoreRoomLogin } from './meshcoreRoomLoginRpc';
import { createMockMeshcoreConn, makePubKey } from './meshcoreTestHelpers';
import { createRepeaterRemoteRpcQueue } from './repeaterRemoteRpcQueue';
import { MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS } from './timeConstants';

describe('companion remote request ownership', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['linux', 'darwin', 'win32'])(
    'keeps another node Status from replacing a pending admin login (%s)',
    async () => {
      vi.useFakeTimers();
      const conn = createMockMeshcoreConn();
      const runSerialized = createRepeaterRemoteRpcQueue();
      const pubKey = makePubKey(1);
      const login = runMeshcoreRepeaterLogin(conn, pubKey, 'secret', 1000, runSerialized);
      await vi.advanceTimersByTimeAsync(0);
      conn.emit(MC_RESP_SENT, { estTimeout: 100 });
      await vi.advanceTimersByTimeAsync(0);

      const status = runMeshcoreRepeaterStatusRequest(conn, makePubKey(2), 1000, runSerialized);
      void status.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      // Companion firmware calls clearPendingReqs() on Status, losing pending_login.
      expect(conn.sentFrames.map((frame) => frame[0])).toEqual([26]);

      conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: pubKey.subarray(0, 6), permissions: 1 });
      await login;
      await vi.advanceTimersByTimeAsync(0);
      expect(conn.sentFrames.map((frame) => frame[0])).toEqual([26, 27]);
      conn.emit(MC_RESP_SENT, { estTimeout: 0 });
      const rejected = expect(status).rejects.toThrow('timeout');
      await vi.advanceTimersByTimeAsync(1000);
      await rejected;
    },
  );

  it.each(['status', 'telemetry', 'binary', 'room login'])(
    'holds the request slot until %s completes, before starting admin login',
    async (kind) => {
      vi.useFakeTimers();
      const conn = createMockMeshcoreConn();
      const runSerialized = createRepeaterRemoteRpcQueue();
      const pubKey = makePubKey(1);
      const first =
        kind === 'status'
          ? runMeshcoreRepeaterStatusRequest(conn, pubKey, 1000, runSerialized)
          : kind === 'telemetry'
            ? runMeshcoreRepeaterTelemetryRequest(conn, pubKey, 1000, runSerialized)
            : kind === 'binary'
              ? runMeshcoreRepeaterBinaryRequest(
                  conn,
                  pubKey,
                  new Uint8Array([6]),
                  1000,
                  runSerialized,
                )
              : runMeshcoreRoomLogin(conn, pubKey, 'hello', { hopsAway: 0 });
      await vi.advanceTimersByTimeAsync(0);
      conn.emit(MC_RESP_SENT, { estTimeout: 100, expectedAckCrc: 123 });
      await vi.advanceTimersByTimeAsync(0);

      const nextKey = makePubKey(2);
      const login = runMeshcoreRepeaterLogin(conn, nextKey, 'secret', 1000, runSerialized);
      await vi.advanceTimersByTimeAsync(0);
      expect(conn.sentFrames).toHaveLength(1);

      const event =
        kind === 'status'
          ? MC_PUSH_STATUS_RESPONSE
          : kind === 'telemetry'
            ? MC_PUSH_TELEMETRY_RESPONSE
            : kind === 'binary'
              ? MC_PUSH_BINARY_RESPONSE
              : MC_PUSH_LOGIN_SUCCESS;
      conn.emit(event, {
        pubKeyPrefix: pubKey.subarray(0, 6),
        statusData: new Uint8Array(48),
        lppSensorData: new Uint8Array(),
        tag: 123,
        responseData: new Uint8Array(),
      });
      await first;
      await vi.advanceTimersByTimeAsync(0);
      expect(conn.sentFrames).toHaveLength(2);
      conn.emit(MC_RESP_SENT, { estTimeout: 100 });
      conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: nextKey.subarray(0, 6), permissions: 1 });
      await login;
    },
  );

  it.each(['timeout', 'radio error', 'send error'])(
    'starts the next remote request after a %s',
    async (failure) => {
      vi.useFakeTimers();
      const conn = createMockMeshcoreConn();
      const runSerialized = createRepeaterRemoteRpcQueue();
      if (failure === 'send error') {
        vi.spyOn(conn, 'sendToRadioFrame').mockRejectedValueOnce(new Error('link lost'));
      }
      const first = runMeshcoreRepeaterLogin(conn, makePubKey(1), 'secret', 1000, runSerialized);
      const rejected = expect(first).rejects.toThrow();
      const nextKey = makePubKey(2);
      const next = runMeshcoreRepeaterLogin(conn, nextKey, 'secret', 1000, runSerialized);
      await vi.advanceTimersByTimeAsync(0);
      if (failure === 'timeout') {
        conn.emit(MC_RESP_SENT, { estTimeout: 0 });
        await vi.advanceTimersByTimeAsync(1000);
      } else if (failure === 'radio error') {
        conn.emit(MC_RESP_ERR, { errCode: 2 });
      }
      await rejected;
      await vi.advanceTimersByTimeAsync(0);
      expect(conn.sentFrames.at(-1)?.slice(1, 33)).toEqual(nextKey);
      conn.emit(MC_RESP_SENT, { estTimeout: 100 });
      conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: nextKey.subarray(0, 6) });
      await next;
    },
  );

  it('cancels queued Room login immediately without sending or consuming the active reply', async () => {
    vi.useFakeTimers();
    const conn = createMockMeshcoreConn();
    const key = makePubKey(1);
    const active = runMeshcoreRepeaterLogin(conn, key, 'secret', 1000);
    conn.emit(MC_RESP_SENT, { estTimeout: 100 });
    const controller = new AbortController();
    const queued = runMeshcoreRoomLogin(conn, makePubKey(2), 'hello', {
      signal: controller.signal,
    });
    controller.abort();
    await expect(queued).rejects.toMatchObject({
      name: 'AbortError',
      message: MESHCORE_ROOM_LOGIN_ABORT_MESSAGE,
    });
    expect(conn.sentFrames).toHaveLength(1);
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: key.subarray(0, 6) });
    await active;
    await vi.advanceTimersByTimeAsync(0);
    expect(conn.sentFrames).toHaveLength(1);
    const nextKey = makePubKey(3);
    const next = runMeshcoreRepeaterLogin(conn, nextKey, 'secret', 1000);
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: nextKey.subarray(0, 6) });
    await next;
  });

  it('does not hold SENT-only work while waiting for a remote reply', async () => {
    vi.useFakeTimers();
    const conn = createMockMeshcoreConn();
    const runSerialized = createRepeaterRemoteRpcQueue();
    const key = makePubKey(1);
    const active = runMeshcoreRepeaterLogin(conn, key, 'secret', 1000, runSerialized);
    await vi.advanceTimersByTimeAsync(0);
    conn.emit(MC_RESP_SENT, { estTimeout: 100 });
    await vi.advanceTimersByTimeAsync(0);
    const cliSend = vi.fn().mockResolvedValue(undefined);
    await runSerialized(cliSend);
    expect(cliSend).toHaveBeenCalledOnce();
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: key.subarray(0, 6) });
    await active;
  });

  it('gives a replacement companion connection its own request slot', async () => {
    const oldConn = createMockMeshcoreConn();
    const newConn = createMockMeshcoreConn();
    const key = makePubKey(1);
    const oldRequest = runMeshcoreRepeaterLogin(oldConn, key, 'secret');
    const newRequest = runMeshcoreRepeaterLogin(newConn, key, 'secret');
    expect(oldConn.sentFrames).toHaveLength(1);
    expect(newConn.sentFrames).toHaveLength(1);
    for (const conn of [oldConn, newConn]) {
      conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: key.subarray(0, 6) });
    }
    await Promise.all([oldRequest, newRequest]);
  });

  it('releases the request slot when a companion never acknowledges an unqueued send', async () => {
    vi.useFakeTimers();
    const conn = createMockMeshcoreConn();
    const first = runMeshcoreRepeaterLogin(conn, makePubKey(1), 'secret');
    const rejected = expect(first).rejects.toThrow('timeout waiting for sent acknowledgment');
    const nextKey = makePubKey(2);
    const next = runMeshcoreRepeaterLogin(conn, nextKey, 'secret');
    expect(conn.sentFrames).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(MESHCORE_TRACE_SENT_WAIT_TIMEOUT_MS);
    await rejected;
    expect(conn.sentFrames).toHaveLength(2);
    conn.emit(MC_RESP_SENT, { estTimeout: 100 });
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: nextKey.subarray(0, 6) });
    await next;
  });

  it('releases the request slot when setup throws synchronously', async () => {
    const conn = createMockMeshcoreConn();
    const first = runMeshcoreCompanionRequest(conn, () => {
      throw new Error('setup failed');
    });
    const second = runMeshcoreCompanionRequest(conn, () => Promise.resolve('next'));
    await expect(first).rejects.toThrow('setup failed');
    await expect(second).resolves.toBe('next');
  });
});
