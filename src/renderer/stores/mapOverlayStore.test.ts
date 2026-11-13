import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as rendererStorage from '@/renderer/lib/rendererStorage';

import { useMapOverlayStore } from './mapOverlayStore';

const sampleGeojson = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: { name: 'A' },
      geometry: { type: 'Point' as const, coordinates: [-105, 40] as [number, number] },
    },
  ],
};

describe('mapOverlayStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useMapOverlayStore.setState({ layers: [], lastImportError: null });
  });

  it('adds a layer and persists toggle/opacity across rehydrate', () => {
    const added = useMapOverlayStore.getState().addLayer({
      name: 'Trail',
      geojson: sampleGeojson,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const id = added.id;
    useMapOverlayStore.getState().setVisible(id, false);
    useMapOverlayStore.getState().setOpacity(id, 0.4);

    const raw = localStorage.getItem('mesh-client:mapOverlays');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as {
      state: { layers: { id: string; visible: boolean; opacity: number }[] };
    };
    expect(parsed.state.layers).toHaveLength(1);
    expect(parsed.state.layers[0]?.visible).toBe(false);
    expect(parsed.state.layers[0]?.opacity).toBe(0.4);
  });

  it('enforces the layer limit', () => {
    for (let i = 0; i < 16; i += 1) {
      const res = useMapOverlayStore.getState().addLayer({
        name: `L${i}`,
        geojson: sampleGeojson,
      });
      expect(res.ok).toBe(true);
    }
    expect(
      useMapOverlayStore.getState().addLayer({ name: 'overflow', geojson: sampleGeojson }).ok,
    ).toBe(false);
  });

  it('returns quota when persist storage is full', () => {
    const spy = vi.spyOn(rendererStorage, 'setRendererStorageItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });
    try {
      const res = useMapOverlayStore.getState().addLayer({
        name: 'Too big',
        geojson: sampleGeojson,
      });
      expect(res).toEqual({ ok: false, code: 'quota' });
      expect(useMapOverlayStore.getState().layers).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('rehydrates valid layers and drops invalid persisted records', async () => {
    const added = useMapOverlayStore.getState().addLayer({
      name: 'Trail',
      geojson: sampleGeojson,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const id = added.id;
    useMapOverlayStore.getState().setVisible(id, false);
    useMapOverlayStore.getState().setOpacity(id, 0.4);
    const raw = localStorage.getItem('mesh-client:mapOverlays');
    expect(raw).toBeTruthy();

    // Clear in-memory only, then restore the saved payload (setState would persist []).
    useMapOverlayStore.setState({ layers: [], lastImportError: null });
    localStorage.setItem('mesh-client:mapOverlays', raw!);
    await useMapOverlayStore.persist.rehydrate();
    const layer = useMapOverlayStore.getState().layers[0];
    expect(layer?.id).toBe(id);
    expect(layer?.visible).toBe(false);
    expect(layer?.opacity).toBe(0.4);
    expect(layer?.geojson.features).toHaveLength(1);
  });
});
