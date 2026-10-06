import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import { meshcoreRoomCredentialSettingForNode } from './meshcoreRoomCredentialStorage';
import {
  getMeshcoreRoomSyncConfig,
  listMeshcoreRoomAutoLoginOnConnectNodeIds,
  meshcoreRoomSyncSettingForNode,
  setMeshcoreRoomSyncConfig,
} from './meshcoreRoomSyncStorage';
import { mockConsoleWarn } from './vitestConsoleMock';

describe('meshcoreRoomSyncStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults autoLoginOnConnect to false without saved password', () => {
    expect(getMeshcoreRoomSyncConfig(99).autoLoginOnConnect).toBe(false);
  });

  it('defaults autoLoginOnConnect to true when room password is saved', () => {
    mergeAppSetting(
      meshcoreRoomCredentialSettingForNode(55),
      JSON.stringify({ guestPassword: 'hello' }),
      'meshcoreRoomSyncStorage.test cred',
    );
    expect(getMeshcoreRoomSyncConfig(55).autoLoginOnConnect).toBe(true);
    expect(listMeshcoreRoomAutoLoginOnConnectNodeIds()).toContain(55);
  });

  it('persists autoLoginOnConnect in sync config blob', async () => {
    await setMeshcoreRoomSyncConfig(42, {
      enabled: false,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    expect(getMeshcoreRoomSyncConfig(42).autoLoginOnConnect).toBe(true);
    expect(listMeshcoreRoomAutoLoginOnConnectNodeIds()).toEqual([]);
    mergeAppSetting(
      meshcoreRoomCredentialSettingForNode(42),
      JSON.stringify({ guestPassword: 'secret' }),
      'meshcoreRoomSyncStorage.test cred',
    );
    expect(listMeshcoreRoomAutoLoginOnConnectNodeIds()).toEqual([42]);
  });

  it('rolls back the local sync config when persisting fails', async () => {
    const key = meshcoreRoomSyncSettingForNode(31);
    const before = JSON.stringify({
      enabled: false,
      intervalMinutes: 60,
      lastSyncAt: null,
      autoLoginOnConnect: false,
    });
    mergeAppSetting(key, before, 'meshcoreRoomSyncStorage.test rollback');
    const setSpy = vi
      .spyOn(window.electronAPI.appSettings, 'set')
      .mockRejectedValueOnce(new Error('disk full'));
    const warn = mockConsoleWarn();
    try {
      await expect(
        setMeshcoreRoomSyncConfig(31, {
          enabled: false,
          intervalMinutes: 60,
          autoLoginOnConnect: true,
        }),
      ).rejects.toThrow('disk full');
      expect(getMeshcoreRoomSyncConfig(31).autoLoginOnConnect).toBe(false);
      expect((JSON.parse(getAppSettingsRaw() ?? '{}') as Record<string, unknown>)[key]).toBe(
        before,
      );
    } finally {
      warn.restore();
      setSpy.mockRestore();
    }
  });

  it('removes a never-persisted sync config key when persisting fails', async () => {
    const key = meshcoreRoomSyncSettingForNode(32);
    const setSpy = vi
      .spyOn(window.electronAPI.appSettings, 'set')
      .mockRejectedValueOnce(new Error('disk full'));
    const warn = mockConsoleWarn();
    try {
      await expect(
        setMeshcoreRoomSyncConfig(32, {
          enabled: true,
          intervalMinutes: 60,
          autoLoginOnConnect: true,
        }),
      ).rejects.toThrow('disk full');
      expect(
        Object.prototype.hasOwnProperty.call(JSON.parse(getAppSettingsRaw() ?? '{}'), key),
      ).toBe(false);
    } finally {
      warn.restore();
      setSpy.mockRestore();
    }
  });

  it('does not let an earlier failed save roll back a newer local update', async () => {
    const key = meshcoreRoomSyncSettingForNode(33);
    let rejectFirst: (e: Error) => void = () => {};
    const setSpy = vi
      .spyOn(window.electronAPI.appSettings, 'set')
      .mockImplementationOnce(
        () =>
          new Promise<{ changes: number }>((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce({ changes: 1 });
    const warn = mockConsoleWarn();
    try {
      const first = setMeshcoreRoomSyncConfig(33, {
        enabled: false,
        intervalMinutes: 60,
        autoLoginOnConnect: true,
      });
      await setMeshcoreRoomSyncConfig(33, {
        enabled: true,
        intervalMinutes: 120,
        autoLoginOnConnect: false,
      });
      const newer = (JSON.parse(getAppSettingsRaw() ?? '{}') as Record<string, unknown>)[key];
      rejectFirst(new Error('disk full'));
      await expect(first).rejects.toThrow('disk full');
      expect((JSON.parse(getAppSettingsRaw() ?? '{}') as Record<string, unknown>)[key]).toBe(newer);
      expect(getMeshcoreRoomSyncConfig(33)).toMatchObject({
        enabled: true,
        intervalMinutes: 120,
        autoLoginOnConnect: false,
      });
    } finally {
      warn.restore();
      setSpy.mockRestore();
    }
  });

  it('parses autoLoginOnConnect from stored JSON', () => {
    mergeAppSetting(
      meshcoreRoomSyncSettingForNode(7),
      JSON.stringify({
        enabled: true,
        intervalMinutes: 120,
        lastSyncAt: null,
        autoLoginOnConnect: true,
      }),
      'meshcoreRoomSyncStorage.test',
    );
    const raw = getAppSettingsRaw();
    expect(raw).toContain('autoLoginOnConnect');
    expect(getMeshcoreRoomSyncConfig(7).autoLoginOnConnect).toBe(true);
  });
});
