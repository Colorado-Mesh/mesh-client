import { describe, expect, it } from 'vitest';

import { formatGpxTracks } from './gpxExportFormat';

describe('formatGpxTracks', () => {
  it('escapes track names and emits trkpt times', () => {
    const xml = formatGpxTracks([
      {
        node_id: 1,
        latitude: 39.7,
        longitude: -104.9,
        recorded_at: Date.UTC(2026, 0, 1, 12, 0, 0),
        name: 'A&B<test>',
      },
    ]);
    expect(xml).toContain('<name>A&amp;B&lt;test&gt;</name>');
    expect(xml).toContain('lat="39.7"');
    expect(xml).toContain('lon="-104.9"');
    expect(xml).toContain('<time>2026-01-01T12:00:00.000Z</time>');
  });

  it('skips invalid lat/lon and non-finite timestamps', () => {
    const xml = formatGpxTracks([
      { node_id: 1, latitude: 91, longitude: 0, recorded_at: Date.UTC(2026, 0, 1) },
      { node_id: 1, latitude: 0, longitude: 181, recorded_at: Date.UTC(2026, 0, 1) },
      { node_id: 1, latitude: 1, longitude: 2, recorded_at: Number.NaN },
      { node_id: 1, latitude: 10, longitude: 20, recorded_at: Date.UTC(2026, 0, 2) },
    ]);
    expect(xml).toContain('lat="10"');
    expect(xml).not.toContain('lat="91"');
    expect(xml).not.toContain('lon="181"');
  });

  it('groups multiple nodes and defaults unnamed tracks', () => {
    const xml = formatGpxTracks([
      { node_id: 255, latitude: 1, longitude: 2, recorded_at: 1000 },
      { node_id: 16, latitude: 3, longitude: 4, recorded_at: 2000, name: 'Alpha' },
    ]);
    expect(xml).toContain('<name>node-ff</name>');
    expect(xml).toContain('<name>Alpha</name>');
  });
});
