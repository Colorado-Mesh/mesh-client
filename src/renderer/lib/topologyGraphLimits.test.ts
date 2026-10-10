import { describe, expect, it } from 'vitest';

import { FORCE_REPULSION_FULL_PAIR_CAP } from './forceDirectedGraphLayout';
import {
  MESH_TOPOLOGY_NEARBY_MAX_HOPS,
  TOPOLOGY_GRAPH_DISTANT_NODE_CAP,
  TOPOLOGY_GRAPH_NEARBY_NODE_CAP,
  topologyGraphVisibleNodeCap,
  topologyPeerPassesHopFilters,
} from './topologyGraphLimits';

describe('topologyGraphLimits', () => {
  it('uses the force-layout pair cap after hop filters, even when distant peers are hidden', () => {
    expect(TOPOLOGY_GRAPH_NEARBY_NODE_CAP).toBe(48);
    expect(TOPOLOGY_GRAPH_DISTANT_NODE_CAP).toBe(FORCE_REPULSION_FULL_PAIR_CAP);
    expect(topologyGraphVisibleNodeCap()).toBe(FORCE_REPULSION_FULL_PAIR_CAP);
  });
});

describe('topologyPeerPassesHopFilters', () => {
  it('lets numeric max hops win when distant peers are off', () => {
    const meshOff = {
      includeDistantPeers: false,
      nearbyMaxHops: MESH_TOPOLOGY_NEARBY_MAX_HOPS,
    };
    expect(topologyPeerPassesHopFilters(2, { ...meshOff, maxHops: 2 })).toBe(true);
    expect(topologyPeerPassesHopFilters(4, { ...meshOff, maxHops: 2 })).toBe(false);
    expect(topologyPeerPassesHopFilters(8, { ...meshOff, maxHops: 8 })).toBe(true);
    expect(topologyPeerPassesHopFilters(4, { ...meshOff, maxHops: null })).toBe(false);
    expect(topologyPeerPassesHopFilters(1, { ...meshOff, maxHops: null })).toBe(true);
  });

  it('excludes unknown hops unless All hops and distant peers are on', () => {
    const nearby = MESH_TOPOLOGY_NEARBY_MAX_HOPS;
    expect(
      topologyPeerPassesHopFilters(null, {
        includeDistantPeers: false,
        maxHops: 2,
        nearbyMaxHops: nearby,
      }),
    ).toBe(false);
    expect(
      topologyPeerPassesHopFilters(null, {
        includeDistantPeers: true,
        maxHops: 1,
        nearbyMaxHops: nearby,
      }),
    ).toBe(false);
    expect(
      topologyPeerPassesHopFilters(null, {
        includeDistantPeers: true,
        maxHops: null,
        nearbyMaxHops: nearby,
      }),
    ).toBe(true);
  });
});
