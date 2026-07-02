import { describe, expect, it } from 'vitest';

import {
  registerReticulumDestinationHash,
  resolveReticulumDestinationHash,
  reticulumHashToNodeId,
} from './destHash';

describe('reticulumHashToNodeId', () => {
  it('folds large hashes to uint32 for chat node ids', () => {
    const nv0n = '8fd7a9361aca12360c7985bc934bdd20';
    const self = '08f5f8b12f4e4761affcbe1d293da0b0';
    expect(reticulumHashToNodeId(nv0n)).toBeLessThanOrEqual(0xffff_ffff);
    expect(reticulumHashToNodeId(self)).toBeLessThanOrEqual(0xffff_ffff);
    expect(reticulumHashToNodeId(nv0n)).toBe(parseInt('8fd7a9361aca', 16) >>> 0);
    expect(reticulumHashToNodeId(self)).toBe(parseInt('08f5f8b12f4e', 16) >>> 0);
  });

  it('registry round-trips folded node id', () => {
    const hash = '8fd7a9361aca12360c7985bc934bdd20';
    const nodeId = reticulumHashToNodeId(hash);
    registerReticulumDestinationHash(nodeId, hash);
    expect(resolveReticulumDestinationHash(nodeId)).toBe(hash);
  });
});
