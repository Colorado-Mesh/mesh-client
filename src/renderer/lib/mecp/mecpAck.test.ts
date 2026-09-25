import { describe, expect, it } from 'vitest';

import { isBeaconAck, isBeaconCancel } from './engine';
import type { EmergencyIncident } from './incidentTypes';
import {
  composeBeaconAck,
  composeBeaconCancel,
  composeGeneralAck,
  echoedAckCodes,
  findOpenIncidentForAck,
  isGeneralAck,
} from './mecpAck';
import { getByteLength, MAX_MESSAGE_BYTES, MECP_REGEX, tryParseMecp } from './mecpMessages';

function incident(partial: Partial<EmergencyIncident> & Pick<EmergencyIncident, 'id'>) {
  return {
    protocol: 'meshtastic',
    protocolsSeen: ['meshtastic'],
    severity: 0,
    codes: ['M01'],
    freetext: '',
    senderId: '!victim',
    senderName: 'Victim',
    channel: null,
    receivedAt: 1_000,
    lastSeenAt: 1_000,
    coordsSource: null,
    messageIds: [],
    ackCount: 0,
    ackPeerIds: [],
    beaconActive: false,
    beaconAcked: false,
    isDrill: false,
    status: 'open',
    ...partial,
  } satisfies EmergencyIncident;
}

describe('composeGeneralAck', () => {
  it('round-trips R01 + echoed codes + callsign, and is not a beacon ACK', () => {
    const msg = composeGeneralAck(0, ['M01', 'P05'], { callsign: 'KD5IHC', freetext: 'on way' });
    expect(msg).toBe('MECP/0/R01 M01 P05 on way ~KD5IHC');
    expect(MECP_REGEX.test(msg)).toBe(true);
    const parsed = tryParseMecp(msg)!;
    expect(parsed.severity).toBe(0);
    expect(parsed.codes).toEqual(['R01', 'M01', 'P05']);
    expect(parsed.extracted.callsign).toBe('KD5IHC');
    expect(isBeaconAck(parsed.codes)).toBe(false);
    expect(isGeneralAck(parsed.codes)).toBe(true);
    expect(echoedAckCodes(parsed.codes)).toEqual(['M01', 'P05']);
  });

  it('dedupes R01, drops invalid codes, and sanitizes callsign', () => {
    const msg = composeGeneralAck(2, ['R01', 'bad', 'T04'], { callsign: 'W1-AW/portable' });
    expect(msg).toBe('MECP/2/R01 T04 ~W1AWporta');
    expect(tryParseMecp(msg)!.extracted.callsign).toBe('W1AWporta');
  });

  it('stays under the byte limit and keeps the callsign', () => {
    const msg = composeGeneralAck(1, ['M01'], { callsign: 'EOC1', freetext: 'é'.repeat(300) });
    expect(getByteLength(msg)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(msg.endsWith(' ~EOC1')).toBe(true);
    expect(tryParseMecp(msg)!.extracted.callsign).toBe('EOC1');
  });

  it('drops trailing echoed codes when codes alone overflow', () => {
    const codes = Array.from({ length: 60 }, (_, i) => `M${String(i % 100).padStart(2, '0')}`);
    const msg = composeGeneralAck(0, codes, { callsign: 'EOC1' });
    expect(getByteLength(msg)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(tryParseMecp(msg)!.codes[0]).toBe('R01');
  });
});

describe('composeBeaconAck / composeBeaconCancel', () => {
  it('round-trips B02 with the decoder', () => {
    const msg = composeBeaconAck(0, { freetext: 'heard you' });
    expect(msg).toBe('MECP/0/B02 heard you');
    const parsed = tryParseMecp(msg)!;
    expect(isBeaconAck(parsed.codes)).toBe(true);
    expect(isBeaconCancel(parsed.codes)).toBe(false);
  });

  it('round-trips B03 with the decoder', () => {
    const msg = composeBeaconCancel(3);
    expect(msg).toBe('MECP/3/B03');
    const parsed = tryParseMecp(msg)!;
    expect(isBeaconCancel(parsed.codes)).toBe(true);
    expect(isBeaconAck(parsed.codes)).toBe(false);
  });

  it('truncates long freetext', () => {
    const msg = composeBeaconAck(1, { freetext: 'x'.repeat(400) });
    expect(getByteLength(msg)).toBe(MAX_MESSAGE_BYTES);
  });
});

describe('findOpenIncidentForAck', () => {
  it('matches by echoed codes and severity', () => {
    const a = incident({ id: 'a', codes: ['M01', 'P05'], severity: 0 });
    const b = incident({ id: 'b', codes: ['T04'], severity: 1, senderId: '!other' });
    const hit = findOpenIncidentForAck([a, b], {
      severity: 1,
      codes: ['R01', 'T04'],
      senderId: '!acker',
    });
    expect(hit?.id).toBe('b');
  });

  it('prefers exact code-set match over partial overlap', () => {
    const partial = incident({ id: 'p', codes: ['M01', 'M07', 'P05'], lastSeenAt: 5_000 });
    const exact = incident({ id: 'e', codes: ['M01'], senderId: '!two', lastSeenAt: 1_000 });
    const hit = findOpenIncidentForAck([partial, exact], { severity: 0, codes: ['R01', 'M01'] });
    expect(hit?.id).toBe('e');
  });

  it('skips resolved incidents and non-overlapping codes', () => {
    const resolved = incident({ id: 'r', status: 'resolved', resolvedAt: 2_000 });
    const other = incident({ id: 'o', codes: ['W01'] });
    expect(
      findOpenIncidentForAck([resolved, other], { severity: 0, codes: ['R01', 'M01'] }),
    ).toBeNull();
  });

  it('uses preferSenderId to pick the original distress sender', () => {
    const one = incident({ id: '1', senderId: '!one', lastSeenAt: 9_000 });
    const two = incident({ id: '2', senderId: '!two', lastSeenAt: 1_000 });
    const hit = findOpenIncidentForAck(
      [one, two],
      { severity: 0, codes: ['R01', 'M01'], senderId: '!acker' },
      { preferSenderId: '!two' },
    );
    expect(hit?.id).toBe('2');
  });

  it("never matches the ACK sender's own incidents, even via preferSenderId", () => {
    const own = incident({ id: 'own', senderId: '!acker', lastSeenAt: 9_000 });
    const victim = incident({ id: 'v', senderId: '!victim', lastSeenAt: 1_000 });
    const hit = findOpenIncidentForAck(
      [own, victim],
      { severity: 0, codes: ['R01', 'M01'], senderId: '!acker' },
      { preferSenderId: '!acker' },
    );
    expect(hit?.id).toBe('v');
    expect(
      findOpenIncidentForAck([own], { severity: 0, codes: ['R01', 'M01'], senderId: '!acker' }),
    ).toBeNull();
  });

  it('matches B02 only against active beacons', () => {
    const plain = incident({ id: 'plain', lastSeenAt: 9_000 });
    const beacon = incident({ id: 'beacon', codes: ['B01', 'M01'], beaconActive: true });
    expect(findOpenIncidentForAck([plain, beacon], { severity: 0, codes: ['B02'] })?.id).toBe(
      'beacon',
    );
    expect(findOpenIncidentForAck([plain], { severity: 0, codes: ['B02'] })).toBeNull();
  });

  it('breaks ties by most recent lastSeenAt', () => {
    const older = incident({ id: 'old', lastSeenAt: 1_000 });
    const newer = incident({ id: 'new', senderId: '!n', lastSeenAt: 2_000 });
    expect(findOpenIncidentForAck([older, newer], { severity: 0, codes: ['R01', 'M01'] })?.id).toBe(
      'new',
    );
  });
});
