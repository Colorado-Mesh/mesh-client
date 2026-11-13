import { beforeEach, describe, expect, it } from 'vitest';

import { useMapTraceRouteStore } from './mapTraceRouteStore';

describe('mapTraceRouteStore', () => {
  beforeEach(() => {
    useMapTraceRouteStore.setState({ route: null });
  });

  it('sets and clears a traceroute overlay with protocol/identity scope', () => {
    useMapTraceRouteStore
      .getState()
      .setRoute([1, 2, 3], ['A', 'B', 'C'], { protocol: 'meshtastic', identityId: 'id-a' });
    expect(useMapTraceRouteStore.getState().route).toEqual({
      nodeIds: [1, 2, 3],
      labels: ['A', 'B', 'C'],
      protocol: 'meshtastic',
      identityId: 'id-a',
    });
    useMapTraceRouteStore.getState().clear();
    expect(useMapTraceRouteStore.getState().route).toBeNull();
  });
});
