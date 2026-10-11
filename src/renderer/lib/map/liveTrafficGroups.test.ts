import { describe, expect, it } from 'vitest';

import {
  groupLiveTrafficEvents,
  liveTrafficPointKey,
  liveTrafficSegmentKey,
} from './liveTrafficGroups';
import {
  filterLiveTrafficEvents,
  LIVE_TRAFFIC_MAX_AGE_MS,
  LIVE_TRAFFIC_MAX_PACKETS,
  type LiveTrafficEvent,
  type LiveTrafficPoint,
  type LiveTrafficSegment,
} from './liveTrafficModel';

const NOW = 1_000_000;

function point(id: number, lat = 39 + id / 10): LiveTrafficPoint & { publicKey: string } {
  return {
    nodeId: null,
    publicKey: id.toString(16).padStart(2, '0').repeat(32),
    lat,
    lon: -105,
    label: `Node ${id}`,
  };
}

const A = point(1);
const B = point(2);
const C = point(3);
const D = point(4);
const AB = { from: A, to: B };
const BC = { from: B, to: C };
const BD = { from: B, to: D };

function report(
  id: string,
  segments: LiveTrafficSegment[] = [AB, BC],
  overrides: Partial<LiveTrafficEvent> = {},
): LiveTrafficEvent {
  return {
    id,
    packetHash: 'same-packet-hash',
    observerId: `observer-${id}`,
    ts: NOW,
    kind: 'GRP_TXT',
    source: 'Beacon',
    segments,
    points: segments.flatMap((segment) => [segment.from, segment.to]),
    routeStatus: 'resolved',
    scopeCode: null,
    returnScopeCode: null,
    rssi: -90,
    snr: 8,
    hopCount: 2,
    contentStatus: 'unavailable',
    ...overrides,
  };
}

describe('groupLiveTrafficEvents', () => {
  it('retains control purpose across later observations and sparse metadata refreshes', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('enriched', [], { kind: 'CONTROL', controlSubtype: 'DISCOVER_RESP', ts: NOW - 1 }),
        report('enriched', [], { kind: 'CONTROL', ts: NOW - 1 }),
        report('later', [], { kind: 'CONTROL' }),
      ],
      NOW,
    );
    expect(group).toMatchObject({
      kind: 'CONTROL',
      controlSubtype: 'DISCOVER_RESP',
      reportCount: 2,
    });
    expect(group.senderLabel).toBeUndefined();
  });

  it('enriches existing control reports without leaking purpose into another packet', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('same', [], { kind: 'CONTROL' }),
        report('same', [], { kind: 'CONTROL', controlSubtype: 'DISCOVER_REQ' }),
      ],
      NOW,
    );
    expect(group).toMatchObject({
      kind: 'CONTROL',
      controlSubtype: 'DISCOVER_REQ',
      reportCount: 1,
    });
    const [replaced] = groupLiveTrafficEvents(
      [
        report('same', [], { kind: 'CONTROL', controlSubtype: 'DISCOVER_REQ' }),
        report('same', [], { kind: 'ADVERT', packetHash: 'different-packet' }),
      ],
      NOW,
    );
    expect(replaced.controlSubtype).toBeUndefined();
  });

  it('keeps the advert origin name when later reports only locate its repeaters', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('known-origin', [BC], { kind: 'ADVERT', ts: NOW - 1, senderLabel: 'Companion' }),
        report('later-route', [BD], { kind: 'ADVERT' }),
      ],
      NOW,
    );
    expect(group.senderLabel).toBe('Companion');
    expect(group.messageText).toBeUndefined();
    expect(group.points[0]).toEqual(B);
    expect(group.reportCount).toBe(2);
  });

  it('retains sender-only metadata across an exact observation refresh without adding a report', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('same', [BC], { kind: 'ADVERT', senderLabel: 'Companion' }),
        report('same', [BC], { kind: 'ADVERT' }),
      ],
      NOW,
    );
    expect(group).toMatchObject({ senderLabel: 'Companion', reportCount: 1 });
    expect(group.messageText).toBeUndefined();
  });

  it('keeps known origin metadata when a decoded message supplies no sender name', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('known-origin', [AB], { ts: NOW - 1, senderLabel: 'Companion' }),
        report('message', [BC], { contentStatus: 'decoded', messageText: 'Hello mesh' }),
      ],
      NOW,
    );
    expect(group).toMatchObject({ senderLabel: 'Companion', messageText: 'Hello mesh' });
  });

  it('keeps server-estimated routes labeled when merged with resolved or partial reports', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('estimate', [AB], { routeStatus: 'estimated' }),
        report('known', [BC], { routeStatus: 'resolved' }),
        report('gap', [BD], { routeStatus: 'partial' }),
      ],
      NOW,
    );
    expect(group.routeStatus).toBe('estimated');
    expect(group.segments).toHaveLength(3);
  });

  it('preserves each observer route through a shared trunk in chronological hop order', () => {
    const first = report(
      'first',
      [
        { ...AB, hopIndex: 0 },
        { ...BC, hopIndex: 1 },
      ],
      { ts: NOW - 500 },
    );
    const branch = report('branch', [
      { ...AB, hopIndex: 0 },
      { ...BD, hopIndex: 1 },
    ]);
    const [group] = groupLiveTrafficEvents([branch, first], NOW);
    expect(group.observedPaths).toEqual([
      expect.objectContaining({
        observationId: 'first',
        observerId: 'observer-first',
        observedAt: NOW - 500,
        segmentKeys: [AB, BC].map(liveTrafficSegmentKey),
      }),
      expect.objectContaining({
        observationId: 'branch',
        observerId: 'observer-branch',
        observedAt: NOW,
        segmentKeys: [AB, BD].map(liveTrafficSegmentKey),
      }),
    ]);
    expect(group.segments).toHaveLength(3);
    expect(groupLiveTrafficEvents([branch], NOW)[0].observedPaths[0].id).toBe(
      group.observedPaths[1].id,
    );
  });

  it('splits paths at missing hop indices even when the gap returns to the same node', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('gap', [
          { ...AB, hopIndex: 0 },
          { ...BC, hopIndex: 3 },
        ]),
      ],
      NOW,
    );
    expect(group.observedPaths.map((path) => path.segmentKeys)).toEqual(
      [AB, BC].map((segment) => [liveTrafficSegmentKey(segment)]),
    );
    expect(group.observedPaths[0].id).not.toBe(group.observedPaths[1].id);
  });

  it('does not join disconnected endpoints or legacy segments with no route provenance', () => {
    const CD = { from: C, to: D };
    const [disconnected] = groupLiveTrafficEvents(
      [
        report('gap', [
          { ...AB, hopIndex: 0 },
          { ...CD, hopIndex: 1 },
        ]),
      ],
      NOW,
    );
    expect(disconnected.observedPaths).toHaveLength(2);
    const [legacy] = groupLiveTrafficEvents([report('legacy', [AB, BC])], NOW);
    expect(legacy.observedPaths).toHaveLength(2);
  });

  it('retains route loops while deduplicating union edges and exact report refreshes', () => {
    const BA = { from: B, to: A };
    const event = report(
      'loop',
      [AB, BA, AB].map((segment, hopIndex) => ({
        ...segment,
        hopIndex,
      })),
    );
    const [group] = groupLiveTrafficEvents([event, { ...event, messageText: 'Refresh' }], NOW);
    expect(group.reportCount).toBe(1);
    expect(group.segments).toHaveLength(2);
    expect(group.observedPaths).toHaveLength(1);
    expect(group.observedPaths[0].segmentKeys).toEqual([AB, BA, AB].map(liveTrafficSegmentKey));
  });

  it('makes one packet with a shared trunk and every observed observer branch', () => {
    const [group] = groupLiveTrafficEvents(
      [report('a', [AB, BC], { ts: NOW - 1_000 }), report('b', [AB, BD])],
      NOW,
    );
    expect(group).toMatchObject({
      reportCount: 2,
      observerCount: 2,
      firstSeenTs: NOW - 1_000,
      lastSeenTs: NOW,
      ts: NOW,
    });
    expect(group.segments.map(liveTrafficSegmentKey)).toEqual(
      [AB, BC, BD].map(liveTrafficSegmentKey),
    );
    expect(group.points.map(liveTrafficPointKey)).toEqual([A, B, C, D].map(liveTrafficPointKey));
    expect(group.segments[0]).toMatchObject({
      observedAt: NOW - 1_000,
      lastSeenTs: NOW,
      reportCount: 2,
      observationId: 'a',
    });
    expect(group.segments[2]).toMatchObject({
      observedAt: NOW,
      reportCount: 1,
      observationId: 'b',
    });
  });

  it('keeps the packet ID stable as later observers add branches or earlier reports expire', () => {
    const first = report('a', [AB], { ts: NOW - 1_000 });
    const second = report('b', [BD]);
    const firstGroup = groupLiveTrafficEvents([first], NOW)[0];
    expect(groupLiveTrafficEvents([first, second], NOW)[0].id).toBe(firstGroup.id);
    expect(groupLiveTrafficEvents([second], NOW)[0].id).toBe(firstGroup.id);
  });

  it('never bridges a missing or ambiguous middle hop from the points list', () => {
    const CD = { from: C, to: D };
    const [group] = groupLiveTrafficEvents(
      [
        report('gapped', [AB, CD], { points: [A, B, C, D], routeStatus: 'partial' }),
        report('other', [BD]),
      ],
      NOW,
    );
    expect(group.segments.map(liveTrafficSegmentKey)).toEqual(
      [AB, CD, BD].map(liveTrafficSegmentKey),
    );
    expect(
      group.segments.some(
        (segment) => liveTrafficSegmentKey(segment) === liveTrafficSegmentKey(BC),
      ),
    ).toBe(false);
    expect(group.routeStatus).toBe('partial');
  });

  it('retains both directions and loops without counting a repeated edge twice in one report', () => {
    const BA = { from: B, to: A };
    const [group] = groupLiveTrafficEvents([report('loop', [AB, BA, AB])], NOW);
    expect(group.segments.map(liveTrafficSegmentKey)).toEqual([AB, BA].map(liveTrafficSegmentKey));
    expect(group.segments.every((segment) => segment.reportCount === 1)).toBe(true);
  });

  it('does not inflate report or observer counts for an exact observation refresh', () => {
    const first = report('same-id', [AB], {
      contentStatus: 'decoded',
      messageText: 'Actual decoded text',
      senderLabel: 'Sender',
    });
    const [group] = groupLiveTrafficEvents(
      [
        first,
        report('same-id', [AB]),
        report('other-id', [BC], { observerId: first.observerId }),
        report('unknown-id', [BD], { observerId: undefined }),
      ],
      NOW,
    );
    expect(group).toMatchObject({
      reportCount: 3,
      observerCount: 1,
      messageText: 'Actual decoded text',
      contentStatus: 'decoded',
    });
    expect(group.segments[0].reportCount).toBe(1);
  });

  it('keeps the richest exact-hash message while updating time and signal to the latest report', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('latest', [BD], { ts: NOW, rssi: -70, snr: 10 }),
        report('older', [AB], {
          ts: NOW - 500,
          rssi: -100,
          contentStatus: 'decoded',
          messageText: 'Hello mesh',
          senderLabel: 'Public sender',
        }),
      ],
      NOW,
    );
    expect(group).toMatchObject({
      firstSeenTs: NOW - 500,
      lastSeenTs: NOW,
      ts: NOW,
      rssi: -70,
      snr: 10,
      contentStatus: 'decoded',
      messageText: 'Hello mesh',
      senderLabel: 'Public sender',
    });
  });

  it('takes the maximum authoritative server count without summing it or treating repeats zero as a reset', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('a', [AB], { reportedObservationCount: 14 }),
        report('b', [BC], { reportedObservationCount: 20 }),
        report('c', [BD], { reportedObservationCount: 0 }),
      ],
      NOW,
    );
    expect(group.reportCount).toBe(3);
    expect(group.reportedObservationCount).toBe(20);
  });

  it('keeps different hashes and ingestion sources separate', () => {
    const groups = groupLiveTrafficEvents(
      [
        report('beacon'),
        report('rf', [AB], { source: 'RF' }),
        report('mqtt', [AB], { source: 'MQTT' }),
        report('other-hash', [AB], {
          packetHash: 'different-packet-hash',
          messageText: 'Other body',
          contentStatus: 'decoded',
        }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(4);
    expect(new Set(groups.map((group) => group.id)).size).toBe(4);
    expect(groups.filter((group) => group.messageText !== undefined)).toHaveLength(1);
  });

  it('does not deduplicate local packets by matching timestamps, routes, or message text', () => {
    const groups = groupLiveTrafficEvents(
      [
        report('local-a', [AB], { source: 'RF', packetHash: undefined, messageText: 'hello' }),
        report('local-b', [AB], { source: 'RF', packetHash: undefined, messageText: 'hello' }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.reportCount === 1)).toBe(true);
  });

  it('separates the same packet and observation ID after switching source sessions', () => {
    const first = report('same-id', [AB], {
      sourceSessionId: 'first',
      contentStatus: 'decoded',
      messageText: 'First feed body',
    });
    const second = report('same-id', [BD], { sourceSessionId: 'second' });
    const groups = groupLiveTrafficEvents([first, second], NOW);
    expect(groups).toHaveLength(2);
    expect(groups[0].id).not.toBe(groups[1].id);
    expect(groups[0].messageText).toBe('First feed body');
    expect(groups[1].messageText).toBeUndefined();
    expect(groups[1].segments.map(liveTrafficSegmentKey)).toEqual([liveTrafficSegmentKey(BD)]);
  });

  it('exposes mixed transport codes without silently assigning one branch scope to the whole packet', () => {
    const events = [
      report('a', [AB], { scopeCode: 0, returnScopeCode: 2 }),
      report('b', [BD], { scopeCode: 41, returnScopeCode: 2 }),
      report('c', [BC], { scopeCode: null, returnScopeCode: null }),
    ];
    const [group] = groupLiveTrafficEvents(events, NOW);
    expect(group).toMatchObject({
      scopeCodes: [null, 0, 41],
      returnScopeCodes: [null, 2],
      scopeMixed: true,
      scopeCode: null,
      returnScopeCode: null,
    });
    const [scoped] = groupLiveTrafficEvents(filterLiveTrafficEvents(events, { scope: 0 }), NOW);
    expect(scoped).toMatchObject({
      reportCount: 1,
      scopeCodes: [0],
      scopeMixed: false,
      scopeCode: 0,
      returnScopeCode: 2,
    });
    expect(scoped.segments.map(liveTrafficSegmentKey)).toEqual([liveTrafficSegmentKey(AB)]);
  });

  it('does not reintroduce geographically excluded branches after grouping', () => {
    const outside = { from: point(5, 48), to: point(6, 49) };
    const filtered = filterLiveTrafficEvents(
      [report('inside', [AB]), report('outside', [outside])],
      { bounds: { south: 37, west: -109, north: 41, east: -102 } },
    );
    const [group] = groupLiveTrafficEvents(filtered, NOW);
    expect(group.reportCount).toBe(1);
    expect(group.segments.map(liveTrafficSegmentKey)).toEqual([liveTrafficSegmentKey(AB)]);
  });

  it('bounds input work to 200 observations but retains their complete edge union', () => {
    const reports = Array.from({ length: 220 }, (_, i) =>
      report(`report-${i}`, [{ from: point(i), to: point(i + 1) }], { ts: NOW - 220 + i }),
    );
    const [group] = groupLiveTrafficEvents(reports, NOW);
    expect(group.reportCount).toBe(LIVE_TRAFFIC_MAX_PACKETS);
    expect(group.segments).toHaveLength(LIVE_TRAFFIC_MAX_PACKETS);
    expect(group.firstSeenTs).toBe(NOW - 200);
  });

  it('expires original observation timestamps instead of reviving old branches with a newer report', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('expired', [AB], { ts: NOW - LIVE_TRAFFIC_MAX_AGE_MS - 1 }),
        report('boundary', [BC], { ts: NOW - LIVE_TRAFFIC_MAX_AGE_MS }),
        report('fresh', [BD]),
        report('future', [AB], { ts: NOW + 1 }),
      ],
      NOW,
    );
    expect(group.reportCount).toBe(2);
    expect(group.segments.map(liveTrafficSegmentKey)).toEqual([BC, BD].map(liveTrafficSegmentKey));
  });

  it('preserves direct and unparsed packets as points without constructing paths', () => {
    const [group] = groupLiveTrafficEvents(
      [
        report('direct', [], { routeStatus: 'direct', points: [A, D] }),
        report('also-direct', [], { routeStatus: 'direct', points: [A, C] }),
      ],
      NOW,
    );
    expect(group.routeStatus).toBe('direct');
    expect(group.segments).toEqual([]);
    expect(group.points).toHaveLength(3);
  });
});

describe('traffic geometry identity', () => {
  it('uses complete public keys, direction, and coordinates rather than labels or truncations', () => {
    expect(liveTrafficPointKey({ ...A, label: 'Renamed' })).toBe(liveTrafficPointKey(A));
    expect(liveTrafficPointKey({ ...A, lat: 40 })).not.toBe(liveTrafficPointKey(A));
    const sameShortPrefix = { ...A, publicKey: '01' + 'ff'.repeat(31) };
    expect(liveTrafficPointKey(sameShortPrefix)).not.toBe(liveTrafficPointKey(A));
    expect(liveTrafficSegmentKey(AB)).not.toBe(liveTrafficSegmentKey({ from: B, to: A }));
  });
});
