import { render } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmergencyIncident } from '@/renderer/lib/mecp/incidentTypes';
import { resetStartupDbPruneForTests } from '@/renderer/lib/startupDbPrune';
import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';
import { useIncidentStore } from '@/renderer/stores/incidentStore';

import { incidentPruneOptions, useAppStartupDbPrune } from './useAppStartupDbPrune';

describe('useAppStartupDbPrune', () => {
  beforeEach(() => {
    resetStartupDbPruneForTests();
    vi.mocked(window.electronAPI.db.migrateRfStubNodes).mockClear();
  });

  afterEach(() => {
    resetStartupDbPruneForTests();
  });

  it('starts the startup prune before passive effects declared ahead of it run', () => {
    // App calls the protocol runtimes before this hook; their mount loads must find the prune
    // already in flight so they can wait for it.
    const warn = mockConsoleWarn();
    let pruneCallsSeenByEarlierEffect = -1;
    function Probe() {
      useEffect(() => {
        pruneCallsSeenByEarlierEffect = vi.mocked(window.electronAPI.db.migrateRfStubNodes).mock
          .calls.length;
      }, []);
      useAppStartupDbPrune(() => undefined);
      return null;
    }
    const view = render(createElement(Probe));
    expect(pruneCallsSeenByEarlierEffect).toBe(1);
    view.unmount();
    warn.restore();
  });
});

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

  it('forwards decimal String(msg.from) sender ids across protocols', () => {
    useIncidentStore.setState({
      incidents: {
        mt: incident('mt', String(0xdeadbeef), 'open'),
        mc: {
          ...incident('mc', String(0x12345678), 'acked'),
          protocol: 'meshcore',
          protocolsSeen: ['meshcore'],
        },
      },
    });
    expect([...(incidentPruneOptions().exemptNodeIds ?? [])].sort()).toEqual(
      [String(0x12345678), String(0xdeadbeef)].sort(),
    );
  });

  it('is empty with no incidents', () => {
    expect([...(incidentPruneOptions().exemptNodeIds ?? [])]).toEqual([]);
  });
});
