import { describe, expect, it } from 'vitest';

import { resolveMeshcoreOwnNodeIdSet } from './meshcoreOwnNodeIds';

describe('resolveMeshcoreOwnNodeIdSet', () => {
  it('uses runtime self node id when connected', () => {
    expect(resolveMeshcoreOwnNodeIdSet({ runtimeSelfNodeId: 0xabc })).toEqual(new Set([0xabc]));
  });

  it('falls back to identity selfNodeNum before connect', () => {
    expect(
      resolveMeshcoreOwnNodeIdSet({
        runtimeSelfNodeId: 0,
        identitySelfNodeNum: 0x553d0a28,
      }),
    ).toEqual(new Set([0x553d0a28]));
  });

  it('falls back to persisted self node id', () => {
    expect(
      resolveMeshcoreOwnNodeIdSet({
        runtimeSelfNodeId: 0,
        persistedSelfNodeId: 0xabc,
      }),
    ).toEqual(new Set([0xabc]));
  });

  it('merges runtime and persisted ids without duplicates', () => {
    expect(
      resolveMeshcoreOwnNodeIdSet({
        runtimeSelfNodeId: 0xabc,
        connectionMyNodeNum: 0xabc,
        identitySelfNodeNum: 0xdef,
      }),
    ).toEqual(new Set([0xabc, 0xdef]));
  });
});
