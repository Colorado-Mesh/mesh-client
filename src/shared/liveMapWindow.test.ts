import { describe, expect, it } from 'vitest';

import { isLiveMapProtocol, type LiveMapView, parseLiveMapView } from './liveMapWindow';

const view: LiveMapView = {
  center: [39.74, -104.99],
  zoom: 9.5,
  basemapId: 'usgs-topo',
  trafficSource: 'corescope',
  feed: { baseUrl: 'https://analyzer.bostonme.sh', region: 'BOS' },
};

describe('isLiveMapProtocol', () => {
  it('accepts only protocols with a live traffic view', () => {
    expect(isLiveMapProtocol('meshtastic')).toBe(true);
    expect(isLiveMapProtocol('meshcore')).toBe(true);
    expect(isLiveMapProtocol('reticulum')).toBe(false);
    expect(isLiveMapProtocol(undefined)).toBe(false);
  });
});

describe('parseLiveMapView', () => {
  it('keeps a valid view', () => {
    expect(parseLiveMapView(view)).toEqual(view);
  });

  it('keeps wrapped longitudes and drops an empty region', () => {
    expect(
      parseLiveMapView({
        ...view,
        center: [-17.5, 181],
        feed: { baseUrl: view.feed?.baseUrl, region: '' },
      }),
    ).toEqual({ ...view, center: [-17.5, 181], feed: { baseUrl: view.feed?.baseUrl } });
  });

  it('drops a feed for local traffic', () => {
    expect(parseLiveMapView({ ...view, trafficSource: 'local' })).toEqual({
      ...view,
      trafficSource: 'local',
      feed: null,
    });
  });

  it('accepts a regional source without a connected feed', () => {
    expect(parseLiveMapView({ ...view, feed: undefined })).toEqual({ ...view, feed: null });
  });

  it.each([
    ['no object', null],
    ['a short center', { ...view, center: [1] }],
    ['a latitude past the pole', { ...view, center: [91, 0] }],
    ['a non-finite longitude', { ...view, center: [0, Number.POSITIVE_INFINITY] }],
    ['a negative zoom', { ...view, zoom: -1 }],
    ['a zoom past the tile limit', { ...view, zoom: 30 }],
    ['an unknown basemap shape', { ...view, basemapId: '../dark' }],
    ['an unknown source', { ...view, trafficSource: 'mqtt' }],
    ['a feed without a URL', { ...view, feed: { region: 'DEN' } }],
    ['an oversized feed URL', { ...view, feed: { baseUrl: `https://${'a'.repeat(2_050)}` } }],
    [
      'an oversized region',
      { ...view, feed: { baseUrl: 'https://a.example', region: 'r'.repeat(129) } },
    ],
    ['a feed that is not an object', { ...view, feed: 'https://a.example' }],
  ])('rejects %s', (_label, value) => {
    expect(parseLiveMapView(value)).toBeNull();
  });
});
