import { afterEach, describe, expect, it } from 'vitest';

import {
  filterMeshcoreIataAirports,
  findNearestMeshcoreIata,
  formatMeshcoreIataAirportLabel,
  loadMeshcoreIataAirports,
  type MeshcoreIataAirport,
  meshcoreTopicPrefixFromIataSegment,
  parseMeshcoreIataCatalog,
  setMeshcoreIataAirportsForTests,
} from './meshcoreMqttIataCatalog';

const FIXTURES: MeshcoreIataAirport[] = [
  {
    code: 'DEN',
    name: 'Denver International Airport',
    city: 'Denver',
    lat: 39.8561,
    lon: -104.6737,
  },
  {
    code: 'COS',
    name: 'City of Colorado Springs Municipal Airport',
    city: 'Colorado Springs',
    lat: 38.8058,
    lon: -104.7008,
  },
  {
    code: 'ASE',
    name: 'Aspen-Pitkin County Airport',
    city: 'Aspen',
    lat: 39.2232,
    lon: -106.8688,
  },
  {
    // Near antimeridian (Fiji)
    code: 'NAN',
    name: 'Nadi International Airport',
    city: 'Nadi',
    lat: -17.7554,
    lon: 177.4432,
  },
];

afterEach(() => {
  setMeshcoreIataAirportsForTests(null);
});

describe('findNearestMeshcoreIata', () => {
  it('returns DEN for downtown Denver', () => {
    expect(findNearestMeshcoreIata(FIXTURES, 39.7392, -104.9903)?.code).toBe('DEN');
  });

  it('returns COS for Colorado Springs', () => {
    expect(findNearestMeshcoreIata(FIXTURES, 38.8339, -104.8214)?.code).toBe('COS');
  });

  it('returns ASE for Aspen', () => {
    expect(findNearestMeshcoreIata(FIXTURES, 39.1911, -106.8175)?.code).toBe('ASE');
  });

  it('handles points near the antimeridian', () => {
    expect(findNearestMeshcoreIata(FIXTURES, -17.8, 177.4)?.code).toBe('NAN');
  });

  it('returns null for empty catalog or bad coords', () => {
    expect(findNearestMeshcoreIata([], 39.7, -104.9)).toBeNull();
    expect(findNearestMeshcoreIata(FIXTURES, Number.NaN, -104.9)).toBeNull();
  });
});

describe('filterMeshcoreIataAirports', () => {
  it('filters by code, name, and city', () => {
    expect(filterMeshcoreIataAirports(FIXTURES, 'den').map((a) => a.code)).toEqual(['DEN']);
    expect(filterMeshcoreIataAirports(FIXTURES, 'springs').map((a) => a.code)).toEqual(['COS']);
    expect(filterMeshcoreIataAirports(FIXTURES, 'aspen').map((a) => a.code)).toEqual(['ASE']);
  });

  it('returns all when query is blank', () => {
    expect(filterMeshcoreIataAirports(FIXTURES, '  ')).toHaveLength(FIXTURES.length);
  });
});

describe('formatMeshcoreIataAirportLabel / meshcoreTopicPrefixFromIataSegment', () => {
  it('formats labels and topic prefixes', () => {
    expect(formatMeshcoreIataAirportLabel(FIXTURES[0])).toBe('DEN — Denver International Airport');
    expect(meshcoreTopicPrefixFromIataSegment('den')).toBe('meshcore/DEN');
    expect(meshcoreTopicPrefixFromIataSegment('test')).toBe('meshcore/test');
  });
});

describe('parseMeshcoreIataCatalog / loadMeshcoreIataAirports', () => {
  it('parses compact rows', () => {
    const parsed = parseMeshcoreIataCatalog({
      source: 'test',
      generatedAt: '2026-01-01',
      airports: [['DEN', 'Denver International Airport', 'Denver', 39.85, -104.67]],
    });
    expect(parsed).toEqual([
      {
        code: 'DEN',
        name: 'Denver International Airport',
        city: 'Denver',
        lat: 39.85,
        lon: -104.67,
      },
    ]);
  });

  it('loads the vendored catalog with DEN present', async () => {
    setMeshcoreIataAirportsForTests(null);
    const airports = await loadMeshcoreIataAirports();
    expect(airports.length).toBeGreaterThan(1000);
    expect(airports.find((a) => a.code === 'DEN')).toMatchObject({ code: 'DEN' });
  });
});
