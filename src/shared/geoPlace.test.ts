import { describe, expect, it } from 'vitest';

import {
  GEO_PLACE_MAX_QUALIFIERS,
  GEO_PLACE_NAME_MAX_LENGTH,
  GEO_PLACE_QUALIFIER_MAX_LENGTH,
  parseGeoResolvePlaceRequest,
} from './geoPlace';

describe('parseGeoResolvePlaceRequest', () => {
  it('parses valid minimal request with defaults', () => {
    const parsed = parseGeoResolvePlaceRequest({ name: 'Boulder' });
    expect(parsed).toEqual({
      name: 'Boulder',
      qualifiers: [],
      allowOnline: false,
    });
  });

  it('trims name and parses qualifiers with near coordinates', () => {
    const parsed = parseGeoResolvePlaceRequest({
      name: '  Denver  ',
      qualifiers: ['CO', ' USA '],
      nearLat: 39.7392,
      nearLon: -104.9903,
      allowOnline: true,
    });
    expect(parsed).toEqual({
      name: 'Denver',
      qualifiers: ['CO', 'USA'],
      nearLat: 39.7392,
      nearLon: -104.9903,
      allowOnline: true,
    });
  });

  it('rejects non-object inputs', () => {
    expect(parseGeoResolvePlaceRequest(null)).toBeNull();
    expect(parseGeoResolvePlaceRequest(undefined)).toBeNull();
    expect(parseGeoResolvePlaceRequest('Denver')).toBeNull();
    expect(parseGeoResolvePlaceRequest(1234)).toBeNull();
  });

  it('rejects missing, empty, or whitespace-only names', () => {
    expect(parseGeoResolvePlaceRequest({})).toBeNull();
    expect(parseGeoResolvePlaceRequest({ name: '' })).toBeNull();
    expect(parseGeoResolvePlaceRequest({ name: '   ' })).toBeNull();
    expect(parseGeoResolvePlaceRequest({ name: 123 })).toBeNull();
  });

  it('rejects name exceeding GEO_PLACE_NAME_MAX_LENGTH', () => {
    const longName = 'A'.repeat(GEO_PLACE_NAME_MAX_LENGTH + 1);
    expect(parseGeoResolvePlaceRequest({ name: longName })).toBeNull();
    const exactName = 'A'.repeat(GEO_PLACE_NAME_MAX_LENGTH);
    expect(parseGeoResolvePlaceRequest({ name: exactName })).not.toBeNull();
  });

  it('rejects qualifiers array exceeding maximum allowed qualifiers', () => {
    const tooMany = Array.from({ length: GEO_PLACE_MAX_QUALIFIERS + 1 }, (_, i) => `q${i}`);
    expect(parseGeoResolvePlaceRequest({ name: 'City', qualifiers: tooMany })).toBeNull();
  });

  it('rejects qualifiers with non-string elements or oversized items', () => {
    expect(
      parseGeoResolvePlaceRequest({ name: 'City', qualifiers: [123 as unknown as string] }),
    ).toBeNull();
    const oversized = 'Q'.repeat(GEO_PLACE_QUALIFIER_MAX_LENGTH + 1);
    expect(parseGeoResolvePlaceRequest({ name: 'City', qualifiers: [oversized] })).toBeNull();
  });

  it('ignores invalid nearLat / nearLon coordinates', () => {
    const outOfRangeLat = parseGeoResolvePlaceRequest({
      name: 'City',
      nearLat: 95,
      nearLon: -105,
    });
    expect(outOfRangeLat?.nearLat).toBeUndefined();
    expect(outOfRangeLat?.nearLon).toBeUndefined();

    const outOfRangeLon = parseGeoResolvePlaceRequest({
      name: 'City',
      nearLat: 40,
      nearLon: 190,
    });
    expect(outOfRangeLon?.nearLat).toBeUndefined();
    expect(outOfRangeLon?.nearLon).toBeUndefined();

    const partialCoords = parseGeoResolvePlaceRequest({
      name: 'City',
      nearLat: 40,
    });
    expect(partialCoords?.nearLat).toBeUndefined();
    expect(partialCoords?.nearLon).toBeUndefined();
  });
});
