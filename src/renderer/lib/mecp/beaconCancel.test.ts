// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';
import { INCIDENT_STORE_KEY, useIncidentStore } from '@/renderer/stores/incidentStore';
import type { OutboxEntry, OutboxEntryInput } from '@/shared/electron-api.types';

import {
  type BeaconCancelDeps,
  beaconCancelToNodeForMessage,
  resetBeaconCancelInFlightForTests,
  resolveBeaconCancelRoute,
  resolveIncidentWithBeaconCancel,
  shouldTransmitBeaconCancel,
} from './beaconCancel';
import type { EmergencyIncident } from './incidentTypes';
import { tryParseMecp } from './mecpMessages';

function queuedRow(entry: OutboxEntryInput): OutboxEntry {
  return {
    ...entry,
    id: 1,
    attemptCount: 0,
    createdAt: 0,
    updatedAt: 0,
    priority: entry.priority ?? 'normal',
  };
}

function ingest(
  text: string,
  senderId: string,
  extra: {
    localOrigin?: boolean;
    beaconCancelToNode?: number;
    protocol?: EmergencyIncident['protocol'];
  } = {},
) {
  const parsed = tryParseMecp(text);
  if (!parsed) throw new Error(`not MECP: ${text}`);
  const id = useIncidentStore.getState().upsertFromMecp({
    protocol: extra.protocol ?? 'meshtastic',
    parsed,
    senderId,
    senderName: 'Ada',
    channel: '2',
    receivedAt: 1_000,
    localOrigin: extra.localOrigin,
    beaconCancelToNode: extra.beaconCancelToNode,
  });
  if (id == null) throw new Error(`no incident for ${text}`);
  return useIncidentStore.getState().incidents[id];
}

function deps(queueOutbox: BeaconCancelDeps['queueOutbox']): BeaconCancelDeps {
  return {
    isSendAvailable: () => false,
    sendFn: () => () => undefined,
    queueOutbox,
  };
}

describe('resolveIncidentWithBeaconCancel', () => {
  beforeEach(() => {
    localStorage.removeItem(INCIDENT_STORE_KEY);
    useIncidentStore.setState({ incidents: {}, resolvedTombstones: {} });
    resetBeaconCancelInFlightForTests();
  });

  it('queues exactly one B03 when resolving an originated beacon', async () => {
    const incident = ingest('MECP/0/B01 M01', '42', { localOrigin: true });
    const queueOutbox = vi.fn((entry: OutboxEntryInput) => Promise.resolve(queuedRow(entry)));
    const send = deps(queueOutbox);

    const first = resolveIncidentWithBeaconCancel(incident, new Set(), send, () => false);
    const second = resolveIncidentWithBeaconCancel(incident, new Set(), send, () => false);
    await expect(first).resolves.toBe('cancel-queued');
    await expect(second).resolves.toBe('cancel-pending');

    expect(queueOutbox).toHaveBeenCalledTimes(1);
    expect(queueOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'meshtastic',
        viewKey: 'ch:2',
        channel: 2,
        toNode: null,
        payload: 'MECP/0/B03',
        priority: 'emergency',
      }),
    );
    expect(useIncidentStore.getState().incidents[incident.id]).toMatchObject({
      status: 'resolved',
      beaconActive: false,
    });

    await resolveIncidentWithBeaconCancel(
      useIncidentStore.getState().incidents[incident.id],
      new Set(['42']),
      send,
      () => false,
    );
    expect(queueOutbox).toHaveBeenCalledTimes(1);
  });

  it('resolves a non-beacon incident without sending', async () => {
    const incident = ingest('MECP/1/M01 ridge', '42', { localOrigin: true });
    const queueOutbox = vi.fn((entry: OutboxEntryInput) => Promise.resolve(queuedRow(entry)));
    await expect(
      resolveIncidentWithBeaconCancel(incident, new Set(['42']), deps(queueOutbox), () => false),
    ).resolves.toBe('resolved');
    expect(queueOutbox).not.toHaveBeenCalled();
    expect(useIncidentStore.getState().incidents[incident.id].status).toBe('resolved');
  });

  it("resolves someone else's beacon locally and does not transmit B03", async () => {
    const incident = ingest('MECP/0/B01', '99');
    expect(shouldTransmitBeaconCancel(incident, new Set(['42']))).toBe(false);
    const queueOutbox = vi.fn((entry: OutboxEntryInput) => Promise.resolve(queuedRow(entry)));
    await expect(
      resolveIncidentWithBeaconCancel(incident, new Set(['42']), deps(queueOutbox), () => false),
    ).resolves.toBe('resolved');
    expect(queueOutbox).not.toHaveBeenCalled();
    expect(useIncidentStore.getState().incidents[incident.id].status).toBe('resolved');
  });

  it('treats a matching sender id as the originator when localOrigin was not stored', async () => {
    const incident = ingest('MECP/0/B01', '42');
    expect(incident.localOrigin).toBeUndefined();
    const queueOutbox = vi.fn((entry: OutboxEntryInput) => Promise.resolve(queuedRow(entry)));
    await expect(
      resolveIncidentWithBeaconCancel(incident, new Set(['42']), deps(queueOutbox), () => false),
    ).resolves.toBe('cancel-queued');
    expect(queueOutbox).toHaveBeenCalledTimes(1);
  });

  it('leaves the row open when the cancel cannot be queued', async () => {
    const incident = ingest('MECP/0/B01', '42', { localOrigin: true });
    const warn = mockConsoleWarn();
    const queueOutbox = vi.fn(() => Promise.reject(new Error('db closed')));
    await expect(
      resolveIncidentWithBeaconCancel(incident, new Set(), deps(queueOutbox), () => false),
    ).resolves.toBe('cancel-failed');
    expect(useIncidentStore.getState().incidents[incident.id].status).toBe('open');
    expect(useIncidentStore.getState().incidents[incident.id].beaconActive).toBe(true);
    warn.restore();
  });

  it('does not queue a DM-only cancel that has no destination', async () => {
    const incident = ingest('MECP/0/B01', '42', {
      localOrigin: true,
      protocol: 'reticulum',
    });
    const warn = mockConsoleWarn();
    const queueOutbox = vi.fn((entry: OutboxEntryInput) => Promise.resolve(queuedRow(entry)));
    await expect(
      resolveIncidentWithBeaconCancel(incident, new Set(), deps(queueOutbox), () => true),
    ).resolves.toBe('cancel-failed');
    expect(queueOutbox).not.toHaveBeenCalled();
    expect(useIncidentStore.getState().incidents[incident.id].status).toBe('open');
    warn.restore();
  });

  it('repeats a unicast destination on the cancel', async () => {
    const incident = ingest('MECP/0/B01', '42', {
      localOrigin: true,
      protocol: 'reticulum',
      beaconCancelToNode: 7,
    });
    const queueOutbox = vi.fn((entry: OutboxEntryInput) => Promise.resolve(queuedRow(entry)));
    await resolveIncidentWithBeaconCancel(incident, new Set(), deps(queueOutbox), () => true);
    expect(queueOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'reticulum',
        viewKey: 'dm:7',
        toNode: 7,
        channel: 2,
        payload: 'MECP/0/B03',
        priority: 'emergency',
      }),
    );
  });

  it("receiving a B03 still clears the sender's beacon without resolving it", () => {
    const incident = ingest('MECP/0/B01 M01', '7');
    expect(incident.beaconActive).toBe(true);
    const parsed = tryParseMecp('MECP/0/B03');
    if (!parsed) throw new Error('B03 did not parse');
    expect(
      useIncidentStore.getState().upsertFromMecp({
        protocol: 'meshtastic',
        parsed,
        senderId: '7',
        senderName: 'Ada',
        channel: '2',
        receivedAt: 2_000,
      }),
    ).toBe(incident.id);
    const after = useIncidentStore.getState().incidents[incident.id];
    expect(after.beaconActive).toBe(false);
    expect(after.status).toBe('open');

    const other = ingest('MECP/0/B01', '8');
    const cancel = tryParseMecp('MECP/3/B03');
    if (!cancel) throw new Error('B03 did not parse');
    useIncidentStore.getState().upsertFromMecp({
      protocol: 'meshtastic',
      parsed: cancel,
      senderId: '7',
      receivedAt: 3_000,
    });
    expect(useIncidentStore.getState().incidents[other.id].beaconActive).toBe(true);
  });
});

describe('beacon cancel routing helpers', () => {
  it('keeps channel floods as broadcasts and repeats unicast destinations', () => {
    expect(beaconCancelToNodeForMessage('meshtastic', 0xffffffff)).toBeNull();
    expect(beaconCancelToNodeForMessage('meshcore', 0)).toBeNull();
    expect(beaconCancelToNodeForMessage('meshtastic', 15)).toBe(15);
    expect(beaconCancelToNodeForMessage('reticulum', 0)).toBeNull();
    expect(beaconCancelToNodeForMessage('reticulum', 9)).toBe(9);
    expect(
      resolveBeaconCancelRoute(
        {
          protocol: 'meshcore',
          protocolsSeen: ['meshtastic', 'meshcore'],
          channel: '4',
          beaconCancelToNode: undefined,
        },
        () => false,
      ),
    ).toEqual({ protocol: 'meshtastic', channel: 4, toNode: null, viewKey: 'ch:4' });
  });
});
