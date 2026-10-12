// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setMeshcoreRepeaterCredential } from './meshcoreRepeaterCredentialStorage';
import { MESHCORE_REPEATER_LOGIN_EXTRA_TIMEOUT_MS } from './meshcoreRepeaterLoginRpc';
import type { MeshcoreRadioConnection } from './meshcoreRepeaterRpcCommon';
import {
  MC_PUSH_LOGIN_FAIL,
  MC_PUSH_LOGIN_SUCCESS,
  MC_RESP_ERR,
  MC_RESP_SENT,
} from './meshcoreRepeaterRpcCommon';
import {
  assertMeshcoreRepeaterLoginOk,
  clearAllMeshcoreRepeaterEphemeralPasswords,
  meshcoreRepeaterHasResolvablePassword,
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

describe('meshcoreRepeaterHasResolvablePassword', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllMeshcoreRepeaterEphemeralPasswords();
  });

  it('returns true for persisted and ephemeral passwords', async () => {
    expect(meshcoreRepeaterHasResolvablePassword(0x42)).toBe(false);
    setMeshcoreRepeaterEphemeralPassword(0x42, 'session');
    expect(meshcoreRepeaterHasResolvablePassword(0x42)).toBe(true);
    clearAllMeshcoreRepeaterEphemeralPasswords();
    await setMeshcoreRepeaterCredential(0x42, { password: 'saved' });
    expect(meshcoreRepeaterHasResolvablePassword(0x42)).toBe(true);
  });
});

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

  it('assertMeshcoreRepeaterLoginOk maps login timeout-after-LoginFail to timeout (not auth)', async () => {
    vi.useFakeTimers();
    try {
      const conn = createMockConn();
      const pubKey = new Uint8Array(32);
      pubKey[0] = 0x77;
      setMeshcoreRepeaterEphemeralPassword(0x77, 'bad');
      const loginPromise = meshcoreRepeaterTryLogin(
        conn,
        pubKey,
        0x77,
        undefined,
        MESHCORE_REPEATER_LOGIN_EXTRA_TIMEOUT_MS,
      );
      const failAttempt = async (): Promise<void> => {
        await Promise.resolve();
        conn.emit(MC_RESP_SENT, { estTimeout: 100 });
        conn.emit(MC_PUSH_LOGIN_FAIL, { pubKeyPrefix: pubKey.subarray(0, 6) });
        vi.advanceTimersByTime(100 + MESHCORE_REPEATER_LOGIN_EXTRA_TIMEOUT_MS);
        await Promise.resolve();
      };
      await failAttempt();
      await failAttempt();
      const result = await loginPromise;
      expect(() => {
        assertMeshcoreRepeaterLoginOk(result);
      }).toThrow(/^timeout$/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('assertMeshcoreRepeaterLoginOk throws auth failure for radio-rejected login', async () => {
    const conn = createMockConn();
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0x88;
    setMeshcoreRepeaterEphemeralPassword(0x88, 'bad');
    const loginPromise = meshcoreRepeaterTryLogin(conn, pubKey, 0x88);
    await Promise.resolve();
    conn.emit(MC_RESP_ERR);
    const result = await loginPromise;
    expect(() => {
      assertMeshcoreRepeaterLoginOk(result);
    }).toThrow(/authentication failed/i);
  });

  it('re-adds an evicted radio contact and retries login on ERR_CODE_NOT_FOUND', async () => {
    const conn = createMockConn();
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0x6f;
    setMeshcoreRepeaterEphemeralPassword(0x6f, 'admin');
    const restoreRadioContact = vi.fn(() => {
      conn.sendToRadioFrame.mockImplementationOnce(() => {
        queueMicrotask(() => {
          conn.emit(MC_RESP_SENT, { estTimeout: 100 });
          conn.emit(MC_PUSH_LOGIN_SUCCESS, { pubKeyPrefix: pubKey.subarray(0, 6) });
        });
        return Promise.resolve();
      });
      return Promise.resolve();
    });
    const loginPromise = meshcoreRepeaterTryLogin(conn, pubKey, 0x6f, undefined, undefined, {
      restoreRadioContact,
    });
    await Promise.resolve();
    conn.emit(MC_RESP_ERR, { errCode: 2 });
    const result = await loginPromise;
    expect(restoreRadioContact).toHaveBeenCalledTimes(1);
    expect(conn.sendToRadioFrame).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ attempted: true, ok: true });
  });

  it('reports a missing radio contact instead of authentication failure', async () => {
    const conn = createMockConn();
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0x70;
    setMeshcoreRepeaterEphemeralPassword(0x70, 'admin');
    const loginPromise = meshcoreRepeaterTryLogin(conn, pubKey, 0x70);
    await Promise.resolve();
    conn.emit(MC_RESP_ERR, { errCode: 2 });
    const result = await loginPromise;
    expect(() => {
      assertMeshcoreRepeaterLoginOk(result);
    }).toThrow('meshcore.errors.radioContactMissing');
  });

  it('surfaces a contact restore failure without retrying login', async () => {
    const conn = createMockConn();
    const pubKey = new Uint8Array(32);
    pubKey[0] = 0x71;
    setMeshcoreRepeaterEphemeralPassword(0x71, 'admin');
    const restoreErr = new Error('meshcore.errors.radioContactTableFull');
    const loginPromise = meshcoreRepeaterTryLogin(conn, pubKey, 0x71, undefined, undefined, {
      restoreRadioContact: () => Promise.reject(restoreErr),
    });
    await Promise.resolve();
    conn.emit(MC_RESP_ERR, { errCode: 2 });
    const result = await loginPromise;
    expect(conn.sendToRadioFrame).toHaveBeenCalledTimes(1);
    expect(() => {
      assertMeshcoreRepeaterLoginOk(result);
    }).toThrow('meshcore.errors.radioContactTableFull');
  });

  it('does not resend after a reply timeout when retryOnTimeout is false', async () => {
    vi.useFakeTimers();
    try {
      const conn = createMockConn();
      const pubKey = new Uint8Array(32);
      pubKey[0] = 0x72;
      setMeshcoreRepeaterEphemeralPassword(0x72, 'admin');
      const loginPromise = meshcoreRepeaterTryLogin(conn, pubKey, 0x72, undefined, 30_000, {
        retryOnTimeout: false,
      });
      await Promise.resolve();
      conn.emit(MC_RESP_SENT, { estTimeout: 100 });
      vi.advanceTimersByTime(100 + 30_000);
      const result = await loginPromise;
      expect(conn.sendToRadioFrame).toHaveBeenCalledTimes(1);
      expect(() => {
        assertMeshcoreRepeaterLoginOk(result);
      }).toThrow(/^timeout$/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('assertMeshcoreRepeaterLoginOk maps login timeout to timeout (not auth)', () => {
    expect(() => {
      assertMeshcoreRepeaterLoginOk({
        attempted: true,
        ok: false,
        fromPersisted: true,
        error: new Error('timeout'),
      });
    }).toThrow(/^timeout$/i);
  });
});
