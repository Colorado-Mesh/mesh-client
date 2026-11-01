import { describe, expect, it } from 'vitest';

import type { TakIncidentMarker } from '../../shared/tak-types';
import {
  buildIncidentAlarmCot,
  buildIncidentMarkerCot,
  INCIDENT_MARKER_STALE_MS,
  incidentMarkerArgb,
  incidentMarkerUid,
  parseTakIncidentMarkers,
} from './incident-cot';

const NOW = Date.parse('2026-10-28T20:00:00Z');
const MAYDAY: TakIncidentMarker = {
  id: 'mecp-abc123',
  callsign: '🆘 MAYDAY Alice',
  remarks: '🆘 MAYDAY: Injury\nMECP/0/M01\nFrom Alice & co, last heard 2026-10-28 19:58 UTC',
  lat: 39.7392,
  lon: -104.9903,
  severity: 0,
  drill: false,
};

describe('buildIncidentMarkerCot', () => {
  it('builds a spot marker at the position, named and coloured for its severity', () => {
    const cot = buildIncidentMarkerCot(MAYDAY, NOW);
    expect(cot).toContain('uid="mesh-client-mecp-abc123" type="b-m-p-s-m"');
    expect(cot).toContain(`stale="${new Date(NOW + INCIDENT_MARKER_STALE_MS).toISOString()}"`);
    expect(cot).toContain('<point lat="39.739200" lon="-104.990300"');
    expect(cot).toContain('<contact callsign="🆘 MAYDAY Alice"/>');
    expect(cot).toContain('<color argb="-65536"/>');
    // Line breaks stay; markup in the text is escaped.
    expect(cot).toContain('<remarks>🆘 MAYDAY: Injury\nMECP/0/M01\nFrom Alice &amp; co,');
  });

  it('colours each severity as MeshCore TAK Bridge does, and a drill grey', () => {
    expect([0, 1, 2, 3].map((s) => incidentMarkerArgb({ severity: s as 0, drill: false }))).toEqual(
      [0xffff0000 | 0, 0xffff8c00 | 0, 0xffffd700 | 0, -1],
    );
    expect(incidentMarkerArgb({ severity: 0, drill: true })).toBe(0xffa0a0a0 | 0);
  });

  it("names the marker's uid after the incident", () => {
    expect(incidentMarkerUid('mecp-x1')).toBe('mesh-client-mecp-x1');
  });
});

describe('emergency alarm', () => {
  const ALARMED: TakIncidentMarker = { ...MAYDAY, alarm: 'Alice & co' };

  it("is ATAK's own emergency alert, linked to the marker and named for the sender", () => {
    const cot = buildIncidentAlarmCot(ALARMED, NOW);
    expect(cot).toContain('uid="mesh-client-mecp-abc123-alert" type="b-a-o-tbl"');
    expect(cot).toContain(`stale="${new Date(NOW + INCIDENT_MARKER_STALE_MS).toISOString()}"`);
    expect(cot).toContain('<point lat="39.739200" lon="-104.990300"');
    expect(cot).toContain('<link uid="mesh-client-mecp-abc123" type="b-m-p-s-m" relation="p-p"/>');
    expect(cot).toContain('<contact callsign="Alice &amp; co-Alert"/>');
    expect(cot).toContain('<emergency type="911 Alert">Alice &amp; co</emergency>');
  });

  it('is cancelled as ATAK cancels its own', () => {
    const cot = buildIncidentAlarmCot(ALARMED, NOW, true);
    expect(cot).toContain('uid="mesh-client-mecp-abc123-alert" type="b-a-o-can"');
    expect(cot).toContain('<emergency cancel="true">Alice &amp; co</emergency>');
  });
});

describe('parseTakIncidentMarkers', () => {
  it('keeps valid markers, the last one for a repeated id', () => {
    expect(
      parseTakIncidentMarkers([
        { ...MAYDAY, callsign: '  old  ' },
        { ...MAYDAY, id: 'mecp-other', severity: 3, drill: true },
        { ...MAYDAY, callsign: ' 🆘 MAYDAY Alice ' },
      ]),
    ).toEqual([MAYDAY, { ...MAYDAY, id: 'mecp-other', severity: 3, drill: true }]);
    expect(parseTakIncidentMarkers([])).toEqual([]);
  });

  it("keeps a MAYDAY's alarm name, trimmed", () => {
    expect(parseTakIncidentMarkers([{ ...MAYDAY, alarm: ' Alice ' }])).toEqual([
      { ...MAYDAY, alarm: 'Alice' },
    ]);
  });

  it.each([
    ['not an array', MAYDAY],
    ['too many markers', Array.from({ length: 51 }, (_, i) => ({ ...MAYDAY, id: `m${i}` }))],
    ['a marker that is not an object', ['x']],
    ['an id that could break the uid', [{ ...MAYDAY, id: 'a"b' }]],
    ['an id with a slash', [{ ...MAYDAY, id: 'mecp/a' }]],
    ['an empty callsign', [{ ...MAYDAY, callsign: ' ' }]],
    ['a callsign with a line break', [{ ...MAYDAY, callsign: 'a\nb' }]],
    ['overlong remarks', [{ ...MAYDAY, remarks: 'x'.repeat(1025) }]],
    ['remarks with a control character', [{ ...MAYDAY, remarks: 'a\u0007b' }]],
    ['a position off the map', [{ ...MAYDAY, lat: 91 }]],
    ['a position that is not a number', [{ ...MAYDAY, lon: '1' }]],
    ['a severity out of range', [{ ...MAYDAY, severity: 4 }]],
    ['a drill flag that is not boolean', [{ ...MAYDAY, drill: 'no' }]],
    ['an empty alarm name', [{ ...MAYDAY, alarm: ' ' }]],
    ['an alarm name that is not text', [{ ...MAYDAY, alarm: true }]],
    ['an alarm name with a line break', [{ ...MAYDAY, alarm: 'a\nb' }]],
    ['an overlong alarm name', [{ ...MAYDAY, alarm: 'x'.repeat(81) }]],
    ['an alarm for an URGENT report', [{ ...MAYDAY, severity: 1, alarm: 'Alice' }]],
    ['an alarm for a drill', [{ ...MAYDAY, drill: true, alarm: 'Alice' }]],
  ])('rejects %s', (_label, raw) => {
    expect(() => parseTakIncidentMarkers(raw)).toThrow(/^tak:setIncidentMarkers: bad \w+$/u);
  });
});
