import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MESHCORE_ROOM_DEFAULT_GUEST_PASSWORD,
  MESHCORE_ROOM_LOGIN_ABORT_MESSAGE,
  MESHCORE_ROOM_LOGIN_NO_ROUTE_MESSAGE,
  meshcoreAbortablePromise,
  meshcoreApplyRoomSession,
  meshcoreBeginRoomLoginOperation,
  meshcoreCancelRoomLogin,
  meshcoreClearAllRoomSessions,
  meshcoreEndRoomLoginOperation,
  meshcoreGetRoomSession,
  meshcoreIsRoomLoggedIn,
  meshcoreIsRoomLoginAbortError,
  meshcoreRoomCanPost,
  meshcoreRoomCliRequiresAdmin,
  meshcoreRoomEffectiveGuestPassword,
  meshcoreRoomLogin,
  meshcoreRoomLoginErrorIsAuthFailure,
  meshcoreRoomLoginErrorIsNoRoute,
  meshcoreRoomLoginFailureMessage,
  meshcoreRoomLogout,
  meshcoreRoomTryAdminLogin,
  meshcoreRoomTryRelogin,
  meshcoreTryRemoteServerLogin,
} from './meshcoreRoomSession';

vi.mock('./meshcoreRoomLoginRpc', () => ({
  MESHCORE_ROOM_LOGIN_ABORT_MESSAGE: 'Room login cancelled',
  runMeshcoreRoomLogin: vi.fn(),
}));

vi.mock('./meshcoreRoomLogoutRpc', () => ({
  runMeshcoreRoomLogout: vi.fn(),
}));

import { runMeshcoreRoomLogin } from './meshcoreRoomLoginRpc';
import { runMeshcoreRoomLogout } from './meshcoreRoomLogoutRpc';

const mockRunMeshcoreRoomLogin = vi.mocked(runMeshcoreRoomLogin);
const mockRunMeshcoreRoomLogout = vi.mocked(runMeshcoreRoomLogout);

describe('meshcoreRoomSession', () => {
  afterEach(() => {
    vi.useRealTimers();
    mockRunMeshcoreRoomLogin.mockClear();
    mockRunMeshcoreRoomLogout.mockClear();
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

  it('meshcoreRoomEffectiveGuestPassword trims without substituting hello', () => {
    expect(meshcoreRoomEffectiveGuestPassword('')).toBe('');
    expect(meshcoreRoomEffectiveGuestPassword('  ')).toBe('');
    expect(meshcoreRoomEffectiveGuestPassword('  secret  ')).toBe('secret');
    expect(meshcoreRoomEffectiveGuestPassword(MESHCORE_ROOM_DEFAULT_GUEST_PASSWORD)).toBe('hello');
  });

  it('meshcoreRoomLoginFailureMessage distinguishes blank vs hello guest', () => {
    const rejected = new Error('room login rejected (wrong password or ACL denied)');
    expect(meshcoreRoomLoginFailureMessage(rejected, '')).toEqual({
      key: 'meshcore.errors.roomLogin.rejectedBlankGuest',
    });
    expect(meshcoreRoomLoginFailureMessage(rejected, 'hello')).toEqual({
      key: 'meshcore.errors.roomLogin.rejectedDefaultGuest',
    });
    expect(meshcoreRoomLoginFailureMessage(rejected, 'other')).toEqual({
      key: 'meshcore.errors.roomLogin.rejectedCheckPassword',
    });
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
    mockRunMeshcoreRoomLogin.mockResolvedValue({ permissions: 2 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    await meshcoreRoomLogin(conn, 42, pubKey, 'hello', {
      guestPassword: 'hello',
      adminPassword: '',
    });
    expect(meshcoreIsRoomLoggedIn(42)).toBe(true);
    expect(meshcoreRoomCanPost(42)).toBe(true);
  });

  it('login uses meshcore.js reserved ACL byte over empty-password hint', async () => {
    meshcoreClearAllRoomSessions();
    // Empty password hint would be readonly; reserved=2 (read-write) must win.
    mockRunMeshcoreRoomLogin.mockResolvedValue({ reserved: 2 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    await meshcoreRoomLogin(conn, 42, pubKey, '', {
      guestPassword: '',
      adminPassword: '',
    });
    expect(meshcoreGetRoomSession(42)?.role).toBe('readwrite');
    expect(meshcoreRoomCanPost(42)).toBe(true);
  });

  it('login treats reserved guest ACL as read-only', async () => {
    meshcoreClearAllRoomSessions();
    mockRunMeshcoreRoomLogin.mockResolvedValue({ reserved: 0 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    await meshcoreRoomLogin(conn, 42, pubKey, 'hello', {
      guestPassword: 'hello',
      adminPassword: '',
    });
    expect(meshcoreGetRoomSession(42)?.role).toBe('readonly');
    expect(meshcoreRoomCanPost(42)).toBe(false);
  });

  it('login prefers permissions over reserved when both present', async () => {
    meshcoreClearAllRoomSessions();
    mockRunMeshcoreRoomLogin.mockResolvedValue({ permissions: 3, reserved: 0 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    await meshcoreRoomLogin(conn, 42, pubKey, 'hello', {
      guestPassword: 'hello',
      adminPassword: 'admin',
    });
    expect(meshcoreGetRoomSession(42)?.role).toBe('admin');
  });

  it('skips relogin when already logged in without forceRelogin', async () => {
    meshcoreClearAllRoomSessions();
    mockRunMeshcoreRoomLogin.mockResolvedValue({ permissions: 2 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    meshcoreApplyRoomSession(42, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });

    await meshcoreRoomLogin(conn, 42, pubKey, 'hello', {
      guestPassword: 'hello',
      adminPassword: '',
    });

    expect(mockRunMeshcoreRoomLogin).not.toHaveBeenCalled();
    expect(meshcoreGetRoomSession(42)?.role).toBe('readwrite');
  });

  it('meshcoreRoomCliRequiresAdmin detects ACL mutation tokens', () => {
    expect(meshcoreRoomCliRequiresAdmin('allow.read.only on')).toBe(true);
    expect(meshcoreRoomCliRequiresAdmin('allow.read.only off')).toBe(true);
    expect(meshcoreRoomCliRequiresAdmin('setperm 01 3')).toBe(true);
    expect(meshcoreRoomCliRequiresAdmin('get acl')).toBe(false);
    expect(meshcoreRoomCliRequiresAdmin('clock')).toBe(false);
  });

  it('forceRelogin upgrades an existing read-only session to admin', async () => {
    meshcoreClearAllRoomSessions();
    mockRunMeshcoreRoomLogin.mockResolvedValue({ permissions: 3 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    meshcoreApplyRoomSession(42, {
      guestPassword: '',
      adminPassword: '',
      role: 'readonly',
    });

    await meshcoreRoomLogin(conn, 42, pubKey, 'password', {
      guestPassword: '',
      adminPassword: 'password',
      forceRelogin: true,
    });

    expect(mockRunMeshcoreRoomLogin).toHaveBeenCalledTimes(1);
    expect(meshcoreGetRoomSession(42)?.role).toBe('admin');
  });

  it('forceRelogin upgrades an existing guest session to admin', async () => {
    meshcoreClearAllRoomSessions();
    mockRunMeshcoreRoomLogin.mockResolvedValue({ permissions: 3 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    meshcoreApplyRoomSession(42, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });

    await meshcoreRoomLogin(conn, 42, pubKey, 'password', {
      guestPassword: 'hello',
      adminPassword: 'password',
      forceRelogin: true,
    });

    expect(mockRunMeshcoreRoomLogin).toHaveBeenCalledTimes(1);
    expect(meshcoreGetRoomSession(42)?.role).toBe('admin');
  });

  it('login throws a helpful message on timeout', async () => {
    meshcoreClearAllRoomSessions();
    mockRunMeshcoreRoomLogin.mockRejectedValue(new Error('timeout'));
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    await expect(meshcoreRoomLogin(conn, 42, pubKey, '', {})).rejects.toThrow(
      /meshcore\.errors\.roomLogin\.timedOutBlankGuest/,
    );
  });

  it('retries login up to two times with backoff', async () => {
    vi.useFakeTimers();
    meshcoreClearAllRoomSessions();
    mockRunMeshcoreRoomLogin
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ permissions: 2 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    const loginPromise = meshcoreRoomLogin(conn, 42, pubKey, 'hello', {});
    await vi.advanceTimersByTimeAsync(2_000);
    await loginPromise;
    expect(mockRunMeshcoreRoomLogin).toHaveBeenCalledTimes(2);
    expect(meshcoreIsRoomLoggedIn(42)).toBe(true);
  });

  it('tryRelogin reuses stored guest password before posting', async () => {
    meshcoreClearAllRoomSessions();
    mockRunMeshcoreRoomLogin.mockResolvedValue({ permissions: 2 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    meshcoreApplyRoomSession(42, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const ok = await meshcoreRoomTryRelogin(conn, 42, pubKey, 'post');
    expect(ok).toBe(true);
    expect(mockRunMeshcoreRoomLogin).toHaveBeenCalledWith(conn, pubKey, 'hello', {
      hopsAway: undefined,
      signal: expect.any(AbortSignal),
    });
  });

  it('tryRelogin admin uses facade admin when session only has guest', async () => {
    meshcoreClearAllRoomSessions();
    const { setMeshcoreRoomCredential } = await import('./meshcoreRoomCredentialStorage');
    const { clearAllRoomEphemeralAdminPasswords } = await import('./meshcoreInfraAdminSecrets');
    clearAllRoomEphemeralAdminPasswords();
    localStorage.clear();
    await setMeshcoreRoomCredential(42, { guestPassword: 'hello', adminPassword: 'ops-admin' });
    mockRunMeshcoreRoomLogin.mockResolvedValue({ permissions: 3 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    meshcoreApplyRoomSession(42, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const ok = await meshcoreRoomTryRelogin(conn, 42, pubKey, 'admin');
    expect(ok).toBe(true);
    expect(mockRunMeshcoreRoomLogin).toHaveBeenCalledWith(conn, pubKey, 'ops-admin', {
      hopsAway: undefined,
      signal: expect.any(AbortSignal),
    });
    expect(meshcoreGetRoomSession(42)?.role).toBe('admin');
  });

  it('tryRelogin admin returns false for guest-only session without admin password', async () => {
    meshcoreClearAllRoomSessions();
    const { clearAllRoomEphemeralAdminPasswords } = await import('./meshcoreInfraAdminSecrets');
    clearAllRoomEphemeralAdminPasswords();
    localStorage.clear();
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    meshcoreApplyRoomSession(42, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const ok = await meshcoreRoomTryRelogin(conn, 42, pubKey, 'admin');
    expect(ok).toBe(false);
    expect(mockRunMeshcoreRoomLogin).not.toHaveBeenCalled();
  });

  it('cancel before second retry stops after first login attempt', async () => {
    vi.useFakeTimers();
    mockRunMeshcoreRoomLogin.mockRejectedValueOnce(new Error('timeout'));
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
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
    expect(mockRunMeshcoreRoomLogin).toHaveBeenCalledTimes(1);
    expect(meshcoreIsRoomLoggedIn(42)).toBe(false);
  });

  it('outer login cancel aborts path-resolve wait before SendLogin', async () => {
    const signal = meshcoreBeginRoomLoginOperation(99);
    let resolveSlow!: (v: string) => void;
    const slow = new Promise<string>((resolve) => {
      resolveSlow = resolve;
    });
    const raced = meshcoreAbortablePromise(slow, signal);
    const settled = raced.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    meshcoreCancelRoomLogin(99);
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(meshcoreIsRoomLoginAbortError(result.err)).toBe(true);
    }
    resolveSlow('late');
    meshcoreEndRoomLoginOperation(99, signal);
  });

  it('does not apply session when login resolves after cancel', async () => {
    let resolveLogin!: (value: { permissions: number }) => void;
    const loginDeferred = new Promise<{ permissions: number }>((resolve) => {
      resolveLogin = resolve;
    });
    mockRunMeshcoreRoomLogin.mockReturnValue(loginDeferred);
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    const loginPromise = meshcoreRoomLogin(conn, 42, pubKey, 'hello', {});
    const settled = loginPromise.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    await Promise.resolve();
    expect(mockRunMeshcoreRoomLogin).toHaveBeenCalledTimes(1);
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

  it('logout clears session on success', async () => {
    meshcoreClearAllRoomSessions();
    mockRunMeshcoreRoomLogout.mockResolvedValue(undefined);
    meshcoreApplyRoomSession(42, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    await meshcoreRoomLogout(conn, 42, pubKey);
    expect(mockRunMeshcoreRoomLogout).toHaveBeenCalledWith(conn, pubKey, undefined);
    expect(meshcoreIsRoomLoggedIn(42)).toBe(false);
  });

  it('meshcoreRoomLoginErrorIsAuthFailure detects rejected login errors', () => {
    expect(
      meshcoreRoomLoginErrorIsAuthFailure(
        new Error('room login rejected (wrong password or ACL denied)'),
      ),
    ).toBe(true);
    expect(meshcoreRoomLoginErrorIsAuthFailure(new Error('login timed out'))).toBe(false);
  });

  it('meshcoreRoomLoginErrorIsNoRoute detects missing route errors', () => {
    expect(meshcoreRoomLoginErrorIsNoRoute(new Error(MESHCORE_ROOM_LOGIN_NO_ROUTE_MESSAGE))).toBe(
      true,
    );
    expect(meshcoreRoomLoginErrorIsNoRoute(new Error('login timed out'))).toBe(false);
  });

  it('meshcoreRoomTryAdminLogin uses persisted admin when there is no session', async () => {
    meshcoreClearAllRoomSessions();
    const { setMeshcoreRoomCredential } = await import('./meshcoreRoomCredentialStorage');
    const { clearAllRoomEphemeralAdminPasswords } = await import('./meshcoreInfraAdminSecrets');
    clearAllRoomEphemeralAdminPasswords();
    localStorage.clear();
    await setMeshcoreRoomCredential(55, { guestPassword: '', adminPassword: 'saved-admin' });
    mockRunMeshcoreRoomLogin.mockResolvedValue({ permissions: 3 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    await meshcoreRoomTryAdminLogin(conn, 55, pubKey);
    expect(mockRunMeshcoreRoomLogin).toHaveBeenCalled();
    expect(meshcoreGetRoomSession(55)?.role).toBe('admin');
  });

  it('meshcoreRoomTryAdminLogin passes hopsAway into room login RPC opts', async () => {
    meshcoreClearAllRoomSessions();
    const { setMeshcoreRoomCredential } = await import('./meshcoreRoomCredentialStorage');
    const { clearAllRoomEphemeralAdminPasswords } = await import('./meshcoreInfraAdminSecrets');
    clearAllRoomEphemeralAdminPasswords();
    localStorage.clear();
    await setMeshcoreRoomCredential(56, { adminPassword: 'saved-admin' });
    mockRunMeshcoreRoomLogin.mockResolvedValue({ permissions: 3 });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    await meshcoreRoomTryAdminLogin(conn, 56, pubKey, { hopsAway: 0, companionTransport: 'ble' });
    expect(mockRunMeshcoreRoomLogin).toHaveBeenCalledWith(conn, pubKey, 'saved-admin', {
      hopsAway: 0,
      companionTransport: 'ble',
      signal: expect.any(AbortSignal),
    });
  });

  it('meshcoreTryRemoteServerLogin for Room does not call repeater login', async () => {
    meshcoreClearAllRoomSessions();
    mockRunMeshcoreRoomLogin.mockResolvedValue({ permissions: 3 });
    const { setMeshcoreRoomCredential } = await import('./meshcoreRoomCredentialStorage');
    await setMeshcoreRoomCredential(66, { adminPassword: 'admin' });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    await meshcoreTryRemoteServerLogin(conn, 66, pubKey, 'Room');
    expect(mockRunMeshcoreRoomLogin).toHaveBeenCalled();
  });

  it('meshcoreTryRemoteServerLogin for Room skips login when session already exists', async () => {
    meshcoreClearAllRoomSessions();
    meshcoreApplyRoomSession(67, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    const conn = {
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      sendToRadioFrame: vi.fn(),
    };
    const pubKey = new Uint8Array(32);
    await meshcoreTryRemoteServerLogin(conn, 67, pubKey, 'Room');
    expect(mockRunMeshcoreRoomLogin).not.toHaveBeenCalled();
    expect(meshcoreGetRoomSession(67)?.role).toBe('readwrite');
  });
});
