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
  applyMeshcoreRoomLoginFailure,
  disableMeshcoreRoomAutoLogin,
  disableMeshcoreRoomLoginAfterAuthFailure,
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

  it('disable auto-login with clearFailure false keeps failure banner', async () => {
    await setMeshcoreRoomSyncConfig(0x14, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    setMeshcoreRoomAutoLoginFailure(0x14, 'wrong password');
    await disableMeshcoreRoomAutoLogin(0x14, { clearFailure: false });
    expect(getMeshcoreRoomSyncConfig(0x14).autoLoginOnConnect).toBe(false);
    expect(getMeshcoreRoomAutoLoginFailure(0x14)).toBe('wrong password');
  });

  it('applyMeshcoreRoomLoginFailure disables sync on auth error and sets failure UI', async () => {
    await setMeshcoreRoomCredential(0x15, { guestPassword: 'hello' });
    await setMeshcoreRoomSyncConfig(0x15, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    await applyMeshcoreRoomLoginFailure(
      0x15,
      new Error('room login rejected (wrong password or ACL denied)'),
      'test',
    );
    expect(getMeshcoreRoomCredential(0x15)?.guestPassword).toBe('hello');
    const cfg = getMeshcoreRoomSyncConfig(0x15);
    expect(cfg.enabled).toBe(false);
    expect(cfg.autoLoginOnConnect).toBe(false);
    expect(getMeshcoreRoomAutoLoginFailure(0x15)).toContain('rejected');
  });

  it('applyMeshcoreRoomLoginFailure sets failure but keeps sync on non-auth errors', async () => {
    await setMeshcoreRoomSyncConfig(0x16, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    await applyMeshcoreRoomLoginFailure(0x16, new Error('timeout'), 'test');
    const cfg = getMeshcoreRoomSyncConfig(0x16);
    expect(cfg.enabled).toBe(true);
    expect(cfg.autoLoginOnConnect).toBe(true);
    expect(getMeshcoreRoomAutoLoginFailure(0x16)).toBe('timeout');
  });

  it('disableMeshcoreRoomLoginAfterAuthFailure disables sync but keeps credential and failure', async () => {
    await setMeshcoreRoomCredential(0x13, { guestPassword: 'hello' });
    await setMeshcoreRoomSyncConfig(0x13, {
      enabled: true,
      intervalMinutes: 90,
      autoLoginOnConnect: true,
    });
    setMeshcoreRoomAutoLoginFailure(0x13, 'room login rejected (wrong password or ACL denied)');
    await disableMeshcoreRoomLoginAfterAuthFailure(0x13);
    expect(getMeshcoreRoomCredential(0x13)?.guestPassword).toBe('hello');
    const cfg = getMeshcoreRoomSyncConfig(0x13);
    expect(cfg.enabled).toBe(false);
    expect(cfg.autoLoginOnConnect).toBe(false);
    expect(cfg.intervalMinutes).toBe(90);
    expect(getMeshcoreRoomAutoLoginFailure(0x13)).toContain('rejected');
  });
});
