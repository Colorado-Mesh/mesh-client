import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import {
  getMeshcoreRoomCredential,
  meshcoreRoomCredentialSettingForNode,
  setMeshcoreRoomCredential,
} from './meshcoreRoomCredentialStorage';

describe('meshcoreRoomCredentialStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
  });

  it('persists guest and admin passwords per room node', async () => {
    await setMeshcoreRoomCredential(0x1001, {
      guestPassword: 'hello',
      adminPassword: 'secret',
    });
    const cred = getMeshcoreRoomCredential(0x1001);
    expect(cred?.guestPassword).toBe('hello');
    expect(cred?.adminPassword).toBe('secret');
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toContain(
      meshcoreRoomCredentialSettingForNode(0x1001),
    );
    expect(window.electronAPI.appSettings.set).toHaveBeenCalled();
  });

  it('clears credential when set to null', async () => {
    await setMeshcoreRoomCredential(0x1002, { guestPassword: 'hello' });
    await setMeshcoreRoomCredential(0x1002, null);
    expect(getMeshcoreRoomCredential(0x1002)).toBeUndefined();
  });

  it('rejects legacy empty password objects', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        [meshcoreRoomCredentialSettingForNode(0x2001)]: JSON.stringify({ password: '' }),
      }),
    );
    expect(getMeshcoreRoomCredential(0x2001)).toBeUndefined();
  });

  it('preserves adminPassword when falling back to legacy password field', () => {
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        [meshcoreRoomCredentialSettingForNode(0x2002)]: JSON.stringify({
          password: 'guest',
          adminPassword: 'admin',
        }),
      }),
    );
    expect(getMeshcoreRoomCredential(0x2002)).toEqual({
      guestPassword: 'guest',
      adminPassword: 'admin',
    });
  });
});
