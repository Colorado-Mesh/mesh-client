import { beforeEach, describe, expect, it } from 'vitest';

import { useMapTraceRouteStore } from './mapTraceRouteStore';

describe('mapTraceRouteStore', () => {
  beforeEach(() => {
    useMapTraceRouteStore.setState({ route: null });
  });

  it('sets and clears a traceroute overlay', () => {
    useMapTraceRouteStore.getState().setRoute([1, 2, 3], ['A', 'B', 'C']);
    expect(useMapTraceRouteStore.getState().route?.nodeIds).toEqual([1, 2, 3]);
    useMapTraceRouteStore.getState().clear();
    expect(useMapTraceRouteStore.getState().route).toBeNull();
  });
});
