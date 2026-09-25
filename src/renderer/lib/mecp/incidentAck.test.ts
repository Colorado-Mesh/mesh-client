import { describe, expect, it } from 'vitest';

import { composeIncidentAck, resolveIncidentAckRoute } from './incidentAck';
import type { EmergencyIncident } from './incidentTypes';

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
    expect(text).toMatch(/^MECP\/0\/R01 M01 T04/);
    expect(text).not.toContain('B02');
  });

  it('composes a B02 beacon ACK for an unacknowledged active beacon', () => {
    const text = composeIncidentAck(incident({ codes: ['B01'], beaconActive: true }));
    expect(text).toMatch(/^MECP\/0\/B02/);
    expect(text).not.toContain('R01');
  });

  it('falls back to the general ACK once the beacon was already acknowledged', () => {
    const text = composeIncidentAck(
      incident({ codes: ['B01', 'M01'], beaconActive: true, beaconAcked: true }),
    );
    expect(text).toMatch(/^MECP\/0\/R01/);
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

  it('targets the incident protocol (queued) when not heard on the active protocol', () => {
    const route = resolveIncidentAckRoute(incident(), 'reticulum', never);
    expect(route).toMatchObject({ protocol: 'meshtastic', channel: 2, viaActiveProtocol: false });
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
