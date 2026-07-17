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
});
