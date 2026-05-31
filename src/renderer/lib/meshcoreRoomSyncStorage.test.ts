import { beforeEach, describe, expect, it } from 'vitest';

import { getAppSettingsRaw, mergeAppSetting } from './appSettingsStorage';
import {
  getMeshcoreRoomSyncConfig,
  listMeshcoreRoomAutoLoginOnConnectNodeIds,
  meshcoreRoomSyncSettingForNode,
  setMeshcoreRoomSyncConfig,
} from './meshcoreRoomSyncStorage';

describe('meshcoreRoomSyncStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults autoLoginOnConnect to false', () => {
    expect(getMeshcoreRoomSyncConfig(99).autoLoginOnConnect).toBe(false);
  });

  it('persists autoLoginOnConnect in sync config blob', async () => {
    await setMeshcoreRoomSyncConfig(42, {
      enabled: false,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    expect(getMeshcoreRoomSyncConfig(42).autoLoginOnConnect).toBe(true);
    expect(listMeshcoreRoomAutoLoginOnConnectNodeIds()).toEqual([42]);
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
