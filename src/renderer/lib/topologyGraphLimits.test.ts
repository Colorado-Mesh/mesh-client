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
  TOPOLOGY_GRAPH_DISTANT_NODE_CAP,
  TOPOLOGY_GRAPH_NEARBY_NODE_CAP,
  topologyGraphVisibleNodeCap,
} from './topologyGraphLimits';

describe('topologyGraphLimits', () => {
  it('uses 48 nearby and the force-layout pair cap when distant peers are shown', () => {
    expect(TOPOLOGY_GRAPH_NEARBY_NODE_CAP).toBe(48);
    expect(TOPOLOGY_GRAPH_DISTANT_NODE_CAP).toBe(FORCE_REPULSION_FULL_PAIR_CAP);
    expect(topologyGraphVisibleNodeCap(false)).toBe(48);
    expect(topologyGraphVisibleNodeCap(true)).toBe(FORCE_REPULSION_FULL_PAIR_CAP);
  });

  it('is shared by mesh and Reticulum builders with no leftover 90-node cap', () => {
    expect(MESH_PEER_MAX_VISIBLE_NODES).toBe(TOPOLOGY_GRAPH_NEARBY_NODE_CAP);
    expect(MESH_PEER_MAX_VISIBLE_NODES_UNFILTERED).toBe(TOPOLOGY_GRAPH_DISTANT_NODE_CAP);
    expect(RETICULUM_TOPOLOGY_NEARBY_NODE_CAP).toBe(TOPOLOGY_GRAPH_NEARBY_NODE_CAP);
    expect(RETICULUM_TOPOLOGY_DISTANT_NODE_CAP).toBe(TOPOLOGY_GRAPH_DISTANT_NODE_CAP);
    expect(RETICULUM_TOPOLOGY_NEARBY_NODE_CAP).not.toBe(90);
  });
});
