import { describe, expect, it } from 'vitest';

import { MESH_PEER_MAX_VISIBLE_NODES_UNFILTERED } from './buildMeshPeerTopologyGraph';
import { FORCE_REPULSION_FULL_PAIR_CAP } from './forceDirectedGraphLayout';
import { RETICULUM_TOPOLOGY_DISTANT_NODE_CAP } from './reticulum/buildReticulumTopologyLayout';
import {
  TOPOLOGY_GRAPH_DISTANT_NODE_CAP,
  topologyGraphVisibleNodeCap,
  topologyHopFilterOptions,
  topologyPeerPassesHopFilters,
} from './topologyGraphLimits';

describe('topologyGraphLimits', () => {
  it('uses a 1000 visible-node budget independent of the force full-pair switch', () => {
    expect(TOPOLOGY_GRAPH_DISTANT_NODE_CAP).toBe(1000);
    expect(TOPOLOGY_GRAPH_DISTANT_NODE_CAP).not.toBe(FORCE_REPULSION_FULL_PAIR_CAP);
    expect(FORCE_REPULSION_FULL_PAIR_CAP).toBe(400);
    expect(topologyGraphVisibleNodeCap()).toBe(1000);
  });

  it('is shared by mesh and Reticulum builders', () => {
    expect(MESH_PEER_MAX_VISIBLE_NODES_UNFILTERED).toBe(TOPOLOGY_GRAPH_DISTANT_NODE_CAP);
    expect(RETICULUM_TOPOLOGY_DISTANT_NODE_CAP).toBe(TOPOLOGY_GRAPH_DISTANT_NODE_CAP);
  });

  it('builds Meshtastic and MeshCore hop-filter presets from hopLimitRange max', () => {
    expect(topologyHopFilterOptions(7)).toEqual([1, 2, 3, 5, 7]);
    expect(topologyHopFilterOptions(64)).toEqual([1, 2, 3, 5, 8, 16, 32, 64]);
    expect(topologyHopFilterOptions(128)).toEqual([1, 2, 3, 5, 8, 16, 32, 64]);
  });
});

describe('topologyPeerPassesHopFilters', () => {
  it('applies numeric max hops', () => {
    expect(topologyPeerPassesHopFilters(2, 2)).toBe(true);
    expect(topologyPeerPassesHopFilters(4, 2)).toBe(false);
    expect(topologyPeerPassesHopFilters(8, 8)).toBe(true);
    expect(topologyPeerPassesHopFilters(16, 8)).toBe(false);
  });

  it('includes multi-hop and unknown hops when Show all (maxHops null)', () => {
    expect(topologyPeerPassesHopFilters(1, null)).toBe(true);
    expect(topologyPeerPassesHopFilters(4, null)).toBe(true);
    expect(topologyPeerPassesHopFilters(64, null)).toBe(true);
    expect(topologyPeerPassesHopFilters(null, null)).toBe(true);
    expect(topologyPeerPassesHopFilters(undefined, null)).toBe(true);
  });

  it('excludes unknown hops when max hops is numeric', () => {
    expect(topologyPeerPassesHopFilters(null, 2)).toBe(false);
    expect(topologyPeerPassesHopFilters(undefined, 1)).toBe(false);
  });
});
