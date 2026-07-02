import { describe, expect, it } from 'vitest';

import {
  buildMeshPeerTopologyGraph,
  isMeshPeerOnline,
  isMeshRelayHubCandidate,
  MESH_PEER_MAX_RELAY_HUBS,
  resolveMeshPeerRelayId,
} from './buildMeshPeerTopologyGraph';
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

  it('hides distant peers when includeDistantPeers is false', () => {
    const nodes = new Map<number, MeshNode>([
      [1, node(1, { hops_away: 0 })],
      [2, node(2, { hops_away: 1 })],
      [3, node(3, { hops_away: 4, path: [2] })],
    ]);

    const graph = buildMeshPeerTopologyGraph(nodes, {
      myNodeId: 1,
      selfLabel: 'Me',
      filter: { includeDistantPeers: false },
    });

    expect(graph.nodes.some((n) => n.nodeId === 3)).toBe(false);
    expect(graph.nodes.some((n) => n.nodeId === 2)).toBe(true);
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
});
