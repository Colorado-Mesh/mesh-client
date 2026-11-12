import { describe, expect, it } from 'vitest';

import {
  assertOverlayByteBudget,
  assertSafeKmlXml,
  mapOverlayFormatFromName,
  MapOverlayParseError,
  parseGeoJsonToFeatureCollection,
  parseKmlToGeoJson,
  parseMapOverlayText,
} from './parseMapOverlay';

const SAMPLE_GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'HQ' },
      geometry: { type: 'Point', coordinates: [-105.0, 39.7] },
    },
  ],
});

const SAMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Trail</name>
    <Placemark>
      <name>Start</name>
      <Point><coordinates>-105.0,39.7,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Path</name>
      <LineString>
        <coordinates>
          -105.0,39.7,0
          -105.1,39.8,0
        </coordinates>
      </LineString>
    </Placemark>
    <Placemark>
      <name>Zone</name>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              -105.0,39.7,0
              -105.0,39.8,0
              -105.1,39.8,0
              -105.0,39.7,0
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

describe('mapOverlayFormatFromName', () => {
  it('detects geojson/kml/kmz extensions', () => {
    expect(mapOverlayFormatFromName('a.geojson')).toBe('geojson');
    expect(mapOverlayFormatFromName('a.JSON')).toBe('geojson');
    expect(mapOverlayFormatFromName('a.kml')).toBe('kml');
    expect(mapOverlayFormatFromName('a.kmz')).toBe('kmz');
    expect(mapOverlayFormatFromName('a.txt')).toBeNull();
  });
});

describe('parseGeoJsonToFeatureCollection', () => {
  it('parses a FeatureCollection fixture', () => {
    const fc = parseGeoJsonToFeatureCollection(SAMPLE_GEOJSON);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.geometry?.type).toBe('Point');
  });

  it('wraps a bare Feature', () => {
    const fc = parseGeoJsonToFeatureCollection(
      JSON.stringify({
        type: 'Feature',
        properties: null,
        geometry: { type: 'Point', coordinates: [1, 2] },
      }),
    );
    expect(fc.features).toHaveLength(1);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseGeoJsonToFeatureCollection('{')).toThrow(MapOverlayParseError);
  });

  it('rejects oversize payloads via the shared byte budget', () => {
    expect(() => {
      assertOverlayByteBudget('abcd', 3);
    }).toThrow(/exceeds/);
    expect(() => {
      assertOverlayByteBudget('ab', 3);
    }).not.toThrow();
  });
});

describe('parseKmlToGeoJson', () => {
  it('parses Point, LineString, and Polygon placemarks', () => {
    const fc = parseKmlToGeoJson(SAMPLE_KML);
    expect(fc.features.map((f) => f.geometry?.type).sort()).toEqual([
      'LineString',
      'Point',
      'Polygon',
    ]);
  });

  it('rejects DOCTYPE / ENTITY (XXE-ish) payloads', () => {
    const evil = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<kml><Placemark><Point><coordinates>0,0</coordinates></Point></Placemark></kml>`;
    expect(() => {
      assertSafeKmlXml(evil);
    }).toThrow(/DOCTYPE|ENTITY|unsafe/i);
    expect(() => parseKmlToGeoJson(evil)).toThrow(MapOverlayParseError);
  });

  it('rejects NetworkLink and http href (no network KML in v1)', () => {
    const network = `<kml><NetworkLink><Link><href>https://example.com/a.kml</href></Link></NetworkLink></kml>`;
    expect(() => parseKmlToGeoJson(network)).toThrow(/NetworkLink|network|unsupported/i);
    const href = `<kml><Placemark><Style><IconStyle><Icon><href>https://example.com/i.png</href></Icon></IconStyle></Style>
      <Point><coordinates>0,0</coordinates></Point></Placemark></kml>`;
    expect(() => parseKmlToGeoJson(href)).toThrow(/network|unsupported/i);
  });
});

describe('parseMapOverlayText', () => {
  it('routes by format', () => {
    expect(parseMapOverlayText(SAMPLE_GEOJSON, 'geojson').features).toHaveLength(1);
    expect(parseMapOverlayText(SAMPLE_KML, 'kml').features.length).toBeGreaterThan(0);
  });
});
