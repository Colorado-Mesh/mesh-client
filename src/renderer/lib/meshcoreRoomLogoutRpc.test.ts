import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildSendLogoutFrame,
  type MeshcoreRoomLogoutRpcConnection,
  runMeshcoreRoomLogout,
} from './meshcoreRoomLogoutRpc';
import {
  MESHCORE_ROOM_LOGIN_SENT_WAIT_DIRECT_MS,
  MESHCORE_ROOM_LOGIN_SENT_WAIT_MS,
} from './timeConstants';

const MC_RESP_OK = 0;
const MC_RESP_ERR = 1;

function makePubKey(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  key[0] = seed & 0xff;
  key[1] = (seed >> 8) & 0xff;
  for (let i = 2; i < 32; i++) {
    key[i] = (seed + i) & 0xff;
  }
  return key;
}

function createMockConn(): MeshcoreRoomLogoutRpcConnection & {
  emit(event: string | number, payload?: unknown): void;
  sentFrames: Uint8Array[];
} {
  const handlers = new Map<string | number, Set<(...args: unknown[]) => void>>();
  const onceHandlers = new Map<string | number, Set<(...args: unknown[]) => void>>();
  const sentFrames: Uint8Array[] = [];

  const conn: MeshcoreRoomLogoutRpcConnection & {
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

describe('buildSendLogoutFrame', () => {
  it('encodes cmd 29 plus 32-byte pubkey', () => {
    const key = makePubKey(1);
    const frame = buildSendLogoutFrame(key);
    expect(frame[0]).toBe(29);
    expect(frame.slice(1, 33)).toEqual(key);
    expect(frame.length).toBe(33);
  });

  it('rejects non-32-byte pubkey', () => {
    expect(() => buildSendLogoutFrame(new Uint8Array(16))).toThrow(/32-byte/i);
  });
});

describe('runMeshcoreRoomLogout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when companion emits Ok', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(0xab);

    const logoutPromise = runMeshcoreRoomLogout(conn, pubKey);
    await Promise.resolve();
    expect(conn.sentFrames.length).toBe(1);
    expect(conn.sentFrames[0]?.[0]).toBe(29);

    conn.emit(MC_RESP_OK);
    await expect(logoutPromise).resolves.toBeUndefined();
  });

  it('rejects when companion emits Err', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(0xcd);

    const logoutPromise = runMeshcoreRoomLogout(conn, pubKey);
    await Promise.resolve();
    conn.emit(MC_RESP_ERR);

    await expect(logoutPromise).rejects.toThrow(/rejected room logout/i);
  });

  it('rejects on timeout when Ok never arrives on BLE', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(3);

    const logoutPromise = runMeshcoreRoomLogout(conn, pubKey, { companionTransport: 'ble' });
    await Promise.resolve();

    const rejection = expect(logoutPromise).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(MESHCORE_ROOM_LOGIN_SENT_WAIT_MS);
    await rejection;
  });

  it('rejects on timeout when Ok never arrives on TCP', async () => {
    const conn = createMockConn();
    const pubKey = makePubKey(4);

    const logoutPromise = runMeshcoreRoomLogout(conn, pubKey, { companionTransport: 'tcp' });
    await Promise.resolve();

    const rejection = expect(logoutPromise).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(MESHCORE_ROOM_LOGIN_SENT_WAIT_DIRECT_MS);
    await rejection;
  });
});
