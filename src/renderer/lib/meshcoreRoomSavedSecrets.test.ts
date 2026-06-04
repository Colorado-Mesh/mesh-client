import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeAppSetting } from './appSettingsStorage';
import {
  getMeshcoreRoomAutoLoginFailure,
  setMeshcoreRoomAutoLoginFailure,
} from './meshcoreRoomAutoLoginFailure';
import {
  getMeshcoreRoomCredential,
  meshcoreRoomCredentialSettingForNode,
  setMeshcoreRoomCredential,
} from './meshcoreRoomCredentialStorage';
import {
  disableMeshcoreRoomAutoLogin,
  forgetMeshcoreRoomSavedSecrets,
  getMeshcoreRoomSavedSecretsSummary,
} from './meshcoreRoomSavedSecrets';
import {
  getMeshcoreRoomSyncConfig,
  meshcoreRoomSyncSettingForNode,
  setMeshcoreRoomSyncConfig,
} from './meshcoreRoomSyncStorage';

describe('meshcoreRoomSavedSecrets', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
  });

  it('summarizes credential and sync flags', async () => {
    await setMeshcoreRoomCredential(0x10, { guestPassword: 'hello' });
    await setMeshcoreRoomSyncConfig(0x10, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    expect(getMeshcoreRoomSavedSecretsSummary(0x10)).toEqual({
      hasCredential: true,
      autoLoginOnConnect: true,
      syncEnabled: true,
    });
  });

  it('forget clears credential and disables sync and auto-login', async () => {
    await setMeshcoreRoomCredential(0x11, { guestPassword: 'hello' });
    await setMeshcoreRoomSyncConfig(0x11, {
      enabled: true,
      intervalMinutes: 120,
      autoLoginOnConnect: true,
    });
    setMeshcoreRoomAutoLoginFailure(0x11, 'wrong password');
    await forgetMeshcoreRoomSavedSecrets(0x11);
    expect(getMeshcoreRoomCredential(0x11)).toBeUndefined();
    const cfg = getMeshcoreRoomSyncConfig(0x11);
    expect(cfg.enabled).toBe(false);
    expect(cfg.autoLoginOnConnect).toBe(false);
    expect(cfg.intervalMinutes).toBe(120);
    expect(getMeshcoreRoomAutoLoginFailure(0x11)).toBeUndefined();
  });

  it('disable auto-login keeps credential', async () => {
    mergeAppSetting(
      meshcoreRoomCredentialSettingForNode(0x12),
      JSON.stringify({ guestPassword: 'secret' }),
      'meshcoreRoomSavedSecrets.test',
    );
    mergeAppSetting(
      meshcoreRoomSyncSettingForNode(0x12),
      JSON.stringify({ enabled: true, intervalMinutes: 60, autoLoginOnConnect: true }),
      'meshcoreRoomSavedSecrets.test',
    );
    await disableMeshcoreRoomAutoLogin(0x12);
    expect(getMeshcoreRoomCredential(0x12)?.guestPassword).toBe('secret');
    expect(getMeshcoreRoomSyncConfig(0x12).autoLoginOnConnect).toBe(false);
    expect(getMeshcoreRoomSyncConfig(0x12).enabled).toBe(true);
  });
});
