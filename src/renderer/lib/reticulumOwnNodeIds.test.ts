import { beforeEach, describe, expect, it } from 'vitest';

import { reticulumHashToNodeId } from './reticulum/destHash';
import {
  persistReticulumSelfLxmfHash,
  RETICULUM_LAST_SELF_LXMF_HASH_LS_KEY,
} from './reticulumLastSelfLxmfHash';
import { resolveReticulumOwnNodeIdSet } from './reticulumOwnNodeIds';

describe('resolveReticulumOwnNodeIdSet', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('seeds from persisted lxmf hash before live identity', () => {
    const hash = '8fd7a9361aca12360c7985bc934bdd20';
    persistReticulumSelfLxmfHash(hash);
    const own = resolveReticulumOwnNodeIdSet({});
    expect(own).toEqual(new Set([reticulumHashToNodeId(hash)]));
  });

  it('includes live and persisted when both are known', () => {
    const persisted = '8fd7a9361aca12360c7985bc934bdd20';
    const live = '81bc0c0c5937ee0b750dbed29e744997';
    persistReticulumSelfLxmfHash(persisted);
    const own = resolveReticulumOwnNodeIdSet({ lxmfHash: live });
    expect(own).toEqual(new Set([reticulumHashToNodeId(persisted), reticulumHashToNodeId(live)]));
  });

  it('returns empty when nothing is known', () => {
    localStorage.removeItem(RETICULUM_LAST_SELF_LXMF_HASH_LS_KEY);
    expect(resolveReticulumOwnNodeIdSet({})).toEqual(new Set());
  });

  it('accepts runtime self node id', () => {
    const own = resolveReticulumOwnNodeIdSet({ runtimeSelfNodeId: 42 });
    expect(own).toEqual(new Set([42]));
  });
});
