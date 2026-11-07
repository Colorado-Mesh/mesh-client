import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMeshcoreRoomCredential,
  meshcoreRoomHasSavedGuestCredential,
  setMeshcoreRoomCredential,
  subscribeMeshcoreRoomCredentialChanges,
} from './meshcoreRoomCredentialStorage';
import {
  getCachedSecureSecret,
  meshcoreRoomSecretKey,
  resetSecureSecretCacheForTests,
  setSecureSecret,
} from './secureSecretStorage';

describe('meshcoreRoomCredentialStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
  });

  it('persists guest and admin passwords per room node', async () => {
    await setMeshcoreRoomCredential(0x1001, {
      guestPassword: 'hello',
      adminPassword: 'secret',
    });
    const cred = getMeshcoreRoomCredential(0x1001);
    expect(cred?.guestPassword).toBe('hello');
    expect(cred?.adminPassword).toBe('secret');
    expect(getCachedSecureSecret(meshcoreRoomSecretKey(0x1001))).toContain('secret');
    expect(localStorage.length).toBe(0);
  });

  it('persists admin-only credentials without guest password', async () => {
    await setMeshcoreRoomCredential(0x1003, { guestPassword: '', adminPassword: 'admin-only' });
    expect(getMeshcoreRoomCredential(0x1003)).toEqual({
      guestPassword: '',
      adminPassword: 'admin-only',
    });
  });

  it('preserves guest when updating admin password', async () => {
    await setMeshcoreRoomCredential(0x1004, {
      guestPassword: 'hello',
      adminPassword: 'a',
    });
    await setMeshcoreRoomCredential(0x1004, {
      guestPassword: 'hello',
      adminPassword: 'b',
    });
    expect(getMeshcoreRoomCredential(0x1004)).toEqual({
      guestPassword: 'hello',
      adminPassword: 'b',
    });
  });

  it('persists remembered blank guest password', async () => {
    await setMeshcoreRoomCredential(0x1005, { guestPassword: '', adminPassword: '' });
    expect(getMeshcoreRoomCredential(0x1005)).toEqual({ guestPassword: '' });
  });

  it('reads explicit empty guestPassword from secure storage', async () => {
    await setSecureSecret(meshcoreRoomSecretKey(0x2003), JSON.stringify({ guestPassword: '' }));
    expect(getMeshcoreRoomCredential(0x2003)).toEqual({ guestPassword: '' });
  });

  it('rejects empty objects without guestPassword or adminPassword', async () => {
    await setSecureSecret(meshcoreRoomSecretKey(0x2004), JSON.stringify({}));
    expect(getMeshcoreRoomCredential(0x2004)).toBeUndefined();
  });

  it('clears credential when set to null', async () => {
    await setMeshcoreRoomCredential(0x1002, { guestPassword: 'hello' });
    await setMeshcoreRoomCredential(0x1002, null);
    expect(getMeshcoreRoomCredential(0x1002)).toBeUndefined();
  });

  it('meshcoreRoomHasSavedGuestCredential requires the guestPassword key', async () => {
    await setMeshcoreRoomCredential(0x1010, { guestPassword: '' });
    expect(meshcoreRoomHasSavedGuestCredential(0x1010)).toBe(true);
    await setMeshcoreRoomCredential(0x1011, { adminPassword: 'ops' });
    expect(meshcoreRoomHasSavedGuestCredential(0x1011)).toBe(false);
  });

  it('notifies subscribers when credentials are set or cleared', async () => {
    const cb = vi.fn();
    const unsub = subscribeMeshcoreRoomCredentialChanges(cb);
    await setMeshcoreRoomCredential(0x1012, { guestPassword: 'hello' });
    expect(cb).toHaveBeenCalledTimes(1);
    await setMeshcoreRoomCredential(0x1012, null);
    expect(cb).toHaveBeenCalledTimes(2);
    unsub();
    await setMeshcoreRoomCredential(0x1012, { guestPassword: 'again' });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('rejects legacy empty password objects', async () => {
    await setSecureSecret(meshcoreRoomSecretKey(0x2001), JSON.stringify({ password: '' }));
    expect(getMeshcoreRoomCredential(0x2001)).toBeUndefined();
  });

  it('preserves adminPassword when falling back to legacy password field', async () => {
    await setSecureSecret(
      meshcoreRoomSecretKey(0x2002),
      JSON.stringify({ password: 'guest', adminPassword: 'admin' }),
    );
    expect(getMeshcoreRoomCredential(0x2002)).toEqual({
      guestPassword: 'guest',
      adminPassword: 'admin',
    });
  });
});
