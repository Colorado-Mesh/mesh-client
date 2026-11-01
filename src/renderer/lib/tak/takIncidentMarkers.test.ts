import { afterEach, describe, expect, it } from 'vitest';

import type { EmergencyIncident } from '../mecp/incidentTypes';
import { resetTakIncidentAlarms, takIncidentMarkers } from './takIncidentMarkers';
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
  resetTakIncidentAlarms();
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
    const [marker] = takIncidentMarkers(
      byId(
        incident({ senderName: 'Al\nice\u0007', freetext: '2pax 39.7392,-104.9903 cold\u0007' }),
      ),
    );
    expect(marker.callsign).toBe('🆘 MAYDAY Al ice');
    expect(marker.remarks.split('\n')).toHaveLength(3);
    expect(marker.remarks).toContain('From Al ice, last heard');
    expect(marker.remarks).not.toMatch(/[^\P{Cc}\n]/u);
  });

  it('turns characters XML cannot hold into spaces, in the name and the report', () => {
    const [marker] = takIncidentMarkers(
      byId(
        incident({
          senderName: 'Al\uFFFEice',
          freetext: '2pax 39.7392,-104.9903 cold\uFFFF here\uD800',
        }),
      ),
    );
    expect(marker.callsign).toBe('🆘 MAYDAY Al ice');
    expect(marker.remarks).not.toMatch(/[\p{Cs}\uFFFE\uFFFF]/u);
    expect(marker.remarks).toContain('cold  here');
  });

  it('leaves out an id main would refuse, so the others still go', () => {
    expect(
      takIncidentMarkers(byId(incident({ id: 'mecp/a' }), incident({ id: 'mecp-ok' }))).map(
        (m) => m.id,
      ),
    ).toEqual(['mecp-ok']);
  });

  it('gives a time no Date can hold as ?, rather than failing', () => {
    const [marker] = takIncidentMarkers(byId(incident({ lastSeenAt: 1e20 })));
    expect(marker.remarks).toContain('From Alice, last heard ? UTC');
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

describe("takIncidentMarkers and ATAK's emergency alarm", () => {
  const NOBODY_BLOCKED = { isBlocked: () => false };
  /** Who each marker's alarm names, by incident id. */
  const alarms = (
    incidents: Record<string, EmergencyIncident>,
    alarm: Parameters<typeof takIncidentMarkers>[1] = NOBODY_BLOCKED,
  ) =>
    Object.fromEntries(
      takIncidentMarkers(incidents, alarm)
        .filter((m) => m.alarm !== undefined)
        .map((m) => [m.id, m.alarm]),
    );

  it('sounds for an unseen MAYDAY with a position, named for the sender', () => {
    expect(alarms(byId(incident()))).toEqual({ 'mecp-abc': 'Alice' });
    expect(alarms(byId(incident({ senderName: ' ' })))).toEqual({ 'mecp-abc': '12345' });
    // One character longer than an alarm name can be: named by the incident instead.
    const overlong = `a${'\u0301'.repeat(100)}`;
    expect(alarms(byId(incident({ senderName: overlong })))).toEqual({ 'mecp-abc': 'mecp-abc' });
  });

  it('never sounds unless the user turned it on', () => {
    expect(takIncidentMarkers(byId(incident()))[0]).not.toHaveProperty('alarm');
  });

  it("stays quiet for a drill, a lesser report, or this station's own beacon", () => {
    expect(
      alarms(
        byId(
          incident({ id: 'drill', isDrill: true }),
          incident({ id: 'urgent', severity: 1 }),
          incident({ id: 'own', localOrigin: true, beaconActive: true }),
        ),
      ),
    ).toEqual({});
  });

  it('stays quiet for one already seen: read from history, or from a throttled sender', () => {
    expect(alarms(byId(incident({ seenAt: SEEN })))).toEqual({});
  });

  it('stays quiet for a blocked sender, whichever protocol it was heard on', () => {
    const relayed = incident({ protocol: 'meshtastic', protocolsSeen: ['meshcore', 'meshtastic'] });
    expect(
      alarms(byId(relayed), {
        isBlocked: (inc) => inc.protocolsSeen.includes('meshcore') && inc.senderId === '12345',
      }),
    ).toEqual({});
  });

  it('keeps sounding once the operator has seen it, until there is a reason to stop', () => {
    expect(alarms(byId(incident()))).toEqual({ 'mecp-abc': 'Alice' });
    expect(alarms(byId(incident({ seenAt: SEEN + 1 })))).toEqual({ 'mecp-abc': 'Alice' });
    // Building the same list again gives the same alarms.
    expect(alarms(byId(incident({ seenAt: SEEN + 1 })))).toEqual({ 'mecp-abc': 'Alice' });
    expect(alarms(byId(incident({ seenAt: SEEN + 1, status: 'resolved' })))).toEqual({});
    // Gone once stopped: seen, it does not start again.
    expect(alarms(byId(incident({ seenAt: SEEN + 1 })))).toEqual({});
  });

  it('stops when the beacon is cancelled, and may sound again once the incident reopens', () => {
    const cancelled = incident({
      events: [
        { at: SEEN, kind: 'received' },
        { at: SEEN + 1, kind: 'beaconCancelled' },
      ],
    });
    expect(alarms(byId(cancelled))).toEqual({});
    const reopened = incident({
      events: [...(cancelled.events ?? []), { at: SEEN + 2, kind: 'reopened' }],
    });
    expect(alarms(byId(reopened))).toEqual({ 'mecp-abc': 'Alice' });
  });

  it('forgets what was sounding when turned off', () => {
    expect(alarms(byId(incident()))).toEqual({ 'mecp-abc': 'Alice' });
    takIncidentMarkers(byId(incident({ seenAt: SEEN + 1 })));
    expect(alarms(byId(incident({ seenAt: SEEN + 1 })))).toEqual({});
  });
});
