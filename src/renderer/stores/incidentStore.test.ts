import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tryParseMecp } from '@/renderer/lib/mecp/mecpMessages';
import type { MeshProtocol } from '@/shared/meshProtocol';

const STORAGE_KEY = 'mesh-client:incidents';

async function loadStore() {
  return import('./incidentStore');
}

function report(
  text: string,
  opts: {
    protocol?: MeshProtocol;
    senderId?: string;
    messageId?: string;
    receivedAt?: number;
    lastKnown?: { lat: number; lon: number } | null;
  } = {},
) {
  const parsed = tryParseMecp(text);
  if (!parsed) throw new Error(`not MECP: ${text}`);
  return {
    protocol: opts.protocol ?? 'meshtastic',
    parsed,
    senderId: opts.senderId ?? '!victim',
    senderName: 'Victim',
    channel: 'LongFast',
    messageId: opts.messageId,
    receivedAt: opts.receivedAt ?? 1_000,
    lastKnown: opts.lastKnown,
  };
}

describe('incidentStore', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.removeItem(STORAGE_KEY);
  });

  it('merges the same fingerprint across protocols', async () => {
    const { useIncidentStore, openIncidentCount } = await loadStore();
    const s = useIncidentStore.getState();
    const a = s.upsertFromMecp(report('MECP/0/M01 2pax', { messageId: 'mt-1' }));
    const b = s.upsertFromMecp(
      report('MECP/0/M01 2pax', { protocol: 'meshcore', messageId: 'mc-1', receivedAt: 2_000 }),
    );
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    const inc = useIncidentStore.getState().incidents[a!];
    expect(inc.protocol).toBe('meshcore');
    expect(inc.protocolsSeen).toEqual(['meshtastic', 'meshcore']);
    expect(inc.messageIds).toEqual(['mt-1', 'mc-1']);
    expect(inc.lastSeenAt).toBe(2_000);
    expect(openIncidentCount(useIncidentStore.getState())).toBe(1);
  });

  it('does not open incidents for B02 or B03', async () => {
    const { useIncidentStore, openIncidentCount } = await loadStore();
    const s = useIncidentStore.getState();
    expect(s.upsertFromMecp(report('MECP/0/B02', { senderId: '!acker' }))).toBeNull();
    expect(s.upsertFromMecp(report('MECP/3/B03'))).toBeNull();
    expect(openIncidentCount(useIncidentStore.getState())).toBe(0);
  });

  it('B01 sets beaconActive; B02 from a peer records an ACK; B03 clears the beacon', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const id = s.upsertFromMecp(report('MECP/0/B01 M01'))!;
    expect(useIncidentStore.getState().incidents[id].beaconActive).toBe(true);

    expect(s.upsertFromMecp(report('MECP/0/B02', { senderId: '!acker' }))).toBe(id);
    let inc = useIncidentStore.getState().incidents[id];
    expect(inc.ackPeerIds).toEqual(['!acker']);
    expect(inc.status).toBe('acked');

    expect(s.upsertFromMecp(report('MECP/3/B03'))).toBe(id);
    inc = useIncidentStore.getState().incidents[id];
    expect(inc.beaconActive).toBe(false);
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(1);
  });

  it('general R01 ACK correlates by echoed codes without opening a row', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const id = s.upsertFromMecp(report('MECP/1/T04 1pax'))!;
    expect(s.upsertFromMecp(report('MECP/1/R01 T04 ~EOC1', { senderId: '!eoc' }))).toBe(id);
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(1);
    expect(useIncidentStore.getState().incidents[id].ackCount).toBe(1);
  });

  it('escalates severity for the same sender/codes/freetext and keeps the id', async () => {
    const { useIncidentStore, openMaydayUrgentCount } = await loadStore();
    const s = useIncidentStore.getState();
    const id = s.upsertFromMecp(report('MECP/2/M01 ridge'))!;
    expect(openMaydayUrgentCount(useIncidentStore.getState())).toBe(0);
    expect(s.upsertFromMecp(report('MECP/0/M01 ridge', { receivedAt: 3_000 }))).toBe(id);
    expect(useIncidentStore.getState().incidents[id].severity).toBe(0);
    // A later lower-severity copy never de-escalates.
    s.upsertFromMecp(report('MECP/3/M01 ridge', { receivedAt: 4_000 }));
    expect(useIncidentStore.getState().incidents[id].severity).toBe(0);
    expect(openMaydayUrgentCount(useIncidentStore.getState())).toBe(1);
  });

  it('prefers message coords over last-known position', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const id = s.upsertFromMecp(report('MECP/0/M01 2pax', { lastKnown: { lat: 1, lon: 2 } }))!;
    expect(useIncidentStore.getState().incidents[id]).toMatchObject({
      lat: 1,
      lon: 2,
      coordsSource: 'lastKnown',
    });
    const withGps = s.upsertFromMecp(report('MECP/0/M07 39.7,-104.9'))!;
    expect(useIncidentStore.getState().incidents[withGps]).toMatchObject({
      lat: 39.7,
      lon: -104.9,
      coordsSource: 'message',
    });
  });

  it('recordAck dedupes peers and ignores the incident sender', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const id = s.upsertFromMecp(report('MECP/0/M01'))!;
    s.recordAck(id, '!a');
    s.recordAck(id, '!a');
    s.recordAck(id, '!victim');
    s.recordAck(id, '!b');
    const inc = useIncidentStore.getState().incidents[id];
    expect(inc.ackPeerIds).toEqual(['!a', '!b']);
    expect(inc.ackCount).toBe(2);
    expect(inc.status).toBe('acked');
  });

  it('confirmBeacon marks beaconAcked', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const id = s.upsertFromMecp(report('MECP/0/B01'))!;
    s.confirmBeacon(id);
    expect(useIncidentStore.getState().incidents[id]).toMatchObject({
      beaconAcked: true,
      status: 'acked',
    });
  });

  it('resolveIncident closes the row; echoes within the grace window do not reopen', async () => {
    const { useIncidentStore, openIncidentCount, INCIDENT_REOPEN_GRACE_MS } = await loadStore();
    const s = useIncidentStore.getState();
    const id = s.upsertFromMecp(report('MECP/0/M01'))!;
    s.resolveIncident(id, 10_000);
    expect(useIncidentStore.getState().incidents[id]).toMatchObject({
      status: 'resolved',
      resolvedAt: 10_000,
    });
    expect(openIncidentCount(useIncidentStore.getState())).toBe(0);

    s.upsertFromMecp(report('MECP/0/M01', { protocol: 'meshcore', receivedAt: 11_000 }));
    expect(useIncidentStore.getState().incidents[id].status).toBe('resolved');

    s.upsertFromMecp(report('MECP/0/M01', { receivedAt: 10_001 + INCIDENT_REOPEN_GRACE_MS }));
    expect(useIncidentStore.getState().incidents[id].status).toBe('open');
    expect(useIncidentStore.getState().incidents[id].resolvedAt).toBeUndefined();
  });

  it('drills are tracked but excluded from counts', async () => {
    const { useIncidentStore, openIncidentCount } = await loadStore();
    const id = useIncidentStore.getState().upsertFromMecp(report('MECP/0/D01 M01'))!;
    expect(useIncidentStore.getState().incidents[id].isDrill).toBe(true);
    expect(openIncidentCount(useIncidentStore.getState())).toBe(0);
  });

  it('caps rows, evicting oldest resolved first', async () => {
    const { useIncidentStore, MAX_INCIDENTS } = await loadStore();
    const s = useIncidentStore.getState();
    const first = s.upsertFromMecp(report('MECP/3/L01 n0', { receivedAt: 0 }))!;
    const resolved = s.upsertFromMecp(report('MECP/3/L01 n1', { receivedAt: 1 }))!;
    s.resolveIncident(resolved, 2);
    for (let i = 2; i <= MAX_INCIDENTS; i++) {
      s.upsertFromMecp(report(`MECP/3/L01 n${i}`, { receivedAt: i }));
    }
    const incidents = useIncidentStore.getState().incidents;
    expect(Object.keys(incidents)).toHaveLength(MAX_INCIDENTS);
    expect(incidents[resolved]).toBeUndefined();
    expect(incidents[first]).toBeDefined();
  });

  it('merges GPS updates from the same sender into one incident', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const a = s.upsertFromMecp(report('MECP/0/M01 help 39.7,-105.0', { messageId: '1' }))!;
    const b = s.upsertFromMecp(
      report('MECP/0/M01 help 40.1,-104.5', { messageId: '2', receivedAt: 2_000 }),
    );
    expect(b).toBe(a);
    const inc = useIncidentStore.getState().incidents[a];
    expect(inc.lat).toBeCloseTo(40.1);
    expect(inc.lon).toBeCloseTo(-104.5);
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(1);
  });

  it('merges bridged copies from a different relay sender id within the window', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const a = s.upsertFromMecp(
      report('MECP/0/M01 trapped', {
        senderId: '!victim',
        protocol: 'meshtastic',
        messageId: 'mt',
        receivedAt: 1_000,
      }),
    )!;
    const b = s.upsertFromMecp(
      report('MECP/0/M01 trapped', {
        senderId: '!bridge',
        protocol: 'meshcore',
        messageId: 'mc',
        receivedAt: 2_000,
      }),
    );
    expect(b).toBe(a);
    const inc = useIncidentStore.getState().incidents[a];
    expect(inc.senderId).toBe('!victim');
    expect(inc.relaySenderIds).toEqual(['!bridge']);
    expect(inc.protocolsSeen).toEqual(['meshtastic', 'meshcore']);
  });

  it('does not merge two senders with the same GPS-only canned MAYDAY', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const a = s.upsertFromMecp(
      report('MECP/0/M01 39.7,-105.0', {
        senderId: '!alice',
        messageId: 'a',
        receivedAt: 1_000,
      }),
    )!;
    const b = s.upsertFromMecp(
      report('MECP/0/M01 40.1,-104.5', {
        senderId: '!bob',
        messageId: 'b',
        receivedAt: 2_000,
      }),
    )!;
    expect(b).not.toBe(a);
    expect(Object.keys(useIncidentStore.getState().incidents)).toHaveLength(2);
    expect(useIncidentStore.getState().incidents[a].senderId).toBe('!alice');
    expect(useIncidentStore.getState().incidents[b].senderId).toBe('!bob');
  });

  it('does not apply relay lastKnown over the victim pin', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const a = s.upsertFromMecp(
      report('MECP/0/M01 trapped', {
        senderId: '!victim',
        protocol: 'meshtastic',
        lastKnown: { lat: 39.7, lon: -105.0 },
        receivedAt: 1_000,
      }),
    )!;
    s.upsertFromMecp(
      report('MECP/0/M01 trapped', {
        senderId: '!bridge',
        protocol: 'meshcore',
        lastKnown: { lat: 1, lon: 2 },
        receivedAt: 2_000,
      }),
    );
    const inc = useIncidentStore.getState().incidents[a];
    expect(inc.lat).toBeCloseTo(39.7);
    expect(inc.lon).toBeCloseTo(-105.0);
    expect(inc.coordsSource).toBe('lastKnown');
  });

  it('seed path honors payload tombstones for relayed copies', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const id = s.upsertFromMecp(
      report('MECP/0/M01 trapped', {
        senderId: '!victim',
        protocol: 'meshtastic',
        receivedAt: Date.now(),
      }),
    )!;
    s.resolveIncident(id);
    expect(
      s.upsertFromMecp({
        ...report('MECP/0/M01 trapped', {
          senderId: '!bridge',
          protocol: 'meshcore',
          receivedAt: Date.now(),
          messageId: 'seed-relay',
        }),
        fromSeed: true,
      }),
    ).toBeNull();
  });

  it('never evicts open MAYDAY when the cap is exceeded', async () => {
    const { useIncidentStore, MAX_INCIDENTS } = await loadStore();
    const s = useIncidentStore.getState();
    const mayday = s.upsertFromMecp(report('MECP/0/M01 critical', { receivedAt: 0 }))!;
    for (let i = 1; i <= MAX_INCIDENTS + 5; i++) {
      s.upsertFromMecp(report(`MECP/3/L01 flood${i}`, { receivedAt: i }));
    }
    const incidents = useIncidentStore.getState().incidents;
    expect(incidents[mayday]).toBeDefined();
    expect(incidents[mayday].severity).toBe(0);
    expect(Object.keys(incidents).length).toBeGreaterThanOrEqual(MAX_INCIDENTS);
  });

  it('seed path skips tombstoned resolved fingerprints', async () => {
    const { useIncidentStore } = await loadStore();
    const s = useIncidentStore.getState();
    const id = s.upsertFromMecp(report('MECP/0/M01 old', { receivedAt: Date.now() }))!;
    s.resolveIncident(id);
    expect(useIncidentStore.getState().resolvedTombstones[id]).toBeDefined();
    expect(
      s.upsertFromMecp(
        report('MECP/0/M01 old', { receivedAt: Date.now(), messageId: 'seed-echo' }),
      ),
    ).toBeNull(); // within grace, not reopen
    // Explicit seed flag must not recreate after resolve even past grace:
    expect(
      s.upsertFromMecp({
        ...report('MECP/0/M01 old', {
          receivedAt: Date.now() + 10 * 60_000,
          messageId: 'seed-2',
        }),
        fromSeed: true,
      }),
    ).toBeNull();
  });

  it('persists incidents to localStorage and rehydrates', async () => {
    const { useIncidentStore } = await loadStore();
    const id = useIncidentStore.getState().upsertFromMecp(report('MECP/1/T04'))!;
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as { state: { incidents: Record<string, unknown> } };
    expect(Object.keys(persisted.state.incidents)).toEqual([id]);

    vi.resetModules();
    const reloaded = await loadStore();
    expect(reloaded.useIncidentStore.getState().incidents[id]?.codes).toEqual(['T04']);
  });
});
