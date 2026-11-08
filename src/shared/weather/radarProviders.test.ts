import { describe, expect, it } from 'vitest';

import {
  buildIemNexradUrl,
  buildRainViewerRadarUrl,
  iemNexradLayer,
  selectRadarProvider,
  US_NEXRAD_BOUNDS,
} from './radarProviders';

describe('radarProviders', () => {
  it('auto-selects IEM inside CONUS at z>=5', () => {
    expect(selectRadarProvider(US_NEXRAD_BOUNDS, 6, 'auto')).toBe('iem-nexrad');
    expect(selectRadarProvider(US_NEXRAD_BOUNDS, 4, 'auto')).toBe('rainviewer');
    expect(selectRadarProvider({ north: 52, south: 48, east: 14, west: 10 }, 8, 'auto')).toBe(
      'rainviewer',
    );
  });

  it('honors explicit preference', () => {
    expect(selectRadarProvider(US_NEXRAD_BOUNDS, 8, 'rainviewer')).toBe('rainviewer');
    expect(selectRadarProvider({ north: 52, south: 48, east: 14, west: 10 }, 8, 'iem-nexrad')).toBe(
      'iem-nexrad',
    );
  });

  it('builds IEM layer names and URLs', () => {
    expect(iemNexradLayer(0)).toBe('nexrad-n0q-900913');
    expect(iemNexradLayer(5)).toBe('nexrad-n0q-m05m-900913');
    expect(iemNexradLayer(55)).toBe('nexrad-n0q-m55m-900913');
    expect(buildIemNexradUrl('nexrad-n0q-900913', 10, 164, 357)).toBe(
      'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/10/164/357.png',
    );
  });

  it('builds RainViewer URLs without accepting a host from the path', () => {
    const url = buildRainViewerRadarUrl(
      'https://tilecache.rainviewer.com',
      '/v2/radar/abc',
      7,
      20,
      45,
    );
    expect(url).toBe('https://tilecache.rainviewer.com/v2/radar/abc/256/7/20/45/2/1_1.png');
  });
});
