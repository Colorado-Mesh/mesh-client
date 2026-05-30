import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MESHCORE_ROOM_LOGIN_ABORT_MESSAGE,
  meshcoreApplyRoomSession,
  meshcoreCancelRoomLogin,
  meshcoreClearAllRoomSessions,
  meshcoreIsRoomLoggedIn,
  meshcoreIsRoomLoginAbortError,
  meshcoreRoomCanPost,
  meshcoreRoomLogin,
  meshcoreRoomTryRelogin,
} from './meshcoreRoomSession';

describe('meshcoreRoomSession', () => {
  afterEach(() => {
    vi.useRealTimers();
    meshcoreClearAllRoomSessions();
  });

  it('tracks read-only session and blocks posting', () => {
    meshcoreClearAllRoomSessions();
    meshcoreApplyRoomSession(0xabc, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });
    expect(meshcoreIsRoomLoggedIn(0xabc)).toBe(true);
    expect(meshcoreRoomCanPost(0xabc)).toBe(false);
  });

  it('allows posting for readwrite session', () => {
    meshcoreClearAllRoomSessions();
    meshcoreApplyRoomSession(0xabc, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    expect(meshcoreRoomCanPost(0xabc)).toBe(true);
  });

  it('login stores session on success', async () => {
    meshcoreClearAllRoomSessions();
    const conn = {
      login: vi.fn().mockResolvedValue({ permissions: 2 }),
    };
    const pubKey = new Uint8Array(32);
    await meshcoreRoomLogin(conn, 42, pubKey, 'hello', {
      guestPassword: 'hello',
      adminPassword: '',
    });
    expect(meshcoreIsRoomLoggedIn(42)).toBe(true);
    expect(meshcoreRoomCanPost(42)).toBe(true);
  });

  it('login throws a helpful message on timeout', async () => {
    meshcoreClearAllRoomSessions();
    const conn = {
      login: vi.fn().mockRejectedValue('timeout'),
    };
    const pubKey = new Uint8Array(32);
    await expect(meshcoreRoomLogin(conn, 42, pubKey, '', {})).rejects.toThrow(/read-only/i);
  });

  it('retries login up to three times with backoff', async () => {
    vi.useFakeTimers();
    meshcoreClearAllRoomSessions();
    const conn = {
      login: vi
        .fn()
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValue({ permissions: 2 }),
    };
    const pubKey = new Uint8Array(32);
    const loginPromise = meshcoreRoomLogin(conn, 42, pubKey, 'hello', {});
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await loginPromise;
    expect(conn.login).toHaveBeenCalledTimes(3);
    expect(meshcoreIsRoomLoggedIn(42)).toBe(true);
  });

  it('tryRelogin reuses stored guest password before posting', async () => {
    meshcoreClearAllRoomSessions();
    const conn = { login: vi.fn().mockResolvedValue({ permissions: 2 }) };
    const pubKey = new Uint8Array(32);
    meshcoreApplyRoomSession(42, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const ok = await meshcoreRoomTryRelogin(conn, 42, pubKey, 'post');
    expect(ok).toBe(true);
    expect(conn.login).toHaveBeenCalledWith(pubKey, 'hello', 45_000);
  });

  it('cancel before second retry stops after first login attempt', async () => {
    vi.useFakeTimers();
    const conn = {
      login: vi.fn().mockRejectedValueOnce(new Error('timeout')),
    };
    const pubKey = new Uint8Array(32);
    const loginPromise = meshcoreRoomLogin(conn, 42, pubKey, 'hello', {});
    const settled = loginPromise.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await Promise.resolve();
    meshcoreCancelRoomLogin(42);
    await vi.runAllTimersAsync();
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(meshcoreIsRoomLoginAbortError(result.err)).toBe(true);
    }
    expect(conn.login).toHaveBeenCalledTimes(1);
    expect(meshcoreIsRoomLoggedIn(42)).toBe(false);
  });

  it('does not apply session when login resolves after cancel', async () => {
    let resolveLogin!: (value: { permissions: number }) => void;
    const loginDeferred = new Promise<{ permissions: number }>((resolve) => {
      resolveLogin = resolve;
    });
    const conn = {
      login: vi.fn().mockReturnValue(loginDeferred),
    };
    const pubKey = new Uint8Array(32);
    const loginPromise = meshcoreRoomLogin(conn, 42, pubKey, 'hello', {});
    const settled = loginPromise.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await Promise.resolve();
    expect(conn.login).toHaveBeenCalledTimes(1);
    meshcoreCancelRoomLogin(42);
    resolveLogin({ permissions: 2 });
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(meshcoreIsRoomLoginAbortError(result.err)).toBe(true);
    }
    expect(meshcoreIsRoomLoggedIn(42)).toBe(false);
  });

  it('exports abort message constant', () => {
    expect(MESHCORE_ROOM_LOGIN_ABORT_MESSAGE).toBe('Room login cancelled');
  });
});
