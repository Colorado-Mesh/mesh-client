import { describe, expect, it } from 'vitest';

import {
  composeIncidentAck,
  incidentAckViewKey,
  parseIncidentAckViewKey,
  resolveIncidentAckRoute,
} from './incidentAck';
import type { EmergencyIncident } from './incidentTypes';
import { getByteLength, tryParseMecp } from './mecpMessages';

function incident(partial: Partial<EmergencyIncident> = {}): EmergencyIncident {
  return {
    id: 'mecp-1',
    protocol: 'meshtastic',
    protocolsSeen: ['meshtastic'],
    severity: 0,
    codes: ['M01'],
    freetext: '',
    senderId: '42',
    senderName: 'Ada',
    channel: '2',
    receivedAt: 1,
    lastSeenAt: 1,
    coordsSource: null,
    messageIds: [],
    ackCount: 0,
    ackPeerIds: [],
    beaconActive: false,
    beaconAcked: false,
    isDrill: false,
    status: 'open',
    ...partial,
  };
}

describe('composeIncidentAck', () => {
  it('composes a general R01 ACK echoing codes for non-beacon incidents', () => {
    const text = composeIncidentAck(incident({ codes: ['M01', 'T04'] }));
    expect(text).toBe('MECP/0/R01 M01 T04');
  });

  it('composes a B02 beacon ACK for an unacknowledged active beacon', () => {
    const text = composeIncidentAck(incident({ codes: ['B01'], beaconActive: true }));
    expect(text).toBe('MECP/0/B02');
  });

  it('falls back to the general ACK once the beacon was already acknowledged', () => {
    const text = composeIncidentAck(
      incident({ codes: ['B01', 'M01'], beaconActive: true, beaconAcked: true }),
    );
    expect(text).toBe('MECP/0/R01 B01 M01');
  });

  it.each(['Ada', '', '名'.repeat(100)])(
    'does not generate sender-name prose (%s)',
    (senderName) => {
      expect(composeIncidentAck(incident({ senderName }))).toBe('MECP/0/R01 M01');
    },
  );

  it.each([false, true])(
    'permits explicit notes and translated explanations (beacon: %s)',
    (beaconActive) => {
      const text = composeIncidentAck(incident({ beaconActive }), {
        freetext: 'norte',
        explanationLanguage: 'es',
        includeHelpLink: true,
      });
      expect(text.startsWith(`MECP/0/${beaconActive ? 'B02' : 'R01 M01'} norte `)).toBe(true);
      expect(text).toContain(beaconActive ? 'Baliza confirmada' : 'Recibido');
      expect(text).toContain('https://mecp.radio');
      expect(text).not.toContain('Received');
    },
  );

  it.each([false, true])('retains test-only suppression on ACKs (beacon: %s)', (beaconActive) => {
    const text = composeIncidentAck(
      incident({ codes: ['D02', 'M01'], beaconActive, isDrill: true }),
    );
    expect(tryParseMecp(text)!.codes).toContain('D02');
    expect(tryParseMecp(text)!.isDrill).toBe(true);
    expect(text).toBe(beaconActive ? 'MECP/0/B02 D02' : 'MECP/0/R01 D02 M01');
  });

  it('retains test-only suppression on legacy drill incidents without a drill code', () => {
    const text = composeIncidentAck(
      incident({ codes: ['B01'], beaconActive: true, isDrill: true }),
    );
    expect(tryParseMecp(text)!.codes).toEqual(['B02', 'D02']);
    expect(tryParseMecp(text)!.isDrill).toBe(true);
  });

  it('refuses an ACK that cannot preserve its code references within the budget', () => {
    const original = incident({ codes: ['M01', 'T04'] });
    const text = composeIncidentAck(original);
    expect(() => composeIncidentAck(original, { maxBytes: getByteLength(text) - 1 })).toThrow(
      RangeError,
    );
    expect(original.codes).toEqual(['M01', 'T04']);
    expect(original.status).toBe('open');
    expect(original.ackCount).toBe(0);
  });
});

describe('resolveIncidentAckRoute', () => {
  const never = () => false;

  it('uses the active protocol and incident channel when heard there', () => {
    expect(resolveIncidentAckRoute(incident(), 'meshtastic', never)).toEqual({
      protocol: 'meshtastic',
      channel: 2,
      toNode: null,
      viaActiveProtocol: true,
    });
  });

  it('prefers the active protocol from protocolsSeen, on its default channel', () => {
    const route = resolveIncidentAckRoute(
      incident({ protocol: 'meshtastic', protocolsSeen: ['meshtastic', 'meshcore'] }),
      'meshcore',
      never,
    );
    expect(route).toMatchObject({ protocol: 'meshcore', channel: 0, viaActiveProtocol: true });
  });

  it('targets the origin protocol (queued) when not heard on the active protocol', () => {
    const route = resolveIncidentAckRoute(
      incident({
        protocol: 'meshcore',
        protocolsSeen: ['meshtastic', 'meshcore'],
        channel: '2',
      }),
      'reticulum',
      never,
    );
    expect(route).toMatchObject({ protocol: 'meshtastic', channel: 2, viaActiveProtocol: false });
  });

  it('DMs the relay on a non-origin DM-only protocol, else falls back to origin', () => {
    const viaRelay = resolveIncidentAckRoute(
      incident({
        protocol: 'reticulum',
        protocolsSeen: ['meshtastic', 'reticulum'],
        senderId: '!victim',
        relaySenderIds: ['99'],
        channel: '2',
      }),
      'reticulum',
      (p) => p === 'reticulum',
    );
    expect(viaRelay).toMatchObject({
      protocol: 'reticulum',
      channel: 0,
      toNode: 99,
      viaActiveProtocol: true,
    });

    const fallback = resolveIncidentAckRoute(
      incident({
        protocol: 'reticulum',
        protocolsSeen: ['meshtastic', 'reticulum'],
        senderId: '42',
        channel: '2',
      }),
      'reticulum',
      (p) => p === 'reticulum',
    );
    expect(fallback).toMatchObject({
      protocol: 'meshtastic',
      channel: 2,
      toNode: null,
      viaActiveProtocol: true,
    });
  });

  it('DMs the sender on DM-only protocols', () => {
    const route = resolveIncidentAckRoute(
      incident({ protocol: 'reticulum', protocolsSeen: ['reticulum'], channel: '0' }),
      'reticulum',
      (p) => p === 'reticulum',
    );
    expect(route.toNode).toBe(42);
  });

  it('defaults malformed channels to 0', () => {
    expect(resolveIncidentAckRoute(incident({ channel: 'x' }), 'meshtastic', never).channel).toBe(
      0,
    );
  });
});

describe('incidentAckViewKey', () => {
  it('round-trips the incident id for channel and DM destinations', () => {
    expect(
      parseIncidentAckViewKey(incidentAckViewKey('mecp-1', { toNode: null, channel: 2 })),
    ).toBe('mecp-1');
    expect(parseIncidentAckViewKey(incidentAckViewKey('mecp-1', { toNode: 42, channel: 0 }))).toBe(
      'mecp-1',
    );
    expect(parseIncidentAckViewKey('ch:0')).toBeNull();
  });
});
