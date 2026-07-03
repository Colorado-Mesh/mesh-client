import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeshcoreRepeaterRpcConnection } from './meshcoreRepeaterRpcCommon';
import { MC_PUSH_LOGIN_SUCCESS, MC_RESP_SENT } from './meshcoreRepeaterRpcCommon';
import { meshcoreRepeaterTryLogin } from './meshcoreRepeaterSession';
import {
  meshcoreApplyRepeaterSessionAuth,
  meshcoreClearRepeaterRemoteSessionAuth,
} from './meshcoreUtils';

type MockMeshcoreRepeaterConn = MeshcoreRepeaterRpcConnection & {
  emit: (event: string | number, payload?: unknown) => void;
  sendToRadioFrame: ReturnType<typeof vi.fn<(data: Uint8Array) => Promise<void>>>;
};

function createMockConn(): MockMeshcoreRepeaterConn {
  const handlers = new Map<string | number, Set<(...args: unknown[]) => void>>();
  return {
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
    },
    sendToRadioFrame: vi.fn<(data: Uint8Array) => Promise<void>>().mockResolvedValue(undefined),
    emit(event, payload) {
      for (const cb of handlers.get(event) ?? []) {
        cb(payload);
      }
    },
  };
}

describe('meshcoreRepeaterTryLogin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    meshcoreClearRepeaterRemoteSessionAuth();
  });

  it('sends login frame after applying session password', async () => {
    meshcoreApplyRepeaterSessionAuth('secret');
    const conn = createMockConn();
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0xab;

    const loginPromise = meshcoreRepeaterTryLogin(conn, pubKey);
    await Promise.resolve();
    expect(conn.sendToRadioFrame).toHaveBeenCalledTimes(1);

    conn.emit(MC_RESP_SENT, { estTimeout: 100 });
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: pubKey.subarray(0, 6) });
    await loginPromise;
  });

  it('skips login when session password is empty', async () => {
    meshcoreClearRepeaterRemoteSessionAuth();
    const conn = createMockConn();
    await meshcoreRepeaterTryLogin(conn, new Uint8Array(32));
    expect(conn.sendToRadioFrame).not.toHaveBeenCalled();
  });
});
