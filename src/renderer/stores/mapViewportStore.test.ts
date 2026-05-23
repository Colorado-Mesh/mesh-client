import { beforeEach, describe, expect, it } from 'vitest';

import { useMapViewportStore } from './mapViewportStore';

describe('mapViewportStore focus', () => {
  beforeEach(() => {
    useMapViewportStore.setState({ pendingFocus: null });
  });

  it('stores and clears pending map focus', () => {
    useMapViewportStore.getState().requestFocus({ nodeId: 0x0bcd5737, lat: 39.7, lon: -104.9 });
    expect(useMapViewportStore.getState().pendingFocus).toEqual({
      nodeId: 0x0bcd5737,
      lat: 39.7,
      lon: -104.9,
    });
    useMapViewportStore.getState().clearPendingFocus();
    expect(useMapViewportStore.getState().pendingFocus).toBeNull();
  });
});
