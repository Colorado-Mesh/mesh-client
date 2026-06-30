import { describe, expect, it } from 'vitest';

import {
  buildReticulumTopologyLayout,
  computeReticulumNodeDepths,
  countRelayTargets,
} from './buildReticulumTopologyLayout';

describe('buildReticulumTopologyLayout', () => {
  it('assigns BFS depths from self over via edges', () => {
    const edges = [
      { source: 'self', target: 'hub' },
      { source: 'hub', target: 'leaf' },
    ];
    const depths = computeReticulumNodeDepths(edges, ['hub', 'leaf']);
    expect(depths.get('self')).toBe(0);
    expect(depths.get('hub')).toBe(1);
    expect(depths.get('leaf')).toBe(2);
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

  it('marks relay when fanning out to multiple targets', () => {
    const edges = [
      { source: 'self', target: 'hub' },
      { source: 'hub', target: 'a' },
      { source: 'hub', target: 'b' },
    ];
    expect(countRelayTargets('hub', edges)).toBe(2);
  });
});
