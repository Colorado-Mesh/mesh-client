import { beforeEach, describe, expect, it } from 'vitest';

import type { EmergencyIncident } from '@/renderer/lib/mecp/incidentTypes';
import { useIncidentStore } from '@/renderer/stores/incidentStore';

import { incidentPruneOptions } from './useAppStartupDbPrune';

function incident(id: string, senderId: string, status: EmergencyIncident['status']) {
  return {
    id,
    protocol: 'meshtastic',
    protocolsSeen: ['meshtastic'],
    severity: 0,
    codes: ['A01'],
    freetext: '',
    senderId,
    senderName: senderId,
    channel: null,
    receivedAt: 1,
    lastSeenAt: 1,
    coordsSource: null,
    messageIds: [],
    ackCount: 0,
    ackPeerIds: [],
    beaconActive: false,
    beaconAcked: false,
    isDrill: false,
    status,
  } as EmergencyIncident;
}

describe('incidentPruneOptions (S12)', () => {
  beforeEach(() => {
    useIncidentStore.setState({ incidents: {} });
  });

  it('exempts senders of open and acked incidents only', () => {
    useIncidentStore.setState({
      incidents: {
        a: incident('a', '!0000abcd', 'open'),
        b: incident('b', '!0000beef', 'acked'),
        c: incident('c', '!0000dead', 'resolved'),
      },
    });
    expect([...(incidentPruneOptions().exemptNodeIds ?? [])].sort()).toEqual([
      '!0000abcd',
      '!0000beef',
    ]);
  });

  it('is empty with no incidents', () => {
    expect([...(incidentPruneOptions().exemptNodeIds ?? [])]).toEqual([]);
  });
});
