import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearMeshcorePubKeyRegistry,
  getMeshcorePubKey,
  meshcorePubKeyRegistrySize,
  registerMeshcorePubKey,
  resolveMeshcoreNodeIdFromPubKeyPrefix,
  seedMeshcorePrefixLookupMaps,
  setMeshcorePubKeyRegistryRefSync,
} from './meshcorePubKeyRegistry';

describe('meshcorePubKeyRegistry', () => {
  beforeEach(() => {
    setMeshcorePubKeyRegistryRefSync(null);
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

  it('notifies ref sync after register and clear', () => {
    const sync = vi.fn();
    setMeshcorePubKeyRegistryRefSync(sync);
    const pk = new Uint8Array(32).fill(7);
    registerMeshcorePubKey(0xabcd, pk);
    expect(sync).toHaveBeenCalledTimes(1);
    clearMeshcorePubKeyRegistry();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('seeds per-subscription prefix maps from the global registry', () => {
    const pk = new Uint8Array(32).fill(9);
    registerMeshcorePubKey(0xbeef, pk);
    const prefixByHex = new Map<string, number>();
    const pubKeyByNodeId = new Map<number, Uint8Array>();
    seedMeshcorePrefixLookupMaps(prefixByHex, pubKeyByNodeId);
    const prefix = Array.from(pk.slice(0, 6))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(prefixByHex.get(prefix)).toBe(0xbeef);
    expect(pubKeyByNodeId.get(0xbeef)).toEqual(pk);
  });
});
