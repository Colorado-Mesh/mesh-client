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
    const msg = composeGeneralAck(0, ['M01', 'P05'], {
      callsign: 'KD5IHC',
      freetext: 'Received report from Ada.',
    });
    expect(msg).toBe('MECP/0/R01 M01 P05 Received report from Ada. ~KD5IHC [MAYDAY ACK: Received]');
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
    expect(msg).toBe('MECP/2/R01 T04 ~W1AWporta [SAFETY ACK: Received]');
    expect(tryParseMecp(msg)!.extracted.callsign).toBe('W1AWporta');
  });

  it('keeps operator notes and the callsign when the complete message fits', () => {
    const notes = 'é'.repeat(60);
    const msg = composeGeneralAck(1, ['M01'], { callsign: 'EOC1', freetext: notes });
    expect(getByteLength(msg)).toBeLessThanOrEqual(MAX_MESSAGE_BYTES);
    expect(msg).toContain(`${notes} ~EOC1`);
    expect(tryParseMecp(msg)!.extracted.callsign).toBe('EOC1');
  });

  it('rejects oversized operator notes instead of silently truncating them', () => {
    expect(() =>
      composeGeneralAck(1, ['M01'], { callsign: 'EOC1', freetext: 'é'.repeat(300) }),
    ).toThrow(RangeError);
  });

  it('rejects oversized echoed codes instead of silently dropping references', () => {
    const codes = Array.from({ length: 60 }, (_, i) => `M${String(i % 100).padStart(2, '0')}`);
    expect(() => composeGeneralAck(0, codes, { callsign: 'EOC1' })).toThrow(RangeError);
  });

  it('enforces the destination transport budget and keeps drill markers', () => {
    const msg = composeGeneralAck(3, ['D02'], { freetext: 'Received report from Ada.' });
    expect(msg).toContain('[TEST ONLY: Received; This is a test]');
    const exactLimit = getByteLength(msg);
    expect(
      composeGeneralAck(3, ['D02'], {
        freetext: 'Received report from Ada.',
        maxBytes: exactLimit,
      }),
    ).toBe(msg);
    expect(() =>
      composeGeneralAck(3, ['D02'], {
        freetext: 'Received report from Ada.',
        maxBytes: exactLimit - 1,
      }),
    ).toThrow(RangeError);
  });
});

describe('composeBeaconAck / composeBeaconCancel', () => {
  it('round-trips B02 with the decoder', () => {
    const msg = composeBeaconAck(0, { freetext: 'heard you' });
    expect(msg).toBe('MECP/0/B02 heard you [MAYDAY: Beacon received]');
    const parsed = tryParseMecp(msg)!;
    expect(isBeaconAck(parsed.codes)).toBe(true);
    expect(isBeaconCancel(parsed.codes)).toBe(false);
  });

  it('round-trips B03 with the decoder', () => {
    const msg = composeBeaconCancel(3);
    expect(msg).toBe('MECP/3/B03 [ROUTINE: Cancel beacon — I am OK]');
    const parsed = tryParseMecp(msg)!;
    expect(isBeaconCancel(parsed.codes)).toBe(true);
    expect(isBeaconAck(parsed.codes)).toBe(false);
  });

  it('rejects oversized beacon notes instead of silently truncating them', () => {
    expect(() => composeBeaconAck(1, { freetext: 'x'.repeat(400) })).toThrow(RangeError);
  });

  it.each([composeBeaconAck, composeBeaconCancel])(
    'keeps drill markers without echoing distress codes in beacon control messages',
    (compose) => {
      const msg = compose(0, { drillCodes: ['B01', 'M01', 'D02', 'D02'] });
      expect(tryParseMecp(msg)!.codes).toEqual([
        compose === composeBeaconAck ? 'B02' : 'B03',
        'D02',
      ]);
      expect(tryParseMecp(msg)!.isDrill).toBe(true);
      expect(msg).toContain('[TEST ONLY:');
    },
  );

  it.each([composeBeaconAck, composeBeaconCancel])(
    'rejects a beacon control message that exceeds the transport budget',
    (compose) => {
      const msg = compose(0);
      expect(() => compose(0, { maxBytes: getByteLength(msg) - 1 })).toThrow(RangeError);
    },
  );
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

  it.each(['D01', 'D02'])('never applies a %s beacon ACK to a real beacon', (drillCode) => {
    const real = incident({ id: 'real', codes: ['B01', 'M01'], beaconActive: true });
    expect(findOpenIncidentForAck([real], { severity: 0, codes: ['B02', drillCode] })).toBeNull();
    const drill = incident({
      id: 'drill',
      codes: ['B01', 'M01', drillCode],
      beaconActive: true,
      isDrill: true,
      senderId: '!drill',
    });
    expect(
      findOpenIncidentForAck([real, drill], { severity: 0, codes: ['B02', drillCode] })?.id,
    ).toBe('drill');
  });

  it('keeps an unmarked legacy B02 within real incidents even if a drill is newer', () => {
    const real = incident({ id: 'real', codes: ['B01'], beaconActive: true });
    const drill = incident({
      id: 'drill',
      codes: ['B01', 'D02'],
      beaconActive: true,
      isDrill: true,
      senderId: '!drill',
      lastSeenAt: 9_000,
    });
    expect(findOpenIncidentForAck([real, drill], { severity: 0, codes: ['B02'] })?.id).toBe('real');
    expect(findOpenIncidentForAck([drill], { severity: 0, codes: ['B02'] })).toBeNull();
  });

  it('uses the parsed drill flag when it is available', () => {
    const real = incident({ id: 'real', lastSeenAt: 9_000 });
    const drill = incident({ id: 'drill', isDrill: true, senderId: '!drill' });
    expect(
      findOpenIncidentForAck([real, drill], { severity: 0, codes: ['R01', 'M01'], isDrill: true })
        ?.id,
    ).toBe('drill');
  });

  it('keeps general drill ACKs separate from real reports with overlapping distress codes', () => {
    const real = incident({ id: 'real', lastSeenAt: 9_000 });
    const drill = incident({
      id: 'drill',
      codes: ['D02', 'M01'],
      isDrill: true,
      senderId: '!drill',
    });
    expect(
      findOpenIncidentForAck([real], { severity: 0, codes: ['R01', 'D02', 'M01'] }),
    ).toBeNull();
    expect(
      findOpenIncidentForAck([real, drill], { severity: 0, codes: ['R01', 'D02', 'M01'] })?.id,
    ).toBe('drill');
    expect(findOpenIncidentForAck([real, drill], { severity: 0, codes: ['R01', 'M01'] })?.id).toBe(
      'real',
    );
  });

  it('breaks ties by most recent lastSeenAt', () => {
    const older = incident({ id: 'old', lastSeenAt: 1_000 });
    const newer = incident({ id: 'new', senderId: '!n', lastSeenAt: 2_000 });
    expect(findOpenIncidentForAck([older, newer], { severity: 0, codes: ['R01', 'M01'] })?.id).toBe(
      'new',
    );
  });
});
