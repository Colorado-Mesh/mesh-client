import { describe, expect, it } from 'vitest';

import { buildTraceRouteOverlay } from './mapTraceRouteOverlay';

describe('buildTraceRouteOverlay', () => {
  it('builds hop markers and polyline when positions exist', () => {
    const positions = new Map([
      [1, { lat: 39.7, lon: -104.9 }],
      [2, { lat: 39.8, lon: -105.0 }],
      [3, { lat: 39.9, lon: -105.1 }],
    ]);
    const overlay = buildTraceRouteOverlay({
      routeNodeIds: [1, 2, 3],
      hopLabels: ['Me', 'R1', 'Dest'],
      positions,
    });
    expect(overlay.hops).toHaveLength(3);
    expect(overlay.hasPolyline).toBe(true);
    expect(overlay.emptyBecauseMissingPositions).toBe(false);
  });

  it('reports empty state when positions are missing', () => {
    const overlay = buildTraceRouteOverlay({
      routeNodeIds: [1, 2],
      positions: new Map(),
    });
    expect(overlay.hops).toHaveLength(0);
    expect(overlay.hasPolyline).toBe(false);
    expect(overlay.emptyBecauseMissingPositions).toBe(true);
  });
});
