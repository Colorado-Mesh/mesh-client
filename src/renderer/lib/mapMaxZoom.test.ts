// @vitest-environment jsdom
import L from 'leaflet';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { MAP_MAX_ZOOM } from './mapBasemapUtils';

describe('MAP_MAX_ZOOM', () => {
  beforeAll(async () => {
    // The clustering plugin extends the global L, as react-leaflet-cluster loads it in the app.
    (globalThis as { L?: typeof L }).L = L;
    // @ts-expect-error untyped side-effect plugin; it adds markerClusterGroup to the global L
    await import('leaflet.markercluster');
  });

  const cluster = () =>
    (L as unknown as { markerClusterGroup: () => L.Layer }).markerClusterGroup();
  const maps: L.Map[] = [];
  const newMap = (options?: L.MapOptions) => {
    const el = document.createElement('div');
    document.body.append(el);
    const map = L.map(el, options).setView([39.74, -104.99], 10);
    maps.push(map);
    return map;
  };

  afterEach(() => {
    for (const map of maps.splice(0)) map.remove();
    document.body.replaceChildren();
  });

  it('matches the zoom the maps used to take from their tile layer', () => {
    expect(MAP_MAX_ZOOM).toBe(L.TileLayer.prototype.options.maxZoom);
  });

  it('lets marker clustering run on a map with no tile layer', () => {
    // Without a tile layer, and without its own maxZoom, the map reports Infinity.
    expect(() => cluster().addTo(newMap())).toThrow('Map has no maxZoom specified');
    expect(() => cluster().addTo(newMap({ maxZoom: MAP_MAX_ZOOM }))).not.toThrow();
  });
});
