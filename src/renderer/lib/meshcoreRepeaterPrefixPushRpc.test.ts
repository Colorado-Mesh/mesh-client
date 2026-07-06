import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runMeshcoreRepeaterPrefixPushRequest } from './meshcoreRepeaterPrefixPushRpc';
import { MC_PUSH_STATUS_RESPONSE, MC_RESP_ERR, MC_RESP_SENT } from './meshcoreRepeaterRpcCommon';
import { createMockMeshcoreConn, makePubKey } from './meshcoreTestHelpers';

describe('runMeshcoreRepeaterPrefixPushRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when prefix-matched push arrives after RESP_SENT', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0xab);
    const statusData = new Uint8Array([1, 2, 3]);

    const promise = runMeshcoreRepeaterPrefixPushRequest({
      conn,
      contactPublicKey: pubKey,
      extraTimeoutMs: 1000,
      pushEvent: MC_PUSH_STATUS_RESPONSE,
      logTag: 'testPrefixPush',
      buildFrame: () => new Uint8Array([0]),
      parseMatchedPush: (response) => response,
      rejectSentMessage: 'send failed',
      rejectFailureMessage: 'rpc failed',
    });
    await Promise.resolve();

    conn.emit(MC_RESP_SENT, { estTimeout: 500 });
    conn.emit(MC_PUSH_STATUS_RESPONSE, {
      pubKeyPrefix: pubKey.subarray(0, 6),
      statusData,
    });

    await expect(promise).resolves.toMatchObject({ statusData });
  });

  it('ignores push events with wrong prefix', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0xab);
    const wrongPrefix = makePubKey(0xcd).subarray(0, 6);

    const promise = runMeshcoreRepeaterPrefixPushRequest({
      conn,
      contactPublicKey: pubKey,
      extraTimeoutMs: 1000,
      pushEvent: MC_PUSH_STATUS_RESPONSE,
      logTag: 'testPrefixPush',
      buildFrame: () => new Uint8Array([0]),
      parseMatchedPush: (response) => response,
      rejectSentMessage: 'send failed',
      rejectFailureMessage: 'rpc failed',
    });
    await Promise.resolve();

    conn.emit(MC_RESP_SENT, { estTimeout: 500 });
    conn.emit(MC_PUSH_STATUS_RESPONSE, { pubKeyPrefix: wrongPrefix, statusData: new Uint8Array() });
    conn.emit(MC_PUSH_STATUS_RESPONSE, {
      pubKeyPrefix: pubKey.subarray(0, 6),
      statusData: new Uint8Array([9]),
    });

    await expect(promise).resolves.toMatchObject({ statusData: new Uint8Array([9]) });
  });

  it('rejects on RESP_ERR', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0xef);

    const promise = runMeshcoreRepeaterPrefixPushRequest({
      conn,
      contactPublicKey: pubKey,
      extraTimeoutMs: 1000,
      pushEvent: MC_PUSH_STATUS_RESPONSE,
      logTag: 'testPrefixPush',
      buildFrame: () => new Uint8Array([0]),
      parseMatchedPush: (response) => response,
      rejectSentMessage: 'send failed',
      rejectFailureMessage: 'rpc failed',
    });
    await Promise.resolve();
    conn.emit(MC_RESP_ERR, {});

    await expect(promise).rejects.toThrow('send failed');
  });

  it('rejects on timeout', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x12);

    const promise = runMeshcoreRepeaterPrefixPushRequest({
      conn,
      contactPublicKey: pubKey,
      extraTimeoutMs: 100,
      pushEvent: MC_PUSH_STATUS_RESPONSE,
      logTag: 'testPrefixPush',
      buildFrame: () => new Uint8Array([0]),
      parseMatchedPush: (response) => response,
      rejectSentMessage: 'send failed',
      rejectFailureMessage: 'rpc failed',
    });
    await Promise.resolve();
    conn.emit(MC_RESP_SENT, { estTimeout: 50 });
    vi.advanceTimersByTime(200);

    await expect(promise).rejects.toThrow(/^timeout$/i);
  });

  it('does not arm orphan timeout after serialized send resolves early', async () => {
    const conn = createMockMeshcoreConn();
    const pubKey = makePubKey(0x33);

    const promise = runMeshcoreRepeaterPrefixPushRequest({
      conn,
      contactPublicKey: pubKey,
      extraTimeoutMs: 5000,
      runSerialized: async (fn) => {
        const pending = fn();
        await Promise.resolve();
        conn.emit(MC_PUSH_STATUS_RESPONSE, {
          pubKeyPrefix: pubKey.subarray(0, 6),
          statusData: new Uint8Array([7]),
        });
        conn.emit(MC_RESP_SENT, { estTimeout: 1000 });
        return pending;
      },
      pushEvent: MC_PUSH_STATUS_RESPONSE,
      logTag: 'testPrefixPush',
      buildFrame: () => new Uint8Array([0]),
      parseMatchedPush: (response) => response,
      rejectSentMessage: 'send failed',
      rejectFailureMessage: 'rpc failed',
    });

    await expect(promise).resolves.toMatchObject({ statusData: new Uint8Array([7]) });
    vi.advanceTimersByTime(10_000);
    expect(vi.getTimerCount()).toBe(0);
  });
});
