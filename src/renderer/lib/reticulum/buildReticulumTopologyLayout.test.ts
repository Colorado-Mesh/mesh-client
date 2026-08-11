import { describe, expect, it } from 'vitest';

import {
  buildReticulumMeshTopologyGraph,
  buildReticulumTopologyGraph,
  buildReticulumTopologyLayout,
  buildReticulumViaHashEdges,
  computeReticulumNodeDepths,
  countRelayTargets,
  filterReticulumVisibleNodeIds,
  interfaceNodeId,
  isReticulumHubNode,
  isReticulumInterfaceOnline,
  isReticulumPeerOnline,
  matchPeerToInterfaceId,
  mergeReticulumTopologyEdgeNodes,
  RETICULUM_TOPOLOGY_DISTANT_NODE_CAP,
  RETICULUM_TOPOLOGY_NEARBY_NODE_CAP,
  shouldUseReticulumStarFallbackEdges,
} from './buildReticulumTopologyLayout';

const sampleInterfaces = [
  { id: 'tcp-east', name: 'RNS_Transport_US-East', enabled: true, status: 'up' },
  { id: 'eth0', name: 'dude.eth', enabled: true, status: 'down' },
];

describe('buildReticulumMeshTopologyGraph', () => {
  it('places configured interfaces on spokes from self with peer children', () => {
    const graph = buildReticulumMeshTopologyGraph(
      sampleInterfaces,
      [
        {
          destination_hash: 'peeraaaa',
          display_name: 'Mother',
          hops: 2,
          interface: 'RNS_Transport_US-East',
        },
        {
          destination_hash: 'peerbbbb',
          display_name: 'D20Ph1',
          hops: 1,
          interface: 'dude.eth',
        },
      ],
      { selfLabel: 'NV0N', unassignedInterfaceLabel: 'Other paths' },
    );

    expect(graph.nodes.find((n) => n.id === 'self')?.label).toBe('NV0N');
    expect(graph.nodes.some((n) => n.id === interfaceNodeId('tcp-east'))).toBe(true);
    expect(graph.nodes.find((n) => n.id === interfaceNodeId('tcp-east'))?.label).toBe(
      'RNS_Transport_US-East',
    );
    expect(
      graph.edges.some(
        (e) =>
          e.source === 'self' && e.target === interfaceNodeId('tcp-east') && e.kind === 'direct',
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (e) =>
          e.source === interfaceNodeId('tcp-east') && e.target === 'peeraaaa' && e.kind === 'relay',
      ),
    ).toBe(true);
    expect(graph.nodes.find((n) => n.id === 'peeraaaa')?.kind).toBe('peer');
  });

  it('marks interface online/offline from enabled and status', () => {
    const graph = buildReticulumMeshTopologyGraph(sampleInterfaces, [], {
      selfLabel: 'You',
      unassignedInterfaceLabel: 'Other paths',
    });
    expect(graph.nodes.find((n) => n.id === interfaceNodeId('tcp-east'))?.online).toBe(true);
    expect(graph.nodes.find((n) => n.id === interfaceNodeId('eth0'))?.online).toBe(false);
  });

  it('routes unmatched peers through unassigned interface bucket', () => {
    const graph = buildReticulumMeshTopologyGraph(
      sampleInterfaces,
      [{ destination_hash: 'orphan', hops: 1, interface: 'unknown_iface' }],
      { selfLabel: 'You', unassignedInterfaceLabel: 'Other paths' },
    );
    expect(graph.nodes.some((n) => n.id === interfaceNodeId('__unassigned__'))).toBe(true);
    expect(
      graph.edges.some(
        (e) => e.source === interfaceNodeId('__unassigned__') && e.target === 'orphan',
      ),
    ).toBe(true);
  });

  it('classifies nomad hashes as server peers', () => {
    const graph = buildReticulumMeshTopologyGraph(
      sampleInterfaces,
      [{ destination_hash: 'nomad01', hops: 1, interface: 'dude.eth' }],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        serverPeerHashes: new Set(['nomad01']),
      },
    );
    expect(graph.nodes.find((n) => n.id === 'nomad01')?.peerKind).toBe('server');
  });
});

const rnodeIface = {
  id: 'rnode-1',
  name: 'RNode 41F4',
  type: 'rnode',
  enabled: true,
  status: 'up',
};
const tcpIface = {
  id: 'tcp-east',
  name: 'RNS_Transport_US-East',
  type: 'tcp',
  enabled: true,
  status: 'up',
};

function rfPeers(
  count: number,
  hops: number,
): { destination_hash: string; hops: number; interface: string }[] {
  return Array.from({ length: count }, (_, i) => ({
    destination_hash: `rf${i.toString(16).padStart(8, '0')}`,
    hops,
    interface: 'RNode 41F4',
  }));
}

describe('buildReticulumMeshTopologyGraph filter/cap matrix', () => {
  it('shows 168 peers when distant is on and under the distant cap', () => {
    const graph = buildReticulumMeshTopologyGraph(
      sampleInterfaces,
      rfPeers(167, 1).map((p) => ({
        ...p,
        interface: 'RNS_Transport_US-East',
      })),
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { includeDistantPeers: true, maxHops: null },
      },
    );
    expect(graph.hiddenCount).toBe(0);
    expect(graph.nodes.filter((n) => n.kind === 'peer')).toHaveLength(167);
  });

  it('caps nearby graphs at 48 total nodes including interface hubs', () => {
    const graph = buildReticulumMeshTopologyGraph([rnodeIface], rfPeers(80, 1), {
      selfLabel: 'You',
      unassignedInterfaceLabel: 'Other paths',
      filter: { includeDistantPeers: false },
    });
    expect(graph.nodes.length).toBeLessThanOrEqual(RETICULUM_TOPOLOGY_NEARBY_NODE_CAP);
    expect(graph.hiddenCount).toBeGreaterThan(0);
    expect(graph.nodes.some((n) => n.kind === 'self')).toBe(true);
  });

  it('drops Reticulum hops > 2 when distant peers are off and max hops is all', () => {
    const graph = buildReticulumMeshTopologyGraph(
      [rnodeIface],
      [
        { destination_hash: 'near', hops: 2, interface: 'RNode 41F4' },
        { destination_hash: 'far', hops: 4, interface: 'RNode 41F4' },
      ],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { includeDistantPeers: false, maxHops: null },
      },
    );
    expect(graph.nodes.some((n) => n.id === 'near')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'far')).toBe(false);
  });

  it('does not gate numeric max hops behind show-distant', () => {
    const graph = buildReticulumMeshTopologyGraph(
      [rnodeIface],
      [
        { destination_hash: 'near', hops: 2, interface: 'RNode 41F4' },
        { destination_hash: 'mid', hops: 4, interface: 'RNode 41F4' },
        { destination_hash: 'far', hops: 9, interface: 'RNode 41F4' },
      ],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { includeDistantPeers: false, maxHops: 8 },
      },
    );
    expect(graph.nodes.some((n) => n.id === 'near')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'mid')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'far')).toBe(false);
  });

  it('changes visible count across maxHops 1, 2, 8, and all', () => {
    const peers = [
      ...rfPeers(30, 1),
      ...rfPeers(40, 2).map((p, i) => ({ ...p, destination_hash: `h2${i}` })),
      ...rfPeers(80, 3).map((p, i) => ({ ...p, destination_hash: `h3${i}` })),
      ...rfPeers(50, 5).map((p, i) => ({ ...p, destination_hash: `h5${i}` })),
    ];
    const counts = ([1, 2, 8, null] as const).map(
      (maxHops) =>
        buildReticulumMeshTopologyGraph([rnodeIface], peers, {
          selfLabel: 'You',
          unassignedInterfaceLabel: 'Other paths',
          filter: { includeDistantPeers: true, maxHops },
        }).nodes.filter((n) => n.kind === 'peer').length,
    );
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
    expect(counts[2]).toBe(counts[3]);
  });

  it('includes unknown hops when maxHops is numeric', () => {
    const graph = buildReticulumMeshTopologyGraph(
      [rnodeIface],
      [
        { destination_hash: 'known', hops: 2, interface: 'RNode 41F4' },
        { destination_hash: 'unknown', interface: 'RNode 41F4' },
      ],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { includeDistantPeers: true, maxHops: 2 },
      },
    );
    expect(graph.nodes.some((n) => n.id === 'unknown')).toBe(true);
  });

  it('counts totalNodeCount before the layout cap', () => {
    const graph = buildReticulumMeshTopologyGraph([rnodeIface], rfPeers(80, 1), {
      selfLabel: 'You',
      unassignedInterfaceLabel: 'Other paths',
      filter: { includeDistantPeers: false },
    });
    expect(graph.totalNodeCount).toBe(80 + 1 + 1);
    expect(graph.nodes.length + graph.hiddenCount).toBe(graph.totalNodeCount);
  });
});

describe('buildReticulumMeshTopologyGraph RF-only', () => {
  it('keeps the RNode spoke and drops TCP when rfOnly is on', () => {
    const graph = buildReticulumMeshTopologyGraph(
      [rnodeIface, tcpIface],
      [
        { destination_hash: 'rfpeer', hops: 1, interface: 'RNode 41F4' },
        { destination_hash: 'tcppeer', hops: 1, interface: 'RNS_Transport_US-East' },
      ],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { includeDistantPeers: true, rfOnly: true },
      },
    );
    expect(graph.nodes.some((n) => n.id === interfaceNodeId('rnode-1'))).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'rfpeer')).toBe(true);
    expect(graph.nodes.some((n) => n.id === interfaceNodeId('tcp-east'))).toBe(false);
    expect(graph.nodes.some((n) => n.id === 'tcppeer')).toBe(false);
  });

  it('is unchanged when rfOnly is off', () => {
    const graph = buildReticulumMeshTopologyGraph(
      [rnodeIface, tcpIface],
      [
        { destination_hash: 'rfpeer', hops: 1, interface: 'RNode 41F4' },
        { destination_hash: 'tcppeer', hops: 1, interface: 'RNS_Transport_US-East' },
      ],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { includeDistantPeers: true, rfOnly: false },
      },
    );
    expect(graph.nodes.some((n) => n.id === 'tcppeer')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'rfpeer')).toBe(true);
  });

  it('keeps BLE RNode and KISS interfaces', () => {
    const ble = {
      id: 'ble-1',
      name: 'RNode BLE',
      type: 'rnode',
      serial_port: 'ble://AA:BB:CC:DD:EE:FF',
      enabled: true,
      status: 'up',
    };
    const kiss = {
      id: 'kiss-1',
      name: 'KISS TNC',
      type: 'kiss',
      enabled: true,
      status: 'up',
    };
    const graph = buildReticulumMeshTopologyGraph(
      [ble, kiss, tcpIface],
      [
        { destination_hash: 'blepeer', hops: 1, interface: 'RNode BLE' },
        { destination_hash: 'kisspeer', hops: 1, interface: 'KISS TNC' },
        { destination_hash: 'tcppeer', hops: 1, interface: 'RNS_Transport_US-East' },
      ],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { rfOnly: true },
      },
    );
    expect(graph.nodes.some((n) => n.id === 'blepeer')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'kisspeer')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'tcppeer')).toBe(false);
  });

  it('drops unmatched peers and has no Other paths hub when RF-only', () => {
    const graph = buildReticulumMeshTopologyGraph(
      [rnodeIface],
      [{ destination_hash: 'orphan', hops: 1, interface: 'unknown_iface' }],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { rfOnly: true },
      },
    );
    expect(graph.nodes.some((n) => n.id === 'orphan')).toBe(false);
    expect(graph.nodes.some((n) => n.id === interfaceNodeId('__unassigned__'))).toBe(false);
  });

  it('shows self only when RF-only and there are no RF interfaces', () => {
    const graph = buildReticulumMeshTopologyGraph(
      [tcpIface],
      [{ destination_hash: 'tcppeer', hops: 1, interface: 'RNS_Transport_US-East' }],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { rfOnly: true },
      },
    );
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.kind).toBe('self');
  });

  it('keeps all 80 RF 1-hop peers with rfOnly, distant on, and maxHops 1', () => {
    const tcpPeers = Array.from({ length: 80 }, (_, i) => ({
      destination_hash: `tcp${i.toString(16).padStart(8, '0')}`,
      hops: 1,
      interface: 'RNS_Transport_US-East',
    }));
    const graph = buildReticulumMeshTopologyGraph(
      [rnodeIface, tcpIface],
      [...rfPeers(80, 1), ...tcpPeers],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { includeDistantPeers: true, maxHops: 1, rfOnly: true },
      },
    );
    expect(graph.nodes.filter((n) => n.kind === 'peer')).toHaveLength(80);
    expect(graph.hiddenCount).toBe(0);
    expect(graph.nodes.some((n) => n.id.startsWith('tcp'))).toBe(false);
  });

  it('combines RF-only with maxHops', () => {
    const graph = buildReticulumMeshTopologyGraph(
      [rnodeIface, tcpIface],
      [
        { destination_hash: 'tcppeer', hops: 1, interface: 'RNS_Transport_US-East' },
        { destination_hash: 'rf1', hops: 1, interface: 'RNode 41F4' },
        { destination_hash: 'rf3', hops: 3, interface: 'RNode 41F4' },
      ],
      {
        selfLabel: 'You',
        unassignedInterfaceLabel: 'Other paths',
        filter: { includeDistantPeers: true, maxHops: 1, rfOnly: true },
      },
    );
    expect(graph.nodes.some((n) => n.id === 'tcppeer')).toBe(false);
    expect(graph.nodes.some((n) => n.id === 'rf1')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'rf3')).toBe(false);
  });

  it('applies the distant cap after RF-only', () => {
    const graph = buildReticulumMeshTopologyGraph([rnodeIface], rfPeers(500, 1), {
      selfLabel: 'You',
      unassignedInterfaceLabel: 'Other paths',
      filter: { includeDistantPeers: true, rfOnly: true },
    });
    expect(graph.nodes.length).toBeLessThanOrEqual(RETICULUM_TOPOLOGY_DISTANT_NODE_CAP);
    expect(graph.hiddenCount).toBeGreaterThan(0);
    expect(graph.nodes.filter((n) => n.kind === 'peer').length + graph.hiddenCount).toBe(500);
  });
});

describe('reticulum topology helpers', () => {
  it('matches peer interface names case-insensitively', () => {
    expect(matchPeerToInterfaceId('rns_transport_us-east', sampleInterfaces)).toBe('tcp-east');
    expect(matchPeerToInterfaceId('missing', sampleInterfaces)).toBeNull();
  });

  it('detects peer and interface online state', () => {
    expect(isReticulumInterfaceOnline({ id: 'a', name: 'A', enabled: true, status: 'up' })).toBe(
      true,
    );
    expect(isReticulumInterfaceOnline({ id: 'a', name: 'A', enabled: false, status: 'up' })).toBe(
      false,
    );
    expect(isReticulumPeerOnline({ destination_hash: 'x', hops: 1 })).toBe(true);
    expect(isReticulumPeerOnline({ destination_hash: 'x', hops: 0 })).toBe(false);
  });
});

describe('buildReticulumTopologyLayout (via-hash legacy)', () => {
  it('assigns BFS depths from self over via edges', () => {
    const nodes = [
      { destination_hash: 'hub', hops: 1 },
      { destination_hash: 'leaf', hops: 2 },
    ];
    const edges = [
      { source: 'self', target: 'hub' },
      { source: 'hub', target: 'leaf' },
    ];
    const depths = computeReticulumNodeDepths(edges, nodes);
    expect(depths.get('self')).toBe(0);
    expect(depths.get('hub')).toBe(1);
    expect(depths.get('leaf')).toBe(2);
  });

  it('uses hops as depth fallback when BFS cannot reach a node', () => {
    const nodes = [{ destination_hash: 'leaf', hops: 3 }];
    const edges = [{ source: 'relay', target: 'leaf' }];
    const depths = computeReticulumNodeDepths(edges, nodes);
    expect(depths.get('leaf')).toBe(3);
  });

  it('places hub on inner ring and leaf on outer ring', () => {
    const nodes = [
      { destination_hash: 'hub', hops: 1 },
      { destination_hash: 'leaf', hops: 2 },
    ];
    const edges = [
      { source: 'self', target: 'hub' },
      { source: 'hub', target: 'leaf' },
    ];
    const layout = buildReticulumTopologyLayout(nodes, edges, { selfLabel: 'You' });
    const hub = layout.find((n) => n.id === 'hub');
    const leaf = layout.find((n) => n.id === 'leaf');
    expect(hub?.depth).toBe(1);
    expect(leaf?.depth).toBe(2);
  });

  it('includes relay ids from edges in layout nodes', () => {
    const nodes = [{ destination_hash: 'leaf', hops: 2 }];
    const edges = [
      { source: 'self', target: 'relay99' },
      { source: 'relay99', target: 'leaf' },
    ];
    const merged = mergeReticulumTopologyEdgeNodes(nodes, edges);
    expect(merged.some((n) => n.destination_hash === 'relay99')).toBe(true);
    const layout = buildReticulumTopologyLayout(nodes, edges, { selfLabel: 'You' });
    expect(layout.some((n) => n.id === 'relay99')).toBe(true);
  });

  it('marks relay when fanning out to multiple targets', () => {
    const edges = [
      { source: 'self', target: 'hub' },
      { source: 'hub', target: 'a' },
      { source: 'hub', target: 'b' },
    ];
    expect(countRelayTargets('hub', edges)).toBe(2);
  });

  it('marks single-outgoing relay as hub', () => {
    const edges = [
      { source: 'self', target: 'hub' },
      { source: 'hub', target: 'leaf' },
    ];
    expect(isReticulumHubNode('hub', edges)).toBe(true);
    expect(isReticulumHubNode('leaf', edges)).toBe(false);
    const graph = buildReticulumTopologyGraph(
      [
        { destination_hash: 'hub', hops: 1 },
        { destination_hash: 'leaf', hops: 2 },
      ],
      edges,
      { selfLabel: 'You' },
    );
    expect(graph.nodes.find((n) => n.id === 'hub')?.isHub).toBe(true);
  });

  it('skips star fallback when multi-hop metadata is present', () => {
    expect(shouldUseReticulumStarFallbackEdges([{ destination_hash: 'x', hops: 2 }], [])).toBe(
      false,
    );
    expect(
      shouldUseReticulumStarFallbackEdges(
        [{ destination_hash: 'x', hops: 1, via_hash: 'hub' }],
        [],
      ),
    ).toBe(false);
    expect(shouldUseReticulumStarFallbackEdges([{ destination_hash: 'x', hops: 1 }], [])).toBe(
      true,
    );
  });

  it('builds via-hash edges for multi-hop peers when API omits edge list', () => {
    const hub = 'hub11111111111111';
    const leaf = 'leaf22222222222222';
    const edges = buildReticulumViaHashEdges([
      { destination_hash: hub, hops: 1 },
      { destination_hash: leaf, hops: 2, via_hash: hub },
    ]);
    expect(edges).toContainEqual({ source: 'self', target: hub });
    expect(edges).toContainEqual({ source: hub, target: leaf });

    const graph = buildReticulumTopologyGraph(
      [
        { destination_hash: hub, hops: 1, display_name: 'Hub Node' },
        { destination_hash: leaf, hops: 2, display_name: 'Leaf Node' },
      ],
      edges,
      { selfLabel: 'You' },
    );
    expect(graph.nodes.some((n) => n.id === leaf)).toBe(true);
    expect(graph.edges.some((e) => e.source === hub && e.target === leaf)).toBe(true);
  });

  it('seeds hub closer to center than leaf', () => {
    const edges = [
      { source: 'self', target: 'hub' },
      { source: 'hub', target: 'leaf' },
    ];
    const graph = buildReticulumTopologyGraph(
      [
        { destination_hash: 'hub', hops: 1 },
        { destination_hash: 'leaf', hops: 2 },
      ],
      edges,
      { selfLabel: 'You', cx: 400, cy: 300 },
    );
    const hub = graph.nodes.find((n) => n.id === 'hub')!;
    const leaf = graph.nodes.find((n) => n.id === 'leaf')!;
    const hubDist = Math.hypot(hub.seedX - 400, hub.seedY - 300);
    const leafDist = Math.hypot(leaf.seedX - 400, leaf.seedY - 300);
    expect(hubDist).toBeLessThan(leafDist);
  });

  it('filters distant leaves when graph exceeds visible cap', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      destination_hash: `peer${i}`,
      hops: i < 5 ? 1 : 3,
    }));
    const edges = nodes.flatMap((n, i) =>
      i < 5
        ? [{ source: 'self' as const, target: n.destination_hash }]
        : [{ source: 'hub', target: n.destination_hash }],
    );
    edges.unshift({ source: 'self', target: 'hub' });
    nodes.unshift({ destination_hash: 'hub', hops: 1 });

    const depths = computeReticulumNodeDepths(edges, nodes);
    const visible = filterReticulumVisibleNodeIds(
      nodes.map((n) => n.destination_hash),
      depths,
      edges,
      nodes,
      { includeDistantPeers: false },
    );
    expect(visible.has('hub')).toBe(true);
    expect(visible.has('peer0')).toBe(true);
    expect(visible.has('peer50')).toBe(false);

    const graph = buildReticulumTopologyGraph(nodes, edges, {
      selfLabel: 'You',
      filter: { includeDistantPeers: false },
    });
    expect(graph.hiddenCount).toBeGreaterThan(0);
    expect(graph.nodes.some((n) => n.id === 'hub')).toBe(true);
  });

  it('includes edge-attached distant peers when includeDistantPeers is enabled', () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({
      destination_hash: `peer${i}`,
      hops: i < 5 ? 1 : 3,
    }));
    const edges = nodes.flatMap((n, i) =>
      i < 5
        ? [{ source: 'self' as const, target: n.destination_hash }]
        : [{ source: 'hub', target: n.destination_hash }],
    );
    edges.unshift({ source: 'self', target: 'hub' });
    nodes.unshift({ destination_hash: 'hub', hops: 1 });

    const depths = computeReticulumNodeDepths(edges, nodes);
    const visible = filterReticulumVisibleNodeIds(
      nodes.map((n) => n.destination_hash),
      depths,
      edges,
      nodes,
      { includeDistantPeers: true },
    );
    expect(visible.has('hub')).toBe(true);
    expect(visible.has('peer50')).toBe(true);
  });
});
