import { afterEach, describe, expect, it } from 'vitest';

import type { EmergencyIncident } from '../mecp/incidentTypes';
import { takIncidentMarkers } from './takIncidentMarkers';
import { resetTakMecpLocale } from './takMecpText';

const SEEN = Date.parse('2026-10-28T19:58:30Z');

/** An open incident with a reported position, with overridable fields. */
function incident(overrides: Partial<EmergencyIncident> = {}): EmergencyIncident {
  return {
    id: 'mecp-abc',
    protocol: 'meshcore',
    protocolsSeen: ['meshcore'],
    severity: 0,
    codes: ['M01'],
    freetext: '2pax 39.7392,-104.9903',
    senderId: '12345',
    senderName: 'Alice',
    channel: '0',
    receivedAt: SEEN,
    lastSeenAt: SEEN,
    lat: 39.7392,
    lon: -104.9903,
    coordsSource: 'message',
    messageIds: ['m1'],
    ackCount: 0,
    ackPeerIds: [],
    beaconActive: false,
    beaconAcked: false,
    isDrill: false,
    status: 'open',
    ...overrides,
  };
}

const byId = (...list: EmergencyIncident[]) => Object.fromEntries(list.map((i) => [i.id, i]));

afterEach(() => {
  resetTakMecpLocale();
});

describe('takIncidentMarkers', () => {
  it('makes a marker of an open incident with a position, in words', () => {
    expect(takIncidentMarkers(byId(incident()))).toEqual([
      {
        id: 'mecp-abc',
        callsign: '🆘 MAYDAY Alice',
        remarks:
          '🆘 MAYDAY: Injury · 2 people · 39.7392, -104.9903\n' +
          'MECP/0/M01 2pax 39.7392,-104.9903\n' +
          'From Alice, last heard 2026-10-28 19:58 UTC',
        lat: 39.7392,
        lon: -104.9903,
        severity: 0,
        drill: false,
      },
    ]);
  });

  it('leaves out resolved incidents and those with no position', () => {
    expect(
      takIncidentMarkers(
        byId(
          incident({ id: 'resolved', status: 'resolved' }),
          incident({ id: 'nowhere', lat: undefined, lon: undefined }),
          incident({ id: 'acked', status: 'acked' }),
        ),
      ).map((m) => m.id),
    ).toEqual(['acked']);
  });

  it('leaves out a position off the map, which main would refuse with the rest', () => {
    expect(
      takIncidentMarkers(
        byId(incident({ id: 'off', lat: 123, lon: 456 }), incident({ id: 'ok' })),
      ).map((m) => m.id),
    ).toEqual(['ok']);
  });

  it('turns control characters in a sender name into spaces, keeping the remark lines', () => {
    const [marker] = takIncidentMarkers(byId(incident({ senderName: 'Al\nice\u0007' })));
    expect(marker.callsign).toBe('🆘 MAYDAY Al ice');
    expect(marker.remarks.split('\n')).toHaveLength(3);
    expect(marker.remarks).toContain('From Al ice, last heard');
    expect(marker.remarks).not.toMatch(/[^\P{Cc}\n]/u);
  });

  it('says where the position came from, a beacon, and the acknowledgements heard', () => {
    const [marker] = takIncidentMarkers(
      byId(incident({ coordsSource: 'lastKnown', beaconActive: true, ackCount: 2 })),
    );
    expect(marker.remarks.split('\n').slice(3)).toEqual([
      'Position: where the sender was last heard, not from the report',
      'Distress beacon active',
      '2 acknowledgements heard',
    ]);
  });

  it('marks a drill and puts the most severe, then the latest, first', () => {
    const markers = takIncidentMarkers(
      byId(
        incident({ id: 'routine', severity: 3, codes: ['R01'], freetext: '' }),
        incident({ id: 'old-mayday', lastSeenAt: SEEN - 60_000 }),
        incident({ id: 'drill', isDrill: true, codes: ['D01', 'M01'] }),
      ),
    );
    expect(markers.map((m) => m.id)).toEqual(['drill', 'old-mayday', 'routine']);
    expect(markers[0]).toMatchObject({ callsign: 'DRILL 🆘 MAYDAY Alice', drill: true });
  });

  it('names an unnamed sender by id, and keeps at most 50 markers', () => {
    expect(takIncidentMarkers(byId(incident({ senderName: ' ' })))[0]?.callsign).toBe(
      '🆘 MAYDAY 12345',
    );
    const many = Array.from({ length: 60 }, (_, i) => incident({ id: `mecp-${i}` }));
    expect(takIncidentMarkers(byId(...many))).toHaveLength(50);
  });
});
