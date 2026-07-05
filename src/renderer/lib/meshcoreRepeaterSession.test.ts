// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setMeshcoreRepeaterCredential } from './meshcoreRepeaterCredentialStorage';
import type { MeshcoreRadioConnection } from './meshcoreRepeaterRpcCommon';
import { MC_PUSH_LOGIN_SUCCESS, MC_RESP_SENT } from './meshcoreRepeaterRpcCommon';
import {
  clearAllMeshcoreRepeaterEphemeralPasswords,
  meshcoreRepeaterTryLogin,
  setMeshcoreRepeaterEphemeralPassword,
} from './meshcoreRepeaterSession';

type MockMeshcoreRepeaterConn = MeshcoreRadioConnection & {
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
    once(event, cb) {
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
    emit(event, payload) {
      handlers.get(event)?.forEach((cb) => {
        cb(payload);
      });
    },
    sendToRadioFrame: vi.fn(async () => {}),
  };
}

describe('meshcoreRepeaterTryLogin', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllMeshcoreRepeaterEphemeralPasswords();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
  });

  afterEach(() => {
    clearAllMeshcoreRepeaterEphemeralPasswords();
  });

  it('sends login when persisted credential exists', async () => {
    await setMeshcoreRepeaterCredential(0x42, { password: 'secret' });
    const conn = createMockConn();
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0xaa;
    const loginPromise = meshcoreRepeaterTryLogin(conn, pubKey, 0x42);
    conn.emit(MC_RESP_SENT, { estTimeout: 100 });
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: pubKey.subarray(0, 6) });
    const result = await loginPromise;
    expect(result.attempted).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.fromPersisted).toBe(true);
    expect(conn.sendToRadioFrame).toHaveBeenCalled();
  });

  it('skips login when no password is configured', async () => {
    const conn = createMockConn();
    const result = await meshcoreRepeaterTryLogin(conn, new Uint8Array(32), 0x99);
    expect(result.attempted).toBe(false);
    expect(result.ok).toBe(true);
    expect(conn.sendToRadioFrame).not.toHaveBeenCalled();
  });

  it('uses ephemeral password when no persisted credential', async () => {
    setMeshcoreRepeaterEphemeralPassword(0x55, 'temp');
    const conn = createMockConn();
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0xbb;
    const loginPromise = meshcoreRepeaterTryLogin(conn, pubKey, 0x55);
    conn.emit(MC_RESP_SENT, { estTimeout: 100 });
    conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: pubKey.subarray(0, 6) });
    const result = await loginPromise;
    expect(result.attempted).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.fromPersisted).toBe(false);
  });
});
