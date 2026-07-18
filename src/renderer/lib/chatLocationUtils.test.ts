import { describe, expect, it } from 'vitest';

import {
  buildOsmMapUrl,
  buildStaticTileUrl,
  formatLocationMessage,
  latLonToTile,
  parseLocationMessage,
} from './chatLocationUtils';

describe('chatLocationUtils', () => {
  it('formats a two-line location message with OSM link', () => {
    const text = formatLocationMessage(39.7392, -104.9903, '📍 Shared location');
    expect(text).toBe(
      '📍 Shared location: 39.7392, -104.9903\nhttps://www.openstreetmap.org/?mlat=39.7392&mlon=-104.9903',
    );
  });

  it('parses location from OSM mlat/mlon URL (locale-independent)', () => {
    const text =
      'Ubicación compartida: 39.7392, -104.9903\nhttps://www.openstreetmap.org/?mlat=39.7392&mlon=-104.9903';
    const parsed = parseLocationMessage(text);
    expect(parsed).toEqual({
      lat: 39.7392,
      lon: -104.9903,
      mapUrl: 'https://www.openstreetmap.org/?mlat=39.7392&mlon=-104.9903',
    });
  });

  it('parses labeled lat/lon without OSM URL (inbound fallback)', () => {
    const text = 'Ubicación compartida: 39.7392, -104.9903';
    const parsed = parseLocationMessage(text);
    expect(parsed).toEqual({
      lat: 39.7392,
      lon: -104.9903,
      mapUrl: buildOsmMapUrl(39.7392, -104.9903),
    });
  });

  it('returns null for non-location text', () => {
    expect(parseLocationMessage('hello world')).toBeNull();
    expect(parseLocationMessage('https://example.com/?lat=1&lon=2')).toBeNull();
    expect(parseLocationMessage('testing 1, 2')).toBeNull();
    expect(parseLocationMessage('score: 1, 2 more text')).toBeNull();
  });

  it('rejects out-of-range coordinates', () => {
    expect(parseLocationMessage('https://www.openstreetmap.org/?mlat=91&mlon=0')).toBeNull();
    expect(parseLocationMessage('https://www.openstreetmap.org/?mlat=0&mlon=181')).toBeNull();
    expect(parseLocationMessage('Shared: 91, 0')).toBeNull();
    expect(parseLocationMessage('Shared: 0, 181')).toBeNull();
  });

  it('computes web mercator tiles and static URL', () => {
    const tile = latLonToTile(39.7392, -104.9903, 14);
    expect(tile.z).toBe(14);
    expect(tile.x).toBeGreaterThan(0);
    expect(tile.y).toBeGreaterThan(0);
    const url = buildStaticTileUrl(39.7392, -104.9903, 14);
    expect(url).toBe(`https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`);
  });

  it('round-trips format → parse', () => {
    const text = formatLocationMessage(0, 0, 'Shared location');
    const parsed = parseLocationMessage(text);
    expect(parsed?.lat).toBe(0);
    expect(parsed?.lon).toBe(0);
    expect(parsed?.mapUrl).toBe(buildOsmMapUrl(0, 0));
  });
});
