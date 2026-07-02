import { describe, expect, it } from 'vitest';

import {
  FORCE_GRAPH_DEFAULTS,
  type ForceEdge,
  type SimNodeState,
  springLengthForEdge,
  stepForceSimulation,
} from './forceDirectedGraphLayout';

describe('forceDirectedGraphLayout', () => {
  it('springLengthForEdge uses kind defaults', () => {
    expect(springLengthForEdge({ source: 'a', target: 'b', kind: 'direct' })).toBe(
      FORCE_GRAPH_DEFAULTS.springLenDirect,
    );
    expect(springLengthForEdge({ source: 'a', target: 'b', kind: 'relay' })).toBe(
      FORCE_GRAPH_DEFAULTS.springLenRelay,
    );
    expect(
      springLengthForEdge({ source: 'a', target: 'b', kind: 'direct', springLength: 99 }),
    ).toBe(99);
  });

  it('repels two unconnected nodes', () => {
    const nodes: SimNodeState[] = [
      { id: 'a', x: 200, y: 200, vx: 0, vy: 0 },
      { id: 'b', x: 210, y: 200, vx: 0, vy: 0 },
    ];
    const startDist = Math.abs(nodes[1].x - nodes[0].x);
    for (let i = 0; i < 40; i++) {
      stepForceSimulation(nodes, [], 400, 400);
    }
    const endDist = Math.hypot(nodes[1].x - nodes[0].x, nodes[1].y - nodes[0].y);
    expect(endDist).toBeGreaterThan(startDist);
  });

  it('settles connected pair near direct spring length', () => {
    const edges: ForceEdge[] = [{ source: 'a', target: 'b', kind: 'direct' }];
    const nodes: SimNodeState[] = [
      { id: 'a', x: 100, y: 200, vx: 0, vy: 0 },
      { id: 'b', x: 300, y: 200, vx: 0, vy: 0 },
    ];
    for (let i = 0; i < 120; i++) {
      stepForceSimulation(nodes, edges, 400, 400);
    }
    const dist = Math.hypot(nodes[1].x - nodes[0].x, nodes[1].y - nodes[0].y);
    expect(dist).toBeGreaterThan(FORCE_GRAPH_DEFAULTS.springLenDirect - 40);
    expect(dist).toBeLessThan(FORCE_GRAPH_DEFAULTS.springLenDirect + 40);
  });
});
