// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import {
  clearAllRoomEphemeralAdminPasswords,
  forgetAdminPassword,
  hasResolvableAdminPassword,
  listSavedAdminPasswords,
  resolveRoomAdminPassword,
  setAdminPassword,
} from './meshcoreInfraAdminSecrets';
import {
  getMeshcoreRepeaterCredential,
  meshcoreRepeaterCredentialSettingForNode,
  setMeshcoreRepeaterCredential,
} from './meshcoreRepeaterCredentialStorage';
import { clearAllMeshcoreRepeaterEphemeralPasswords } from './meshcoreRepeaterSession';
import {
  getMeshcoreRoomCredential,
  meshcoreRoomCredentialSettingForNode,
  setMeshcoreRoomCredential,
} from './meshcoreRoomCredentialStorage';
import { getMeshcoreRoomSyncConfig, setMeshcoreRoomSyncConfig } from './meshcoreRoomSyncStorage';

describe('meshcoreInfraAdminSecrets', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllMeshcoreRepeaterEphemeralPasswords();
    clearAllRoomEphemeralAdminPasswords();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
  });

  it('persists repeater admin only under repeater credential prefix', async () => {
    await setAdminPassword(0x10, 'Repeater', 'rep-secret', { persist: true });
    expect(getMeshcoreRepeaterCredential(0x10)?.password).toBe('rep-secret');
    expect(getMeshcoreRoomCredential(0x10)).toBeUndefined();
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '';
    expect(raw).toContain(meshcoreRepeaterCredentialSettingForNode(0x10));
    expect(raw).not.toContain(meshcoreRoomCredentialSettingForNode(0x10));
  });

  it('persists room admin only under room credential prefix', async () => {
    await setAdminPassword(0x20, 'Room', 'room-admin', { persist: true });
    expect(getMeshcoreRoomCredential(0x20)?.adminPassword).toBe('room-admin');
    expect(getMeshcoreRepeaterCredential(0x20)).toBeUndefined();
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '';
    expect(raw).toContain(meshcoreRoomCredentialSettingForNode(0x20));
    expect(raw).not.toContain(meshcoreRepeaterCredentialSettingForNode(0x20));
  });

  it('room setAdminPassword keeps guest and sync/auto-login when patching admin', async () => {
    await setMeshcoreRoomCredential(0x30, {
      guestPassword: 'hello',
      adminPassword: 'old',
    });
    await setMeshcoreRoomSyncConfig(0x30, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    await setAdminPassword(0x30, 'Room', 'new-admin', { persist: true });
    expect(getMeshcoreRoomCredential(0x30)).toEqual({
      guestPassword: 'hello',
      adminPassword: 'new-admin',
    });
    expect(getMeshcoreRoomSyncConfig(0x30)).toMatchObject({
      enabled: true,
      autoLoginOnConnect: true,
    });
  });

  it('room forgetAdmin clears adminPassword and keeps guest + sync', async () => {
    await setMeshcoreRoomCredential(0x31, {
      guestPassword: 'hello',
      adminPassword: 'admin',
    });
    await setMeshcoreRoomSyncConfig(0x31, {
      enabled: true,
      intervalMinutes: 120,
      autoLoginOnConnect: true,
    });
    await forgetAdminPassword(0x31, 'Room');
    expect(getMeshcoreRoomCredential(0x31)).toEqual({ guestPassword: 'hello' });
    expect(getMeshcoreRoomSyncConfig(0x31)).toMatchObject({
      enabled: true,
      autoLoginOnConnect: true,
    });
  });

  it('room forgetAdmin keeps remembered blank guest password', async () => {
    await setMeshcoreRoomCredential(0x32, {
      guestPassword: '',
      adminPassword: 'admin',
    });
    await forgetAdminPassword(0x32, 'Room');
    expect(getMeshcoreRoomCredential(0x32)).toEqual({ guestPassword: '' });
  });

  it('hasResolvableAdminPassword is true for persisted room admin without BBS session', async () => {
    expect(hasResolvableAdminPassword(0x40, 'Room')).toBe(false);
    await setAdminPassword(0x40, 'Room', 'admin', { persist: true });
    expect(hasResolvableAdminPassword(0x40, 'Room')).toBe(true);
  });

  it('listSavedAdminPasswords returns mixed kinds', async () => {
    await setMeshcoreRepeaterCredential(0x11, { password: 'a' });
    await setMeshcoreRoomCredential(0x22, { guestPassword: 'g', adminPassword: 'b' });
    await setMeshcoreRoomCredential(0x33, { guestPassword: 'guest-only' });
    expect(listSavedAdminPasswords()).toEqual([
      { nodeId: 0x11, kind: 'Repeater' },
      { nodeId: 0x22, kind: 'Room' },
    ]);
  });

  it('resolveRoomAdminPassword prefers session then ephemeral then persisted', async () => {
    await setMeshcoreRoomCredential(0x50, { adminPassword: 'persisted' });
    expect(resolveRoomAdminPassword(0x50)).toBe('persisted');
    expect(resolveRoomAdminPassword(0x50, 'session')).toBe('session');
    await setAdminPassword(0x50, 'Room', 'ephemeral', { persist: false });
    expect(resolveRoomAdminPassword(0x50)).toBe('ephemeral');
  });
});
