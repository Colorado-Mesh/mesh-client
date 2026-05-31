import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSendLoginFrame,
  MESHCORE_ROOM_LOGIN_ABORT_MESSAGE,
  type MeshcoreRoomLoginRpcConnection,
  runMeshcoreRoomLogin,
} from './meshcoreRoomLoginRpc';
import {
  computeRoomLoginExtraTimeoutMs,
  computeRoomLoginSentWaitMs,
  MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_DIRECT_MS,
  MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_MS,
  MESHCORE_ROOM_LOGIN_SENT_WAIT_DIRECT_MS,
  MESHCORE_ROOM_LOGIN_SENT_WAIT_MS,
} from './timeConstants';

const MC_RESP_ERR = 1;
const MC_RESP_SENT = 6;
const MC_PUSH_LOGIN_SUCCESS = 0x85;
const MC_PUSH_LOGIN_FAIL = 0x86;

function makePubKey(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  key[0] = seed & 0xff;
  key[1] = (seed >> 8) & 0xff;
  for (let i = 2; i < 32; i++) {
    key[i] = (seed + i) & 0xff;
  }
  return key;
}

function createMockConn(): MeshcoreRoomLoginRpcConnection & {
  emit(event: string | number, payload?: unknown): void;
  sentFrames: Uint8Array[];
} {
  const handlers = new Map<string | number, Set<(...args: unknown[]) => void>>();
  const onceHandlers = new Map<string | number, Set<(...args: unknown[]) => void>>();
  const sentFrames: Uint8Array[] = [];

  const conn: MeshcoreRoomLoginRpcConnection & {
    emit(event: string | number, payload?: unknown): void;
    sentFrames: Uint8Array[];
  } = {
    sentFrames,
    on(event, cb) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(cb);
    },
    off(event, cb) {
      handlers.get(event)?.delete(cb);
      onceHandlers.get(event)?.delete(cb);
    },
    once(event, cb) {
      let set = onceHandlers.get(event);
      if (!set) {
        set = new Set();
        onceHandlers.set(event, set);
      }
      set.add(cb);
    },
    sendToRadioFrame(data) {
      sentFrames.push(data);
      return Promise.resolve();
    },
    emit(event, payload) {
      for (const cb of onceHandlers.get(event) ?? []) {
        onceHandlers.get(event)?.delete(cb);
        cb(payload);
      }
      for (const cb of handlers.get(event) ?? []) {
        cb(payload);
      }
    },
  };

  return conn;
}

describe('buildSendLoginFrame', () => {
  it('encodes empty password as zero-length field (read-only ACL)', () => {
    const key = makePubKey(1);
    const frame = buildSendLoginFrame(key, '');
    expect(frame[0]).toBe(26);
    expect(frame.slice(1, 33)).toEqual(key);
    expect(frame.length).toBe(33);
  });

  it('encodes non-empty password as variable-length bytes', () => {
    const key = makePubKey(2);
    const frame = buildSendLoginFrame(key, 'hello');
    expect(Array.from(frame.slice(33))).toEqual(Array.from(new TextEncoder().encode('hello')));
  });
});

describe('computeRoomLoginExtraTimeoutMs', () => {
  it('uses shorter floor for direct (0-hop) rooms', () => {
    expect(computeRoomLoginExtraTimeoutMs(0)).toBe(MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_DIRECT_MS);
  });

  it('uses RF floor for nearby multi-hop rooms', () => {
    expect(computeRoomLoginExtraTimeoutMs(2)).toBe(MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_MS);
  });

  it('scales for distant rooms beyond the floor', () => {
    expect(computeRoomLoginExtraTimeoutMs(18)).toBe(48_000);
    expect(computeRoomLoginExtraTimeoutMs(18)).toBeGreaterThan(
      MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_MS,
    );
  });
});

describe('computeRoomLoginSentWaitMs', () => {
  it('uses BLE SENT wait by default', () => {
    expect(computeRoomLoginSentWaitMs()).toBe(MESHCORE_ROOM_LOGIN_SENT_WAIT_MS);
    expect(computeRoomLoginSentWaitMs('ble')).toBe(MESHCORE_ROOM_LOGIN_SENT_WAIT_MS);
  });

  it('uses shorter SENT wait for TCP and serial companion links', () => {
    expect(computeRoomLoginSentWaitMs('tcp')).toBe(MESHCORE_ROOM_LOGIN_SENT_WAIT_DIRECT_MS);
    expect(computeRoomLoginSentWaitMs('serial')).toBe(MESHCORE_ROOM_LOGIN_SENT_WAIT_DIRECT_MS);
  });
});

describe('runMeshcoreRoomLogin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('succeeds when wrong-prefix LoginSuccess arrives before the matching one', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(0xab);
    const wrongPrefix = makePubKey(0xcd).subarray(0, 6);

    const loginPromise = runMeshcoreRoomLogin(conn, pubKey, 'hello');

    await Promise.resolve();
    expect(conn.sentFrames.length).toBe(1);

    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: wrongPrefix, reserved: 0 });
    conn.emit(MC_RESP_SENT, { estTimeout: 1_000 });
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: pubKey.subarray(0, 6), reserved: 2 });

    await expect(loginPromise).resolves.toEqual({
      pubKeyPrefix: pubKey.subarray(0, 6),
      reserved: 2,
    });
  });

  it('rejects when Sent acknowledgment never arrives on TCP within direct wait', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(3);

    const loginPromise = runMeshcoreRoomLogin(conn, pubKey, 'hello', { companionTransport: 'tcp' });
    await Promise.resolve();

    const rejection = expect(loginPromise).rejects.toThrow(/acknowledgment/i);
    await vi.advanceTimersByTimeAsync(MESHCORE_ROOM_LOGIN_SENT_WAIT_DIRECT_MS);
    await rejection;
  });

  it('rejects when Sent acknowledgment never arrives on BLE within full wait', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(3);

    const loginPromise = runMeshcoreRoomLogin(conn, pubKey, 'hello', { companionTransport: 'ble' });
    await Promise.resolve();

    const rejection = expect(loginPromise).rejects.toThrow(/acknowledgment/i);
    await vi.advanceTimersByTimeAsync(MESHCORE_ROOM_LOGIN_SENT_WAIT_MS);
    await rejection;
  });

  it('rejects on response timeout after Sent for direct room', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(4);

    const loginPromise = runMeshcoreRoomLogin(conn, pubKey, 'hello', { hopsAway: 0 });
    await Promise.resolve();

    conn.emit(MC_RESP_SENT, { estTimeout: 2_000 });
    const rejection = expect(loginPromise).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(MESHCORE_ROOM_LOGIN_EXTRA_TIMEOUT_DIRECT_MS + 2_000);
    await rejection;
  });

  it('uses hop-scaled timeout for distant rooms', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(5);

    const loginPromise = runMeshcoreRoomLogin(conn, pubKey, 'hello', { hopsAway: 18 });
    await Promise.resolve();

    conn.emit(MC_RESP_SENT, { estTimeout: 0 });
    await vi.advanceTimersByTimeAsync(47_999);
    await Promise.resolve();

    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: pubKey.subarray(0, 6), reserved: 1 });
    await expect(loginPromise).resolves.toEqual({
      pubKeyPrefix: pubKey.subarray(0, 6),
      reserved: 1,
    });

    await vi.advanceTimersByTimeAsync(1);
  });

  it('rejects when abort signal fires', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(6);
    const controller = new AbortController();

    const loginPromise = runMeshcoreRoomLogin(conn, pubKey, 'hello', {
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(loginPromise).rejects.toMatchObject({
      message: MESHCORE_ROOM_LOGIN_ABORT_MESSAGE,
      name: 'AbortError',
    });
  });

  it('rejects when radio emits Err', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(7);

    const loginPromise = runMeshcoreRoomLogin(conn, pubKey, 'hello');
    await Promise.resolve();
    conn.emit(MC_RESP_ERR);

    await expect(loginPromise).rejects.toThrow(/rejected room login/i);
  });

  it('rejects immediately on matching LoginFail push', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(0xab);

    const loginPromise = runMeshcoreRoomLogin(conn, pubKey, 'hello');
    await Promise.resolve();

    conn.emit(MC_RESP_SENT, { estTimeout: 45_000 });
    conn.emit(MC_PUSH_LOGIN_FAIL, { pubKeyPrefix: pubKey.subarray(0, 6), reserved: 0 });

    await expect(loginPromise).rejects.toThrow(/wrong password or ACL denied/i);
  });

  it('ignores LoginFail with wrong pubkey prefix', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(0xab);
    const wrongPrefix = makePubKey(0xcd).subarray(0, 6);

    const loginPromise = runMeshcoreRoomLogin(conn, pubKey, 'hello', { hopsAway: 0 });
    await Promise.resolve();

    conn.emit(MC_RESP_SENT, { estTimeout: 1_000 });
    conn.emit(MC_PUSH_LOGIN_FAIL, { pubKeyPrefix: wrongPrefix, reserved: 0 });
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: pubKey.subarray(0, 6), reserved: 1 });

    await expect(loginPromise).resolves.toEqual({
      pubKeyPrefix: pubKey.subarray(0, 6),
      reserved: 1,
    });
  });
});
