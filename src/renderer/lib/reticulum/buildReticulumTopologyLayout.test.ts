import { describe, expect, it } from 'vitest';

import {
  buildReticulumTopologyLayout,
  computeReticulumNodeDepths,
  countRelayTargets,
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
});
