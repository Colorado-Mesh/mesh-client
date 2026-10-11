// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getMeshcoreRepeaterCredential,
  listMeshcoreRepeaterCredentialNodeIds,
  readMeshcoreRepeaterCredentialMap,
  setMeshcoreRepeaterCredential,
} from './meshcoreRepeaterCredentialStorage';
import {
  getCachedSecureSecret,
  meshcoreRepeaterSecretKey,
  resetSecureSecretCacheForTests,
} from './secureSecretStorage';

describe('meshcoreRepeaterCredentialStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSecureSecretCacheForTests();
  });

  it('persists admin password per repeater node', async () => {
    await setMeshcoreRepeaterCredential(0x1001, { password: 'secret' });
    const cred = getMeshcoreRepeaterCredential(0x1001);
    expect(cred?.password).toBe('secret');
    expect(getCachedSecureSecret(meshcoreRepeaterSecretKey(0x1001))).toContain('secret');
    expect(localStorage.length).toBe(0);
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
