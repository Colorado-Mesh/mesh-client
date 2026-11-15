import { describe, expect, it } from 'vitest';

import {
  buildMeshPeerTopologyGraph,
  isMeshPeerOnline,
  isMeshRelayHubCandidate,
  MESH_PEER_MAX_RELAY_HUBS,
  MESH_PEER_MAX_VISIBLE_NODES_UNFILTERED,
  resolveMeshPeerRelayId,
} from './buildMeshPeerTopologyGraph';
import { FORCE_REPULSION_FULL_PAIR_CAP } from './forceDirectedGraphLayout';
import { TOPOLOGY_GRAPH_DISTANT_NODE_CAP } from './topologyGraphLimits';
import type { MeshNode } from './types';

function node(id: number, overrides: Partial<MeshNode> = {}): MeshNode {
  return {
    node_id: id,
    long_name: `Node ${id}`,
    short_name: `N${id}`,
    hw_model: 'T-Beam',
    snr: 5,
    battery: 80,
    last_heard: Date.now(),
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

describe('buildMeshPeerTopologyGraph', () => {
  it('places direct neighbors on relay spokes from self with distant peers hung off relays', () => {
    const nodes = new Map<number, MeshNode>([
      [0x1111, node(0x1111, { hops_away: 0 })],
      [0x2222, node(0x2222, { hops_away: 1 })],
      [0x3333, node(0x3333, { hops_away: 3, path: [0x2222, 0x3333] })],
    ]);

    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 0x1111,
      selfLabel: 'Me',
    });

    expect(graph.nodes.find((n) => n.kind === 'self')?.label).toBe('Me');
    expect(graph.nodes.some((n) => n.nodeId === 0x2222 && n.kind === 'relay')).toBe(true);
    expect(graph.nodes.some((n) => n.nodeId === 0x3333 && n.kind === 'peer')).toBe(true);
    expect(
      graph.edges.some(
        (e) => e.source === String(0x1111) && e.target === String(0x2222) && e.kind === 'direct',
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (e) => e.source === String(0x2222) && e.target === String(0x3333) && e.kind === 'relay',
      ),
    ).toBe(true);
  });

  it('respects maxHops filter', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, { hops_away: 0 })],
      [2, node(2, { hops_away: 2 })],
      [3, node(3, { hops_away: 5 })],
    ]);

    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: 2 },
    });

    expect(graph.nodes.some((n) => n.nodeId === 2)).toBe(true);
    expect(graph.nodes.some((n) => n.nodeId === 3)).toBe(false);
  });

  it('falls back to self when distant peer has no known relay', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, { hops_away: 0 })],
      [9, node(9, { hops_away: 4 })],
    ]);

    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
    });

    expect(
      graph.edges.some((e) => e.source === '1' && e.target === '9' && e.kind === 'relay'),
    ).toBe(true);
  });

  it('does not promote hop-filtered path relays back into the hub ring', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, { hops_away: 0 })],
      // Filtered out by maxHops: 2, but still referenced as a path hop.
      [2, node(2, { hops_away: 5 })],
      [3, node(3, { hops_away: 2, path: [2, 3] })],
    ]);

    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: 2 },
    });

    expect(graph.nodes.some((n) => n.nodeId === 2)).toBe(false);
    expect(graph.nodes.some((n) => n.nodeId === 3 && n.kind === 'peer')).toBe(true);
    expect(
      graph.edges.some((e) => e.source === '1' && e.target === '3' && e.kind === 'relay'),
    ).toBe(true);
  });

  it('does not emit a multi-hop hub as both relay and peer', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, { hops_away: 0 })],
      [4, node(4, { hops_away: 2 })],
      [5, node(5, { hops_away: 3, path: [4, 5] })],
    ]);

    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: null },
    });

    const matches = graph.nodes.filter((n) => n.nodeId === 4);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe('relay');
    expect(graph.nodes.some((n) => n.nodeId === 5 && n.kind === 'peer')).toBe(true);
  });

  it('caps relay hubs and demotes MQTT-only direct peers to compact leaves', () => {
    const nodes = new Map<number, MeshNode>([[1, node(1, { hops_away: 0 })]]);
    for (let i = 2; i <= 40; i++) {
      nodes.set(
        i,
        node(i, {
          hops_away: 0,
          source: 'mqtt',
          heard_via_mqtt_only: true,
        }),
      );
    }

    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
    });

    expect(graph.relayCount).toBeLessThanOrEqual(MESH_PEER_MAX_RELAY_HUBS);
    expect(graph.demotedDirectCount).toBeGreaterThan(0);
    const thickSpokes = graph.edges.filter((e) => e.source === '1' && e.kind === 'direct').length;
    expect(thickSpokes).toBeLessThanOrEqual(MESH_PEER_MAX_RELAY_HUBS);
  });
});

describe('isMeshRelayHubCandidate', () => {
  it('promotes relays with distant children or RF evidence', () => {
    expect(isMeshRelayHubCandidate(node(1, { source: 'mqtt', heard_via_mqtt_only: true }), 2)).toBe(
      true,
    );
    expect(isMeshRelayHubCandidate(node(2, { source: 'mqtt', heard_via_mqtt_only: true }), 0)).toBe(
      false,
    );
    expect(isMeshRelayHubCandidate(node(3, { source: 'rf', heard_via_mqtt_only: false }), 0)).toBe(
      true,
    );
  });
});

describe('resolveMeshPeerRelayId', () => {
  it('uses the first known hop in path', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1)],
      [2, node(2, { hops_away: 1 })],
      [3, node(3, { hops_away: 3, path: [2, 3] })],
    ]);
    expect(resolveMeshPeerRelayId(nodes.get(3)!, nodes, 1)).toBe(2);
  });

  it('uses neighbor reverse lookup when path is missing', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1)],
      [2, node(2, { hops_away: 1, neighbors: [{ nodeId: 3, snr: 4, lastRxTime: 1 }] })],
      [3, node(3, { hops_away: 2 })],
    ]);
    expect(resolveMeshPeerRelayId(nodes.get(3)!, nodes, 1)).toBe(2);
  });
});

describe('isMeshPeerOnline', () => {
  it('treats nodes with hop data as online', () => {
    expect(isMeshPeerOnline(node(1, { hops_away: 2, last_heard: 0 }))).toBe(true);
  });

  it('treats recently heard nodes as online', () => {
    expect(isMeshPeerOnline(node(1, { last_heard: Date.now() - 1000 }))).toBe(true);
  });

  it('treats sec-valued last_heard from DB hydration as recently heard', () => {
    const nowMs = Date.now();
    const secHeard = Math.floor((nowMs - 30 * 60_000) / 1000);
    expect(isMeshPeerOnline(node(1, { last_heard: secHeard }), nowMs)).toBe(true);
  });
});

function peerMap(peerCount: number, hopsAway: number | undefined): Map<number, MeshNode> {
  const nodes = new Map<number, MeshNode>([[1, node(1, { hops_away: 0 })]]);
  for (let i = 2; i <= peerCount + 1; i++) {
    nodes.set(i, node(i, hopsAway === undefined ? {} : { hops_away: hopsAway }));
  }
  return nodes;
}

describe('buildMeshPeerTopologyGraph filter/cap matrix', () => {
  it('re-exports the shared visible cap independent of the force full-pair switch', () => {
    expect(MESH_PEER_MAX_VISIBLE_NODES_UNFILTERED).toBe(TOPOLOGY_GRAPH_DISTANT_NODE_CAP);
    expect(MESH_PEER_MAX_VISIBLE_NODES_UNFILTERED).toBe(1000);
    expect(MESH_PEER_MAX_VISIBLE_NODES_UNFILTERED).not.toBe(FORCE_REPULSION_FULL_PAIR_CAP);
  });

  it('shows all 168 nodes when Show all', () => {
    const graph = buildMeshPeerTopologyGraph(peerMap(167, 1), {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: null },
    });
    expect(graph.nodes).toHaveLength(168);
    expect(graph.hiddenCount).toBe(0);
  });

  it.each([
    { peers: 998, hidden: 0 },
    { peers: 999, hidden: 0 },
    { peers: 1000, hidden: 1 },
    { peers: 1001, hidden: 2 },
  ])('visible cap: $peers peers → hidden $hidden', ({ peers, hidden }) => {
    const graph = buildMeshPeerTopologyGraph(peerMap(peers, 1), {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: null },
    });
    expect(graph.hiddenCount).toBe(hidden);
    expect(graph.nodes).toHaveLength(Math.min(peers + 1, MESH_PEER_MAX_VISIBLE_NODES_UNFILTERED));
  });

  it('changes visible count across maxHops 1, 2, 8, and Show all', () => {
    const nodes = new Map<number, MeshNode>([[1, node(1, { hops_away: 0 })]]);
    let id = 2;
    for (let i = 0; i < 30; i++, id++) nodes.set(id, node(id, { hops_away: 1 }));
    for (let i = 0; i < 40; i++, id++) nodes.set(id, node(id, { hops_away: 2 }));
    for (let i = 0; i < 80; i++, id++) nodes.set(id, node(id, { hops_away: 3 }));
    for (let i = 0; i < 50; i++, id++) nodes.set(id, node(id, { hops_away: 5 }));

    const counts = ([1, 2, 8, null] as const).map(
      (maxHops) =>
        buildMeshPeerTopologyGraph(nodes, {
          myNodeId: 1,
          selfLabel: 'Me',
          filter: { maxHops },
        }).nodes.length,
    );
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(counts[2]).toBe(counts[3]);
  });

  it('excludes unknown hops when maxHops is numeric', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, { hops_away: 0 })],
      [2, node(2, { hops_away: 2 })],
      [3, node(3)],
    ]);
    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: 2 },
    });
    expect(graph.nodes.some((n) => n.nodeId === 3)).toBe(false);
    expect(graph.nodes.some((n) => n.nodeId === 2)).toBe(true);
  });

  it('includes unknown hops when Show all', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, { hops_away: 0 })],
      [3, node(3)],
    ]);
    const shown = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: null },
    });
    expect(shown.nodes.some((n) => n.nodeId === 3)).toBe(true);
  });

  it('shows multi-hop peers when Show all without a distant-peers checkbox', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, { hops_away: 0 })],
      [2, node(2, { hops_away: 1 })],
      [3, node(3, { hops_away: 4 })],
    ]);
    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: null },
    });
    expect(graph.nodes.some((n) => n.nodeId === 3)).toBe(true);
    expect(graph.nodes.some((n) => n.nodeId === 2)).toBe(true);
  });

  it('applies Graph default max hops 2', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, { hops_away: 0 })],
      [2, node(2, { hops_away: 1 })],
      [3, node(3, { hops_away: 2 })],
      [4, node(4, { hops_away: 5 })],
    ]);
    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: 2 },
    });
    expect(graph.nodes.some((n) => n.nodeId === 3)).toBe(true);
    expect(graph.nodes.some((n) => n.nodeId === 4)).toBe(false);
  });

  it('changes visible count across numeric maxHops', () => {
    const nodes = new Map<number, MeshNode>([[1, node(1, { hops_away: 0 })]]);
    let id = 2;
    for (let i = 0; i < 10; i++, id++) nodes.set(id, node(id, { hops_away: 1 }));
    for (let i = 0; i < 10; i++, id++) nodes.set(id, node(id, { hops_away: 2 }));
    for (let i = 0; i < 10; i++, id++) nodes.set(id, node(id, { hops_away: 5 }));

    const counts = ([1, 2, 8] as const).map(
      (maxHops) =>
        buildMeshPeerTopologyGraph(nodes, {
          myNodeId: 1,
          selfLabel: 'Me',
          filter: { maxHops },
        }).nodes.length,
    );
    expect(counts[0]).toBe(11);
    expect(counts[1]).toBe(21);
    expect(counts[2]).toBe(31);
  });

  it('keeps lowest-hop peers when the visible cap slices', () => {
    const nodes = new Map<number, MeshNode>([[1, node(1, { hops_away: 0 })]]);
    for (let i = 2; i <= 1002; i++) {
      nodes.set(i, node(i, { hops_away: i <= 501 ? 1 : 8 }));
    }
    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: null },
    });
    expect(graph.hiddenCount).toBeGreaterThan(0);
    const hop1Ids = [...nodes.values()].filter((n) => n.hops_away === 1).map((n) => n.node_id);
    const visible = new Set(graph.nodes.map((n) => n.nodeId));
    expect(hop1Ids.every((id) => visible.has(id))).toBe(true);
    expect(graph.nodes.some((n) => n.hops === 8)).toBe(true);
  });

  it('shows 100 MQTT 0-hop nodes under the visible cap', () => {
    const nodes = new Map<number, MeshNode>([[1, node(1, { hops_away: 0 })]]);
    for (let i = 2; i <= 101; i++) {
      nodes.set(i, node(i, { hops_away: 0, source: 'mqtt', heard_via_mqtt_only: true }));
    }
    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { maxHops: null },
    });
    expect(graph.nodes).toHaveLength(101);
    expect(graph.hiddenCount).toBe(0);
  });
});
