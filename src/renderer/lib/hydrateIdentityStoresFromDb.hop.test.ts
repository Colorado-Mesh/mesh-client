import { describe, expect, it } from 'vitest';

import { mergeMeshcoreSavedHopRowsForHydration } from './hydrateIdentityStoresFromDb';

describe('mergeMeshcoreSavedHopRowsForHydration', () => {
  it('fills hops_away from meshcore_hop_history when nodes table has no hop row', () => {
    const merged = mergeMeshcoreSavedHopRowsForHydration(
      [{ node_id: 42, hops: null, hops_away: null }],
      [{ node_id: 42, hops: 5 }],
    );
    expect(merged).toEqual([{ node_id: 42, hops: 5, hops_away: 5 }]);
  });

  it('does not overwrite existing hops from nodes table', () => {
    const merged = mergeMeshcoreSavedHopRowsForHydration(
      [{ node_id: 42, hops: 2, hops_away: 2 }],
      [{ node_id: 42, hops: 5 }],
    );
    expect(merged).toEqual([{ node_id: 42, hops: 2, hops_away: 2 }]);
  });
});
