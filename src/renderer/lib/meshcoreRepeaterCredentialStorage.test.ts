// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_SETTINGS_STORAGE_KEY } from './appSettingsStorage';
import {
  getMeshcoreRepeaterCredential,
  listMeshcoreRepeaterCredentialNodeIds,
  meshcoreRepeaterCredentialSettingForNode,
  readMeshcoreRepeaterCredentialMap,
  setMeshcoreRepeaterCredential,
} from './meshcoreRepeaterCredentialStorage';

describe('meshcoreRepeaterCredentialStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
  });

  it('persists admin password per repeater node', async () => {
    await setMeshcoreRepeaterCredential(0x1001, { password: 'secret' });
    const cred = getMeshcoreRepeaterCredential(0x1001);
    expect(cred?.password).toBe('secret');
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY)).toContain(
      meshcoreRepeaterCredentialSettingForNode(0x1001),
    );
    expect(window.electronAPI.appSettings.set).toHaveBeenCalled();
  });

  it('clears credential when set to null', async () => {
    await setMeshcoreRepeaterCredential(0x1002, { password: 'hello' });
    await setMeshcoreRepeaterCredential(0x1002, null);
    expect(getMeshcoreRepeaterCredential(0x1002)).toBeUndefined();
  });

  it('lists stored node ids and reads map', async () => {
    await setMeshcoreRepeaterCredential(0x10, { password: 'a' });
    await setMeshcoreRepeaterCredential(0x20, { password: 'b' });
    expect(listMeshcoreRepeaterCredentialNodeIds().sort((a, b) => a - b)).toEqual([0x10, 0x20]);
    expect(readMeshcoreRepeaterCredentialMap().get(0x10)?.password).toBe('a');
  });
});
