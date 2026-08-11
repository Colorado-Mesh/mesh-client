import { describe, expect, it } from 'vitest';

import {
  MESH_PEER_MAX_VISIBLE_NODES,
  MESH_PEER_MAX_VISIBLE_NODES_UNFILTERED,
} from './buildMeshPeerTopologyGraph';
import { FORCE_REPULSION_FULL_PAIR_CAP } from './forceDirectedGraphLayout';
import {
  RETICULUM_TOPOLOGY_DISTANT_NODE_CAP,
  RETICULUM_TOPOLOGY_NEARBY_NODE_CAP,
} from './reticulum/buildReticulumTopologyLayout';
import {
  MESH_TOPOLOGY_NEARBY_MAX_HOPS,
  RETICULUM_TOPOLOGY_NEARBY_MAX_HOPS,
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

  it('is shared by mesh and Reticulum builders with no leftover 90-node cap', () => {
    expect(MESH_PEER_MAX_VISIBLE_NODES).toBe(TOPOLOGY_GRAPH_NEARBY_NODE_CAP);
    expect(MESH_PEER_MAX_VISIBLE_NODES_UNFILTERED).toBe(TOPOLOGY_GRAPH_DISTANT_NODE_CAP);
    expect(RETICULUM_TOPOLOGY_NEARBY_NODE_CAP).toBe(TOPOLOGY_GRAPH_NEARBY_NODE_CAP);
    expect(RETICULUM_TOPOLOGY_DISTANT_NODE_CAP).toBe(TOPOLOGY_GRAPH_DISTANT_NODE_CAP);
    expect(RETICULUM_TOPOLOGY_NEARBY_NODE_CAP).not.toBe(90);
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

  it('uses the RNS nearby ceiling of 2 only when max hops is all', () => {
    const rnsOff = {
      includeDistantPeers: false,
      nearbyMaxHops: RETICULUM_TOPOLOGY_NEARBY_MAX_HOPS,
    };
    expect(topologyPeerPassesHopFilters(2, { ...rnsOff, maxHops: null })).toBe(true);
    expect(topologyPeerPassesHopFilters(3, { ...rnsOff, maxHops: null })).toBe(false);
    expect(topologyPeerPassesHopFilters(4, { ...rnsOff, maxHops: 8 })).toBe(true);
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
