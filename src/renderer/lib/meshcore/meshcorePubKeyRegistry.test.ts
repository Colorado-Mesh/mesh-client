import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearMeshcorePubKeyRegistry,
  getMeshcorePubKey,
  meshcorePubKeyRegistrySize,
  registerMeshcorePubKey,
  resolveMeshcoreNodeIdFromPubKeyPrefix,
} from './meshcorePubKeyRegistry';

describe('meshcorePubKeyRegistry', () => {
  beforeEach(() => {
    clearMeshcorePubKeyRegistry();
  });

  it('registers pubkey and resolves by prefix', () => {
    const pk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) pk[i] = i;
    registerMeshcorePubKey(0x1234, pk);
    expect(meshcorePubKeyRegistrySize()).toBe(1);
    expect(getMeshcorePubKey(0x1234)).toEqual(pk);
    const prefix = Array.from(pk.slice(0, 6))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(resolveMeshcoreNodeIdFromPubKeyPrefix(prefix)).toBe(0x1234);
  });
});
