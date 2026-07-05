// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMeshcoreRepeaterCredential,
  setMeshcoreRepeaterCredential,
} from './meshcoreRepeaterCredentialStorage';
import {
  forgetMeshcoreRepeaterSavedSecret,
  getMeshcoreRepeaterSavedSecretsSummary,
} from './meshcoreRepeaterSavedSecrets';
import {
  clearAllMeshcoreRepeaterEphemeralPasswords,
  setMeshcoreRepeaterEphemeralPassword,
} from './meshcoreRepeaterSession';

describe('meshcoreRepeaterSavedSecrets', () => {
  beforeEach(() => {
    localStorage.clear();
    clearAllMeshcoreRepeaterEphemeralPasswords();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
  });

  it('summarizes credential presence', async () => {
    expect(getMeshcoreRepeaterSavedSecretsSummary(0x10)).toEqual({ hasCredential: false });
    await setMeshcoreRepeaterCredential(0x10, { password: 'secret' });
    expect(getMeshcoreRepeaterSavedSecretsSummary(0x10)).toEqual({ hasCredential: true });
  });

  it('forget clears persisted and ephemeral passwords', async () => {
    await setMeshcoreRepeaterCredential(0x11, { password: 'hello' });
    setMeshcoreRepeaterEphemeralPassword(0x11, 'temp');
    await forgetMeshcoreRepeaterSavedSecret(0x11);
    expect(getMeshcoreRepeaterCredential(0x11)).toBeUndefined();
  });
});
