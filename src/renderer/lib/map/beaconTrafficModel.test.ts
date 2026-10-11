import { describe, expect, it } from 'vitest';

import {
  BEACON_MESSAGE_PREVIEW_MAX_LENGTH,
  buildBeaconTrafficNodeIndex,
  normalizeBeaconMessage,
  normalizeBeaconObservation,
  normalizeBeaconObservations,
} from './beaconTrafficModel';
import { groupLiveTrafficEvents } from './liveTrafficGroups';
import { LIVE_TRAFFIC_MAX_AGE_MS, LIVE_TRAFFIC_MAX_PACKETS } from './liveTrafficModel';

const NOW = 1_791_684_640_000;
const KEY_A = '01'.repeat(32);
const KEY_B = '02'.repeat(32);
const KEY_C = '03'.repeat(32);
const KEY_OBSERVER = '04'.repeat(32);

function resolvedNode(publicKey: string, latitude = 40, longitude = -105) {
  return {
    id: `node-${publicKey.slice(0, 2)}`,
    name: `Repeater ${publicKey.slice(0, 2)}`,
    publicKey,
    latitude,
    longitude,
  };
}

function resolution(publicKey: string, latitude = 40, longitude = -105) {
  return { confidence: 'high', nodes: [resolvedNode(publicKey, latitude, longitude)] };
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    packetHash: 'efb4812b8112f5d8',
    id: 3790118,
    observerId: 'observer-uuid',
    observerPublicKey: KEY_OBSERVER,
    observerName: 'Regional observer',
    iata: 'DEN',
    heardAt: NOW,
    header: { routeType: 1, routeTypeName: 'FLOOD', payloadType: 4, payloadTypeName: 'advert' },
    pathLength: { raw: '42', hashSize: 2, hopCount: 2 },
    pathBytes: '02020303',
    resolvedPath: [resolution(KEY_B, 39.9), resolution(KEY_C, 39.8)],
    resolvedSource: resolution(KEY_A, 40.1),
    rssi: -95,
    snr: 7.5,
    ...overrides,
  };
}

function directoryNode(publicKey = KEY_OBSERVER) {
  return {
    id: 'directory-node-uuid',
    name: 'Observer node',
    publicKey,
    lat: 39.7,
    lng: -105,
    iatas: [{ iata: 'DEN', lastHeard: NOW }],
  };
}

const index = buildBeaconTrafficNodeIndex([directoryNode()]);

describe('Beacon node directory index', () => {
  it('uses full public keys and coordinates while keeping UUIDs separate from local node numbers', () => {
    const point = index.points[0];
    expect(point).toMatchObject({
      nodeId: null,
      beaconNodeId: 'directory-node-uuid',
      publicKey: KEY_OBSERVER,
      lat: 39.7,
      lon: -105,
    });
    expect(index.pointsByPublicKey.get(KEY_OBSERVER)).toBe(point);
  });

  it('never substitutes an IATA region center or accepts incomplete public keys', () => {
    const badIndex = buildBeaconTrafficNodeIndex([
      { ...directoryNode(), lat: null, lng: null, iata: 'DEN', centerLat: 39.8, centerLon: -104.6 },
      { ...directoryNode(KEY_A), publicKey: '0101' },
      { ...directoryNode(KEY_B), lat: 0, lng: 0 },
      { ...directoryNode(KEY_C), lat: 91 },
    ]);
    expect(badIndex.points).toEqual([]);
  });

  it('does not choose a location for conflicting duplicate public keys', () => {
    const duplicateIndex = buildBeaconTrafficNodeIndex([
      directoryNode(),
      { ...directoryNode(), id: 'other-uuid', lat: 41 },
    ]);
    expect(duplicateIndex.pointsByPublicKey.get(KEY_OBSERVER)).toBeNull();
    expect(duplicateIndex.points).toEqual([]);
  });

  it('maps observer IDs only when an explicit full public key exists', () => {
    const observerIndex = buildBeaconTrafficNodeIndex(
      [directoryNode()],
      [
        { id: 'observer-uuid', publicKey: KEY_OBSERVER },
        { id: 'other-observer', displayName: 'Observer node', iata: 'DEN' },
      ],
    );
    expect(observerIndex.observerKeysById.get('observer-uuid')).toBe(KEY_OBSERVER);
    expect(observerIndex.observerKeysById.has('other-observer')).toBe(false);
  });
});

describe('Beacon observation normalization', () => {
  it('keeps live Beacon controls generic when observations omit the payload', () => {
    const event = normalizeBeaconObservation(
      {
        type: 'event',
        event: 'packetObservation',
        data: {
          packetHash: 'live-control',
          packet: {
            payloadType: 11,
            payloadTypeName: 'CONTROL',
            routeType: 2,
            routeTypeName: 'DIRECT',
            observationCount: 1,
          },
          observation: {
            observerId: 'observer-uuid',
            heardAt: NOW,
            pathLength: { raw: '00', hashSize: 1, hopCount: 0 },
            pathBytes: '',
            resolvedPath: [],
            rssi: -95,
            snr: 7.5,
          },
        },
      },
      index,
      NOW,
    )!;
    expect(event.kind).toBe('CONTROL');
    expect(event.controlSubtype).toBeUndefined();
    expect(event.senderLabel).toBeUndefined();
  });

  it.each([
    [{ parsedPayload: { type: 'discover_req' } }, 'DISCOVER_REQ'],
    [{ parsedPayload: { type: 'DISCOVER_RESP' } }, 'DISCOVER_RESP'],
    [{ rawPayload: '801801020304' }, 'DISCOVER_REQ'],
    [{ parsedPayload: { raw: '92' } }, 'DISCOVER_RESP'],
    [{ rawPayload: 'a0' }, undefined],
    [{ rawPayload: '' }, undefined],
  ])('retains discovery purpose independently of sender and position', (details, subtype) => {
    const event = normalizeBeaconObservation(
      observation({
        header: { routeType: 2, payloadTypeName: 'control' },
        resolvedSource: null,
        ...details,
      }),
      index,
      NOW,
    )!;
    expect(event.kind).toBe('CONTROL');
    expect(event.controlSubtype).toBe(subtype);
    expect(event.senderLabel).toBeUndefined();
  });

  it('does not use control metadata on other Beacon packet types', () => {
    expect(
      normalizeBeaconObservation(
        observation({ parsedPayload: { type: 'DISCOVER_REQ' }, rawPayload: '80' }),
        index,
        NOW,
      )?.controlSubtype,
    ).toBeUndefined();
  });

  it('keeps an unlocated companion as the live advert sender instead of its first mapped repeater', () => {
    const flat = observation({
      resolvedSource: {
        confidence: 'high',
        nodes: [{ publicKey: KEY_A, name: 'Companion old name' }],
      },
    });
    const event = normalizeBeaconObservation(
      {
        type: 'event',
        event: 'packetObservation',
        data: {
          packetHash: flat.packetHash,
          packet: { ...flat.header, summary: 'Companion current name' },
          observation: { ...flat, header: undefined },
        },
      },
      index,
      NOW,
    )!;
    expect(event).toMatchObject({
      kind: 'ADVERT',
      senderLabel: 'Companion current name',
      routeStatus: 'partial',
    });
    expect(event.messageText).toBeUndefined();
    expect(event.points[0].label).toBe('Repeater 02');
    expect(event.segments.map(({ from, to }) => [from.lat, to.lat])).toEqual([
      [39.9, 39.8],
      [39.8, 39.7],
    ]);
  });

  it('reads an advert name from packet detail independently of source resolution and GPS', () => {
    const event = normalizeBeaconObservation(
      observation({
        resolvedSource: null,
        originPubkey: KEY_A,
        parsedPayload: { type: 'ADVERT', publicKey: KEY_A, appData: { name: 'Companion' } },
      }),
      index,
      NOW,
    )!;
    expect(event.senderLabel).toBe('Companion');
    expect(event.points[0].label).toBe('Repeater 02');
  });

  it('preserves a uniquely resolved sender name without coordinates or an advert summary', () => {
    const event = normalizeBeaconObservation(
      observation({
        resolvedSource: { confidence: 'high', nodes: [{ publicKey: KEY_A, name: 'Companion' }] },
      }),
      index,
      NOW,
    )!;
    expect(event.senderLabel).toBe('Companion');
    expect(event.points.some((point) => 'publicKey' in point && point.publicKey === KEY_A)).toBe(
      false,
    );
  });

  it('never promotes a relay, ambiguous source, or non-advert summary into the sender', () => {
    const event = normalizeBeaconObservation(
      observation({
        header: { routeType: 1, payloadTypeName: 'ACK' },
        summary: 'ack 0123',
        resolvedSource: { confidence: 'high', nodes: [resolvedNode(KEY_A), resolvedNode(KEY_B)] },
      }),
      index,
      NOW,
    )!;
    expect(event.senderLabel).toBeUndefined();
    expect(event.points[0].label).toBe('Repeater 02');
  });

  it('accepts the live packetObservation data shape and the documented WebSocket envelope', () => {
    const flat = observation();
    const data = {
      packetHash: flat.packetHash,
      packet: flat.header,
      observation: { ...flat, header: undefined, packetHash: undefined },
    };
    const event = normalizeBeaconObservation(data, index, NOW)!;
    expect(event).toMatchObject({ source: 'Beacon', kind: 'ADVERT', routeStatus: 'resolved' });
    expect(event.segments).toHaveLength(3);
    expect(
      normalizeBeaconObservation(
        { v: 1, type: 'event', event: 'packetObservation', data },
        index,
        NOW,
      ),
    ).toEqual(event);
  });
  it('retains explicit observer identity and positive global server counts for packet grouping', () => {
    const flat = observation();
    const data = {
      packetHash: flat.packetHash,
      packet: { ...flat.header, observationCount: 19 },
      observation: flat,
    };
    expect(normalizeBeaconObservation(data, index, NOW)).toMatchObject({
      observerId: 'observer-uuid',
      reportedObservationCount: 19,
    });
    expect(
      normalizeBeaconObservation(
        { ...data, packet: { ...flat.header, observationCount: 0 } },
        index,
        NOW,
      )?.reportedObservationCount,
    ).toBeUndefined();
  });

  it('animates high-confidence flood hops to the actual observer identified by full key', () => {
    const event = normalizeBeaconObservation(observation(), index, NOW)!;
    expect(event).toMatchObject({
      source: 'Beacon',
      kind: 'ADVERT',
      routeStatus: 'resolved',
      ts: NOW,
      rssi: -95,
      snr: 7.5,
      hopCount: 2,
    });
    expect(event.segments.map(({ from, to }) => [from.lat, to.lat])).toEqual([
      [40.1, 39.9],
      [39.9, 39.8],
      [39.8, 39.7],
    ]);
    expect(event.points.every((point) => point.nodeId === null)).toBe(true);
    expect(event.segments.map((segment) => segment.hopIndex)).toEqual([0, 1, 2]);
  });

  it('preserves a gap even when its later run starts at the same relay as the earlier run ended', () => {
    const event = normalizeBeaconObservation(
      observation({
        pathLength: { raw: '44', hashSize: 2, hopCount: 4 },
        pathBytes: '0202030302020303',
        resolvedPath: [
          resolution(KEY_B, 39.9),
          { confidence: 'ambiguous', nodes: [resolvedNode(KEY_C, 39.8)] },
          resolution(KEY_B, 39.9),
          resolution(KEY_C, 39.8),
        ],
      }),
      index,
      NOW,
    )!;
    expect(event.segments.map(({ from, to, hopIndex }) => [from.lat, to.lat, hopIndex])).toEqual([
      [40.1, 39.9, 0],
      [39.9, 39.8, 3],
      [39.8, 39.7, 4],
    ]);
    expect(
      groupLiveTrafficEvents([event], NOW)[0].observedPaths.map((path) => path.segmentKeys.length),
    ).toEqual([1, 2]);
  });

  it.each(['ambiguous', 'none', 'low'])(
    'breaks a %s hop without bridging to the following relay',
    (confidence) => {
      const event = normalizeBeaconObservation(
        observation({
          resolvedPath: [
            { confidence, nodes: [resolvedNode(KEY_B, 39.9)] },
            resolution(KEY_C, 39.8),
          ],
        }),
        index,
        NOW,
      )!;
      expect(event.routeStatus).toBe('partial');
      expect(event.segments.map(({ from, to }) => [from.lat, to.lat])).toEqual([[39.8, 39.7]]);
    },
  );

  it('rejects multiple candidates even if the server labels the hop high confidence', () => {
    const event = normalizeBeaconObservation(
      observation({
        resolvedPath: [
          { confidence: 'high', nodes: [resolvedNode(KEY_B), resolvedNode(KEY_C)] },
          resolution(KEY_C, 39.8),
        ],
      }),
      index,
      NOW,
    )!;
    expect(event.segments).toHaveLength(1);
    expect(event.segments[0].from.lat).toBe(39.8);
  });

  it('leaves a gap for a high-confidence hop missing coordinates even if its directory entry is located', () => {
    const locatedIndex = buildBeaconTrafficNodeIndex([
      directoryNode(),
      { ...directoryNode(KEY_B), lat: 39.9 },
    ]);
    const event = normalizeBeaconObservation(
      observation({
        resolvedPath: [
          { confidence: 'high', nodes: [{ publicKey: KEY_B, name: 'No current position' }] },
          resolution(KEY_C, 39.8),
        ],
      }),
      locatedIndex,
      NOW,
    )!;
    expect(event.segments.map(({ from, to }) => [from.lat, to.lat])).toEqual([[39.8, 39.7]]);
  });

  it('does not trust a resolved node whose public key disagrees with the on-air path prefix', () => {
    const event = normalizeBeaconObservation(
      observation({
        resolvedPath: [resolution(KEY_A, 39.9), resolution(KEY_C, 39.8)],
      }),
      index,
      NOW,
    )!;
    expect(event.segments.map(({ from, to }) => [from.lat, to.lat])).toEqual([[39.8, 39.7]]);
  });

  it('cannot draw a final link from an observer display name or IATA code', () => {
    const event = normalizeBeaconObservation(
      observation({ observerPublicKey: undefined }),
      index,
      NOW,
    )!;
    expect(event.segments.map(({ from, to }) => [from.lat, to.lat])).toEqual([
      [40.1, 39.9],
      [39.9, 39.8],
    ]);
    expect(event.points.some((point) => point.lat === 39.7)).toBe(false);
    expect(event.routeStatus).toBe('partial');
  });

  it('uses an explicitly keyed observer directory without conflating observer and node UUIDs', () => {
    const observerIndex = buildBeaconTrafficNodeIndex(
      [directoryNode()],
      [{ id: 'observer-uuid', publicKey: KEY_OBSERVER }],
    );
    const event = normalizeBeaconObservation(
      observation({ observerPublicKey: undefined }),
      observerIndex,
      NOW,
    )!;
    expect(event.segments.at(-1)?.to.lat).toBe(39.7);
  });

  it.each([2, 3])(
    'does not interpret direct route type %i as a traversed path or receipt by its destination',
    (routeType) => {
      const event = normalizeBeaconObservation(
        observation({
          header: { routeType, payloadTypeName: 'text' },
          resolvedDestination: resolution(KEY_B, 39.9),
        }),
        index,
        NOW,
      )!;
      expect(event.routeStatus).toBe('direct');
      expect(event.segments).toEqual([]);
      expect(event.points.map((point) => point.lat)).toEqual([40.1, 39.7]);
    },
  );

  it('does not append a resolved destination to a flood observation', () => {
    const event = normalizeBeaconObservation(
      observation({ resolvedDestination: resolution('05'.repeat(32), 41) }),
      index,
      NOW,
    )!;
    expect(event.points.some((point) => point.lat === 41)).toBe(false);
  });

  it('requires a complete path layout, and treats an absent header as unparsed', () => {
    for (const overrides of [
      { pathBytes: '0202' },
      { resolvedPath: [resolution(KEY_B)] },
      { pathLength: { hashSize: 4, hopCount: 2 } },
      { pathBytes: 'not hex' },
    ]) {
      expect(normalizeBeaconObservation(observation(overrides), index, NOW)?.segments).toEqual([]);
    }
    expect(normalizeBeaconObservation(observation({ header: null }), index, NOW)).toMatchObject({
      routeStatus: 'unparsed',
      segments: [],
    });
  });

  it('represents missing signal data as unavailable rather than inventing zero dBm', () => {
    const event = normalizeBeaconObservation(
      observation({ rssi: null, snr: 'invalid' }),
      index,
      NOW,
    )!;
    expect(Number.isNaN(event.rssi)).toBe(true);
    expect(Number.isNaN(event.snr)).toBe(true);
  });

  it('never treats a geographical region as a MeshCore transport code', () => {
    const event = normalizeBeaconObservation(
      observation({ iata: 'DEN', region: 'colorado' }),
      index,
      NOW,
    )!;
    expect(event.scopeCode).toBeNull();
    expect(
      normalizeBeaconObservation(
        observation({ transportScopeCode: 0, transportReturnCode: 65535 }),
        index,
        NOW,
      ),
    ).toMatchObject({ scopeCode: 0, returnScopeCode: 65535 });
  });
});

describe('Beacon observation identity and limits', () => {
  it('keeps observers, paths, and repeat observations distinct for the same packet hash', () => {
    const events = normalizeBeaconObservations(
      [
        observation(),
        observation({ observerId: 'other-observer' }),
        observation({
          pathBytes: '03030202',
          resolvedPath: [resolution(KEY_C, 39.8), resolution(KEY_B, 39.9)],
        }),
        observation({ id: 3790120, heardAt: NOW - 1 }),
        observation(),
      ],
      index,
      NOW,
    );
    expect(events).toHaveLength(4);
    expect(new Set(events.map((event) => event.id)).size).toBe(4);
    expect(events[0].ts).toBe(NOW - 1);
  });

  it('rejects malformed or stale observations and future timestamps', () => {
    for (const value of [
      null,
      [],
      'json',
      {},
      observation({ packetHash: null }),
      observation({ heardAt: 'now' }),
      observation({ heardAt: NOW + 1 }),
      observation({ heardAt: NOW - LIVE_TRAFFIC_MAX_AGE_MS - 1 }),
    ]) {
      expect(normalizeBeaconObservation(value, index, NOW)).toBeNull();
    }
    expect(
      normalizeBeaconObservation(
        observation({ heardAt: NOW - LIVE_TRAFFIC_MAX_AGE_MS }),
        index,
        NOW,
      ),
    ).not.toBeNull();
  });

  it('examines only the most recent 200 entries', () => {
    const inputs = Array.from({ length: 300 }, (_, id) =>
      observation({ id, heardAt: NOW - 300 + id }),
    );
    const events = normalizeBeaconObservations(inputs, index, NOW);
    expect(events).toHaveLength(LIVE_TRAFFIC_MAX_PACKETS);
    expect(events[0].ts).toBe(NOW - 200);
  });
});

describe('Beacon message contents', () => {
  it('reads explicitly decrypted REST packet details from parsedPayload.decrypted', () => {
    const detail = {
      packetHash: 'efb4812b8112f5d8',
      decrypted: true,
      parsedPayload: {
        type: 'GROUP_TEXT',
        decrypted: { sender: 'Packet sender', content: 'Verified plaintext', sentAt: NOW - 1 },
      },
    };
    expect(normalizeBeaconMessage(detail)).toEqual({
      packetHash: 'efb4812b8112f5d8',
      senderLabel: 'Packet sender',
      messageText: 'Verified plaintext',
      sentAt: NOW - 1,
    });
    expect(normalizeBeaconMessage({ ...detail, decrypted: false })).toBeNull();
  });
  it('joins confirmed channel plaintext to every matching observation by packet hash', () => {
    const message = normalizeBeaconMessage({
      packetHash: 'efb4812b8112f5d8',
      senderName: 'Example sender',
      content: 'Testing the map',
      sentAt: NOW - 10_000,
    })!;
    const events = normalizeBeaconObservations(
      [
        observation({ header: { routeType: 1, payloadTypeName: 'GRP_TXT' } }),
        observation({
          header: { routeType: 1, payloadTypeName: 'GRP_TXT' },
          observerId: 'second-observer',
        }),
        observation({
          packetHash: 'different-hash',
          header: { routeType: 1, payloadTypeName: 'GRP_TXT' },
        }),
      ],
      index,
      NOW,
      new Map([[message.packetHash, message]]),
    );
    expect(events[0]).toMatchObject({
      messageText: 'Testing the map',
      senderLabel: 'Example sender',
      contentStatus: 'decoded',
      ts: NOW,
    });
    expect(events[1].messageText).toBe('Testing the map');
    expect(events[2]).toMatchObject({ contentStatus: 'unavailable' });
    expect(events[2].messageText).toBeUndefined();
  });

  it('accepts a live channelMessage envelope and bounds the preview size', () => {
    const message = normalizeBeaconMessage({
      v: 1,
      type: 'event',
      event: 'channelMessage',
      data: {
        packetHash: 'ABCDEF0123456789',
        senderName: 'Sender',
        content: 'a'.repeat(3_000),
        sentAt: NOW,
      },
    })!;
    expect(message.packetHash).toBe('abcdef0123456789');
    expect(message.messageText).toHaveLength(BEACON_MESSAGE_PREVIEW_MAX_LENGTH);
  });

  it('does not infer message contents from summary text or refresh expired observations with sentAt', () => {
    expect(
      normalizeBeaconMessage({ packetHash: 'efb4812b8112f5d8', summary: 'This is only a summary' }),
    ).toBeNull();
    const message = normalizeBeaconMessage({
      packetHash: 'efb4812b8112f5d8',
      content: 'Hello',
      sentAt: NOW,
    })!;
    expect(
      normalizeBeaconObservation(
        observation({ heardAt: NOW - LIVE_TRAFFIC_MAX_AGE_MS - 1 }),
        index,
        NOW,
        new Map([[message.packetHash, message]]),
      ),
    ).toBeNull();
  });
});
