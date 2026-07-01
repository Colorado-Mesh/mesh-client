import { describe, expect, it } from 'vitest';

import {
  buildReticulumTopologyGraph,
  buildReticulumTopologyLayout,
  buildReticulumViaHashEdges,
  computeReticulumNodeDepths,
  countRelayTargets,
  filterReticulumVisibleNodeIds,
  isReticulumHubNode,
  mergeReticulumTopologyEdgeNodes,
  shouldUseReticulumStarFallbackEdges,
} from './buildReticulumTopologyLayout';

describe('buildReticulumTopologyLayout', () => {
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
    );
    expect(visible.has('hub')).toBe(true);
    expect(visible.has('peer0')).toBe(true);
    expect(visible.has('peer50')).toBe(false);

    const graph = buildReticulumTopologyGraph(nodes, edges, { selfLabel: 'You' });
    expect(graph.hiddenCount).toBeGreaterThan(0);
    expect(graph.nodes.some((n) => n.id === 'hub')).toBe(true);
  });
});
